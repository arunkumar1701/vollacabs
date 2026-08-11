import { executeWorkflow } from './workflow-engine';

export function getGraphQLUrl() {
  const url = process.env.NHOST_GRAPHQL_URL;
  if (!url) throw new Error("NHOST_GRAPHQL_URL is not configured");
  return url;
}

export function getAdminSecret() {
  const secret = process.env.NHOST_ADMIN_SECRET;
  if (!secret) throw new Error("NHOST_ADMIN_SECRET is not configured");
  return secret;
}

export async function hasuraRequestAdmin(query: string, variables: any = {}) {
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

export async function executeTriggerRun(workflowId: string, orgId: string) {
  // 1. Quota check
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
  if (!quota) {
    throw new Error("Organization not found");
  }

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

  // 2. Create workflow_run
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
  const workflowRunId = runData.insert_workflow_runs_one.id;
  console.log(`[TriggerHelper] Created workflow_run ${workflowRunId} for workflow ${workflowId}`);

  // 3. Execute workflow synchronously
  const executionResult = await executeWorkflow(workflowId, workflowRunId);

  // 4. Atomic quota increment on completion
  if (executionResult.status === 'completed') {
    await hasuraRequestAdmin(`
      mutation IncrementQuotaOnCompletion($orgId: uuid!, $limit: Int!) {
        update_organizations(
          where: { id: { _eq: $orgId }, quota_used: { _lt: $limit } },
          _inc: { quota_used: 1 }
        ) {
          affected_rows
        }
      }
    `, { orgId, limit: quota.quota_limit });
  }

  return { workflowRunId, ...executionResult };
}
