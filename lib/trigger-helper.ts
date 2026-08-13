import { executeWorkflow } from './workflow-engine';
import fs from 'fs';
import path from 'path';

export function getGraphQLUrl() {
  return process.env.NHOST_GRAPHQL_URL || 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
}

export function getAdminSecret(): string | null {
  let secret = process.env.NHOST_ADMIN_SECRET;
  
  if (!secret || secret.includes('{{') || secret.startsWith('${') || secret.includes('secrets.')) {
    try {
      const envPath = path.join(process.cwd(), '.env.local');
      if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        const match = envContent.match(/NHOST_ADMIN_SECRET\s*=\s*["']?([^"'\n]+)["']?/);
        if (match && match[1]) {
          secret = match[1].trim();
        }
      }
    } catch (err) {
      console.warn(`[getAdminSecret] Failed to read .env.local:`, err);
    }
  }

  if (!secret || secret.includes('{{') || secret.startsWith('${') || secret.includes('secrets.')) {
    return null;
  }
  return secret;
}

export async function hasuraRequestAdmin(query: string, variables: any = {}, authToken?: string) {
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
  let workflowRunId: string;
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
    console.error(`[TriggerHelper] Create workflow_run failed: ${err.message}`);
    throw err;
  }
  console.log(`[TriggerHelper] Using workflow_run ${workflowRunId} for workflow ${workflowId}`);

  // 3. Execute workflow synchronously
  const executionResult = await executeWorkflow(workflowId, workflowRunId);

  // 4. Atomic quota increment on completion
  if (executionResult.status === 'completed') {
    const incRes = await hasuraRequestAdmin(`
      mutation IncrementQuotaOnCompletion($orgId: uuid!, $limit: Int!) {
        update_organizations(
          where: { id: { _eq: $orgId }, quota_used: { _lt: $limit } },
          _inc: { quota_used: 1 }
        ) {
          affected_rows
        }
      }
    `, { orgId, limit: quota.quota_limit });
    
    // Phase 5C: Handle edge case where concurrent runs exceed limit at the exact time of completion
    if (incRes.update_organizations?.affected_rows === 0) {
      console.warn(`[Quota System] Quota for org ${orgId} was consumed concurrently. The workflow ${workflowId} completed successfully, but quota_used was not incremented to prevent exceeding quota_limit. Record clamped to max.`);
      executionResult.message += " (Note: Quota exhausted concurrently, limit enforced)";
    }
  }

  return { workflowRunId, ...executionResult };
}
