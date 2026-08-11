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
    
    if (action?.name !== 'approveStep') {
      return NextResponse.json({ message: "Invalid action" }, { status: 400 });
    }

    const stepRunId = input.step_run_id;
    const userId = session_variables?.['x-hasura-user-id'];
    
    if (!userId) {
      return NextResponse.json({ message: "Authentication required", status: "failed", step_run_id: "00000000-0000-0000-0000-000000000000", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 401 });
    }

    // 1. Fetch step_run details and relations
    const srData = await hasuraRequest(`
      query GetStepRunDetails($id: uuid!) {
        step_runs_by_pk(id: $id) {
          id
          status
          workflow_run_id
          workflow_run {
            id
            status
            workflow {
              id
              org_id
            }
          }
        }
      }
    `, { id: stepRunId });

    const stepRun = srData?.step_runs_by_pk;
    if (!stepRun) {
      return NextResponse.json({ message: "Step run not found", status: "failed", step_run_id: "00000000-0000-0000-0000-000000000000", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 404 });
    }

    const workflowRunId = stepRun.workflow_run_id;
    const orgId = stepRun.workflow_run.workflow.org_id;
    const workflowId = stepRun.workflow_run.workflow.id;

    // 2. State Validation
    if (stepRun.status !== 'paused' || stepRun.workflow_run.status !== 'paused') {
      return NextResponse.json({ message: "Approval rejected: workflow is not in a paused state.", status: "failed", step_run_id: stepRunId, workflow_run_id: workflowRunId }, { status: 400 });
    }

    // 3. Authorization Check (Cross-Org and Role Verification)
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
      return NextResponse.json({ message: "Authorization failed: not a member of this organization", status: "failed", step_run_id: stepRunId, workflow_run_id: workflowRunId }, { status: 403 });
    }
    const role = members[0].role;
    if (role !== 'owner' && role !== 'editor') {
      return NextResponse.json({ message: "Authorization failed: viewers cannot approve steps", status: "failed", step_run_id: stepRunId, workflow_run_id: workflowRunId }, { status: 403 });
    }

    // 4. Atomic Approval
    const approveData = await hasuraRequest(`
      mutation ApproveStepAtomic($id: uuid!, $userId: uuid!) {
        update_step_runs(
          where: { id: { _eq: $id }, status: { _eq: "paused" } },
          _set: { status: "completed", approved_by: $userId, approved_at: "now()" }
        ) {
          affected_rows
        }
      }
    `, { id: stepRunId, userId });

    if (approveData.update_step_runs.affected_rows === 0) {
      return NextResponse.json({ message: "Approval rejected: step is no longer paused.", status: "failed", step_run_id: stepRunId, workflow_run_id: workflowRunId }, { status: 409 });
    }

    // 5. Update workflow run to running
    await hasuraRequest(`
      mutation ResumeWorkflowRun($id: uuid!) {
        update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "running" }) {
          id
        }
      }
    `, { id: workflowRunId });

    // 6. Resume workflow execution
    console.log(`[Workflow Engine] Resuming workflow_run ${workflowRunId}`);
    const executionResult = await executeWorkflow(workflowId, workflowRunId);

    // 7. Atomic quota increment on completion ONLY if workflow finished successfully
    if (executionResult.status === 'completed') {
      const quotaData = await hasuraRequest(`
        query GetQuota($orgId: uuid!) {
          organizations_by_pk(id: $orgId) {
            quota_limit
          }
        }
      `, { orgId });
      const limit = quotaData?.organizations_by_pk?.quota_limit;
      if (limit !== undefined) {
        await hasuraRequest(`
          mutation IncrementQuotaOnCompletion($orgId: uuid!, $limit: Int!) {
            update_organizations(
              where: { id: { _eq: $orgId }, quota_used: { _lt: $limit } },
              _inc: { quota_used: 1 }
            ) {
              affected_rows
            }
          }
        `, { orgId, limit });
      }
    }

    return NextResponse.json({
      step_run_id: stepRunId,
      workflow_run_id: workflowRunId,
      status: executionResult.status,
      message: executionResult.message
    });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ message: err.message || "Internal error", status: "failed", step_run_id: "00000000-0000-0000-0000-000000000000", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 500 });
  }
}
