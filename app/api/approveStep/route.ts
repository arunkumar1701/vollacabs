import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow } from '../../../lib/workflow-engine';
import { getAdminSecret } from '../../../lib/trigger-helper';

function getGraphQLUrl() {
  return process.env.NHOST_GRAPHQL_URL || 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
}

async function hasuraRequest(query: string, variables: any = {}, authToken?: string) {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const adminSecret = getAdminSecret();
  if (adminSecret) {
    headers['x-hasura-admin-secret'] = adminSecret;
  } else if (authToken) {
    headers['Authorization'] = authToken.startsWith('Bearer ') ? authToken : `Bearer ${authToken}`;
  }

  const res = await fetch(getGraphQLUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors[0].message);
  }
  return json.data;
}

function getUserIdFromAuthHeader(authHeader: string | null): string | null {
  if (!authHeader) return null;
  try {
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const payloadBase64 = token.split('.')[1];
    if (!payloadBase64) return null;
    const decoded = JSON.parse(Buffer.from(payloadBase64, 'base64').toString('utf8'));
    return decoded['https://hasura.io/jwt/claims']?.['x-hasura-user-id'] || decoded.sub || null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const authHeader = req.headers.get('authorization') || undefined;
    
    // Support both Hasura Action payload and direct API calls
    const { action } = body;
    if (action && action.name !== 'approveStep') {
      return NextResponse.json({ message: "Invalid action" }, { status: 400 });
    }

    const stepRunId = body.input?.step_run_id || body.stepRunId || body.step_run_id;
    let userId = body.session_variables?.['x-hasura-user-id'] || body.userId;
    if (!userId && authHeader) {
      userId = getUserIdFromAuthHeader(authHeader);
    }
    
    if (!userId) {
      return NextResponse.json({ message: "Authentication required", status: "failed", step_run_id: "00000000-0000-0000-0000-000000000000", workflow_run_id: "00000000-0000-0000-0000-000000000000" }, { status: 401 });
    }

    const reqGql = (q: string, v: any = {}) => hasuraRequest(q, v, authHeader);

    // 1. Fetch step_run details and relations
    const srData = await reqGql(`
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
    const memberData = await reqGql(`
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
    try {
      const approveData = await reqGql(`
        mutation ApproveStepAtomic($id: uuid!, $userId: uuid!) {
          update_step_runs(
            where: { id: { _eq: $id }, status: { _eq: "paused" } },
            _set: { status: "completed", approved_by: $userId, approved_at: "now()" }
          ) {
            affected_rows
          }
        }
      `, { id: stepRunId, userId });

      if (approveData?.update_step_runs?.affected_rows === 0) {
        return NextResponse.json({ message: "Approval rejected: step is no longer paused.", status: "failed", step_run_id: stepRunId, workflow_run_id: workflowRunId }, { status: 409 });
      }
    } catch (err: any) {
      console.error(`[approveStep] update_step_runs failed: ${err.message}`);
      throw err;
    }

    // 5. Update workflow run to running
    try {
      await reqGql(`
        mutation ResumeWorkflowRun($id: uuid!) {
          update_workflow_runs_by_pk(pk_columns: { id: $id }, _set: { status: "running" }) {
            id
          }
        }
      `, { id: workflowRunId });
    } catch (err: any) {
      console.error(`[approveStep] update_workflow_runs_by_pk failed: ${err.message}`);
      throw err;
    }

    // 6. Resume workflow execution
    console.log(`[Workflow Engine] Resuming workflow_run ${workflowRunId}`);
    const executionResult = await executeWorkflow(workflowId, workflowRunId, authHeader);

    // 7. Atomic quota increment on completion ONLY if workflow finished successfully
    if (executionResult.status === 'completed') {
      const quotaData = await reqGql(`
        query GetQuota($orgId: uuid!) {
          organizations_by_pk(id: $orgId) {
            quota_limit
          }
        }
      `, { orgId });
      const limit = quotaData?.organizations_by_pk?.quota_limit;
      if (limit !== undefined) {
        await reqGql(`
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
