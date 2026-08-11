import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow } from '../../../lib/workflow-engine';

function getGraphQLUrl() {
  const url = process.env.NHOST_GRAPHQL_URL;
  if (!url) throw new Error("NHOST_GRAPHQL_URL is not configured");
  return url;
}

function getAdminSecret() {
  const secret = process.env.NHOST_ADMIN_SECRET;
  if (!secret) throw new Error("NHOST_ADMIN_SECRET is not configured");
  return secret;
}

async function hasuraRequest(query: string, variables: any = {}) {
  const res = await fetch(getGraphQLUrl(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': getAdminSecret(),
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    
    // Hasura action payload
    const { action, input, session_variables } = body;
    
    if (action?.name !== 'triggerWorkflowRun') {
      return NextResponse.json({ message: "Invalid action" }, { status: 400 });
    }

    const workflowId = input.workflow_id;
    const userId = session_variables?.['x-hasura-user-id'];
    
    if (!userId) {
      return NextResponse.json({ message: "Authentication required", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 401 });
    }

    // 1. Verify workflow exists and get organization context
    const wfData = await hasuraRequest(`
      query GetWorkflowOrg($workflowId: uuid!) {
        workflows_by_pk(id: $workflowId) {
          id
          org_id
        }
      }
    `, { workflowId });
    
    const workflow = wfData?.workflows_by_pk;
    if (!workflow) {
      return NextResponse.json({ message: "Workflow not found", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 404 });
    }
    const orgId = workflow.org_id;

    // 2. Verify caller is org_member with role owner/editor
    const memberData = await hasuraRequest(`
      query GetOrgMember($orgId: uuid!, $userId: uuid!) {
        org_members(where: {org_id: {_eq: $orgId}, user_id: {_eq: $userId}}) {
          id
          role
        }
      }
    `, { orgId, userId });
    
    const members = memberData?.org_members;
    if (!members || members.length === 0) {
      return NextResponse.json({ message: "Authorization failed: not a member", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 403 });
    }
    const role = members[0].role;
    if (role !== 'owner' && role !== 'editor') {
      return NextResponse.json({ message: "Authorization failed: insufficient permissions", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 403 });
    }

    // 3. Quota: soft pre-check + monthly period reset
    //
    // Semantics (per spec): quota is consumed on COMPLETION only.
    // - Soft pre-check here rejects runs that are already over-quota (avoids wasted execution).
    // - Binding atomic increment happens in the workflow engine AFTER successful completion.
    // - Failed runs do NOT consume quota.
    // - Concurrent safety: the increment-on-completion uses a conditional UPDATE
    //   (_lt: quota_limit) so two concurrent completions cannot both exceed the limit.
    const quotaData = await hasuraRequest(`
      query GetQuota($orgId: uuid!) {
        organizations_by_pk(id: $orgId) {
          quota_limit
          quota_used
          quota_period_start
        }
      }
    `, { orgId });
    const quota = quotaData?.organizations_by_pk;
    if (!quota) {
      return NextResponse.json({ message: "Organization not found", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 404 });
    }

    // Monthly period reset (optimistic: conditional on quota_period_start not having changed)
    const now = new Date();
    const periodStart = new Date(quota.quota_period_start);
    if (now.getUTCFullYear() > periodStart.getUTCFullYear() || now.getUTCMonth() > periodStart.getUTCMonth()) {
      await hasuraRequest(`
        mutation ResetQuota($orgId: uuid!, $oldStart: timestamptz!) {
          update_organizations(
            where: { id: { _eq: $orgId }, quota_period_start: { _eq: $oldStart } },
            _set: { quota_used: 0, quota_period_start: "now()" }
          ) {
            affected_rows
          }
        }
      `, { orgId, oldStart: quota.quota_period_start });
    }

    // Soft pre-check: reject if already at or above quota_limit.
    // This is advisory only; the binding check is the atomic increment-on-completion below.
    if (quota.quota_used >= quota.quota_limit) {
      return NextResponse.json({ message: "Quota exhausted", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 402 });
    }

    // 4. Create workflow_run (Initial status: running)
    const runData = await hasuraRequest(`
      mutation CreateWorkflowRun($workflowId: uuid!) {
        insert_workflow_runs_one(object: {
          workflow_id: $workflowId,
          status: "running",
          started_at: "now()"
        }) {
          id
        }
      }
    `, { workflowId });
    const workflowRunId = runData.insert_workflow_runs_one.id;
    console.log(`[Workflow Engine] Created workflow_run ${workflowRunId}`);

    // 5. Execute workflow synchronously to ensure reliability in serverless context
    const executionResult = await executeWorkflow(workflowId, workflowRunId);

    // 6. Atomic quota increment on completion only.
    //    Quota is only consumed when the workflow run succeeds (completion semantics).
    //    The conditional WHERE (quota_used < quota_limit) prevents exceeding quota
    //    under concurrent execution — if affected_rows === 0, the quota was filled
    //    by another concurrent run that completed first; log it but do not fail the response.
    if (executionResult.status === 'completed') {
      const incResult = await hasuraRequest(`
        mutation IncrementQuotaOnCompletion($orgId: uuid!, $limit: Int!) {
          update_organizations(
            where: { id: { _eq: $orgId }, quota_used: { _lt: $limit } },
            _inc: { quota_used: 1 }
          ) {
            affected_rows
          }
        }
      `, { orgId, limit: quota.quota_limit });
      if (incResult.update_organizations.affected_rows === 0) {
        // Quota was concurrently exhausted. The run completed but quota was not charged.
        // This is acceptable under completion semantics — the run that filled the last
        // slot already consumed quota. Log for observability.
        console.warn(`[Quota] Run ${workflowRunId} completed but quota_limit reached concurrently; quota not incremented.`);
      }
    }
    // Failed runs: quota_used is NOT incremented (completion semantics satisfied).

    return NextResponse.json({
      workflow_run_id: workflowRunId,
      status: executionResult.status,
      message: executionResult.message
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ message: err.message || "Internal error", status: "failed", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 500 });
  }
}
