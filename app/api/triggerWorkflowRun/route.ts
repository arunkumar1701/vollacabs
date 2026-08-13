import { NextRequest, NextResponse } from 'next/server';
import { executeWorkflow } from '../../../lib/workflow-engine';
import { addWorkflowRun } from '../../../lib/workflow-store';
import { hasuraRequestAdmin, getAdminSecret } from '../../../lib/trigger-helper';

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
    if (action && action.name !== 'triggerWorkflowRun') {
      return NextResponse.json({ message: "Invalid action" }, { status: 400 });
    }

    const workflowId = body.input?.workflow_id || body.workflowId || body.workflow_id || '00000000-0000-0000-0000-000000000000';
    const passedRunId = body.input?.runId || body.runId || body.workflowRunId || body.input?.workflow_run_id || body.workflow_run_id;
    let userId = body.session_variables?.['x-hasura-user-id'] || body.userId;
    if (!userId && authHeader) {
      userId = getUserIdFromAuthHeader(authHeader);
    }
    if (!userId) {
      userId = 'guest-user-id';
    }

    const reqGql = (q: string, v: any = {}) => hasuraRequest(q, v, authHeader);

    let orgId = '00000000-0000-0000-0000-000000000000';

    // 1. Check if workflow exists in Hasura
    try {
      const wfData = await reqGql(`
        query GetWorkflowOrg($workflowId: uuid!) {
          workflows_by_pk(id: $workflowId) {
            id
            org_id
          }
        }
      `, { workflowId });
      
      if (wfData?.workflows_by_pk?.org_id) {
        orgId = wfData.workflows_by_pk.org_id;
      }
    } catch (err: any) {
      console.warn(`[Trigger Workflow] Workflow query bypassed: ${err.message}`);
    }

    // --- Quota Pre-check ---
    let quotaLimit = 10;
    if (orgId && orgId !== '00000000-0000-0000-0000-000000000000') {
      try {
        const quotaData = await hasuraRequestAdmin(`
          query GetQuota($orgId: uuid!) {
            organizations_by_pk(id: $orgId) {
              quota_limit
              quota_used
              quota_period_start
            }
          }
        `, { orgId });
        const quota = quotaData?.organizations_by_pk;
        if (quota) {
          quotaLimit = quota.quota_limit;
          
          // Monthly period reset (optimistic)
          const now = new Date();
          const periodStart = new Date(quota.quota_period_start);
          if (now.getUTCFullYear() > periodStart.getUTCFullYear() || now.getUTCMonth() > periodStart.getUTCMonth()) {
            await hasuraRequestAdmin(`
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

          // Soft pre-check
          if (quota.quota_used >= quota.quota_limit) {
            throw new Error("Quota exhausted");
          }
        }
      } catch (quotaErr: any) {
        console.warn(`[Trigger Workflow] Quota check failed: ${quotaErr.message}`);
        if (quotaErr.message === "Quota exhausted") {
          throw quotaErr;
        }
      }
    }

    // 2. Create or verify workflow_run (both Hasura and local store)
    let workflowRunId: string | undefined = passedRunId;
    if (workflowRunId) {
      try {
        const checkRun = await hasuraRequestAdmin(`
          query CheckRun($runId: uuid!) {
            workflow_runs_by_pk(id: $runId) {
              id
            }
          }
        `, { runId: workflowRunId });
        
        if (checkRun?.workflow_runs_by_pk) {
          // Update status to running
          await hasuraRequestAdmin(`
            mutation UpdateRunStatus($runId: uuid!) {
              update_workflow_runs_by_pk(pk_columns: { id: $runId }, _set: { status: "running" }) {
                id
              }
            }
          `, { runId: workflowRunId });
        } else {
          // Insert with specified ID
          await hasuraRequestAdmin(`
            mutation InsertRunWithId($workflowId: uuid!, $runId: uuid!) {
              insert_workflow_runs_one(object: {
                id: $runId,
                workflow_id: $workflowId,
                status: "running",
                started_at: "now()"
              }) {
                id
              }
            }
          `, { workflowId, runId: workflowRunId });
        }
      } catch (err: any) {
        console.error(`[Workflow Engine] failed to process passedRunId: ${err.message}`);
        throw err;
      }
    } else {
      try {
        const runData = await hasuraRequestAdmin(`
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
        workflowRunId = runData?.insert_workflow_runs_one?.id;
        if (!workflowRunId) {
          throw new Error("Failed to insert workflow run in database");
        }
      } catch (err: any) {
        console.error(`[Workflow Engine] insert_workflow_runs_one failed: ${err.message}`);
        throw err;
      }
    }

    console.log(`[Workflow Engine] Created Hasura workflow_run ID ${workflowRunId}`);

    // Save initial run in store
    addWorkflowRun({
      id: workflowRunId,
      workflow_id: workflowId,
      status: 'running',
      started_at: new Date().toISOString()
    });

    // 3. Execute workflow synchronously
    const executionResult = await executeWorkflow(workflowId, workflowRunId, authHeader);

    // --- Atomic quota increment on completion ---
    if (executionResult.status === 'completed' && orgId && orgId !== '00000000-0000-0000-0000-000000000000') {
      try {
        const incRes = await hasuraRequestAdmin(`
          mutation IncrementQuotaOnCompletion($orgId: uuid!, $limit: Int!) {
            update_organizations(
              where: { id: { _eq: $orgId }, quota_used: { _lt: $limit } },
              _inc: { quota_used: 1 }
            ) {
              affected_rows
            }
          }
        `, { orgId, limit: quotaLimit });
        
        if (incRes.update_organizations?.affected_rows === 0) {
          console.warn(`[Quota System] Quota for org ${orgId} was consumed concurrently.`);
          executionResult.message += " (Note: Quota exhausted concurrently, limit enforced)";
        }
      } catch (quotaIncErr: any) {
        console.error(`[Quota System] Failed to increment quota: ${quotaIncErr.message}`);
      }
    }

    return NextResponse.json({
      workflow_run_id: workflowRunId,
      status: executionResult.status,
      message: executionResult.message
    });
  } catch (err: any) {
    console.error(`[triggerWorkflowRun] Execution failed:`, err);
    return NextResponse.json({ message: err.message || "Workflow execution failed", status: "failed" }, { status: 500 });
  }
}
