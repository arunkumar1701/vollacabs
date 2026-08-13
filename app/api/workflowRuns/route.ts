import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowRuns } from '../../../lib/workflow-store';

function getGraphQLUrl() {
  return process.env.NHOST_GRAPHQL_URL || 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
}

function getAdminSecret(): string | null {
  const secret = process.env.NHOST_ADMIN_SECRET;
  if (!secret || secret.includes('{{') || secret.startsWith('${') || secret.includes('secrets.')) {
    return null;
  }
  return secret;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const workflowId = url.searchParams.get('workflowId') || undefined;
    const authHeader = req.headers.get('authorization') || undefined;

    // 1. Try Hasura GraphQL first
    let hasuraRuns: any[] = [];
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const adminSecret = getAdminSecret();
      if (adminSecret) {
        headers['x-hasura-admin-secret'] = adminSecret;
      } else if (authHeader) {
        headers['Authorization'] = authHeader;
      }

      const res = await fetch(getGraphQLUrl(), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          query: `
            query GetWorkflowRuns($workflowId: uuid) {
              workflow_runs(
                where: ${workflowId ? '{ workflow_id: { _eq: $workflowId } }' : '{}'},
                order_by: { started_at: desc },
                limit: 20
              ) {
                id
                workflow_id
                status
                input
                output
                error
                started_at
                completed_at
                created_at
                step_runs(order_by: { started_at: asc }) {
                  id
                  workflow_step_id
                  status
                  output
                  error
                  attempt_count
                  started_at
                  completed_at
                }
              }
            }
          `,
          variables: workflowId ? { workflowId } : {}
        })
      });
      const json = await res.json();
      if (json.data?.workflow_runs) {
        hasuraRuns = json.data.workflow_runs;
      }
    } catch (err: any) {
      console.warn(`[API workflowRuns] Hasura fetch failed, using local store: ${err.message}`);
    }

    // 2. Merge Hasura runs and local store runs
    const storeRuns = getWorkflowRuns(workflowId);
    const runMap = new Map();

    for (const item of storeRuns) {
      runMap.set(item.id, item);
    }
    for (const item of hasuraRuns) {
      runMap.set(item.id, item);
    }

    const merged = Array.from(runMap.values()).sort(
      (a, b) => new Date(b.started_at || b.created_at).getTime() - new Date(a.started_at || a.created_at).getTime()
    );

    return NextResponse.json({
      success: true,
      workflow_runs: merged,
      count: merged.length
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
