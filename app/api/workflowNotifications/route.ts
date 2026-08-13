import { NextRequest, NextResponse } from 'next/server';
import { getWorkflowNotifications } from '../../../lib/workflow-store';
import { getAdminSecret } from '../../../lib/trigger-helper';

function getGraphQLUrl() {
  return process.env.NHOST_GRAPHQL_URL || 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const workflowId = url.searchParams.get('workflowId') || undefined;
    const authHeader = req.headers.get('authorization') || undefined;

    let hasuraNotifications: any[] = [];
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
            query GetWorkflowNotifications($workflowId: uuid) {
              workflow_notifications(
                where: ${workflowId ? '{ workflow_id: { _eq: $workflowId } }' : '{}'},
                order_by: { created_at: desc },
                limit: 50
              ) {
                id
                workflow_id
                workflow_run_id
                step_run_id
                org_id
                channel
                payload
                status
                created_at
              }
            }
          `,
          variables: workflowId ? { workflowId } : {}
        })
      });
      const json = await res.json();
      if (json.data?.workflow_notifications) {
        hasuraNotifications = json.data.workflow_notifications;
      }
    } catch (err: any) {
      console.warn(`[API workflowNotifications] Hasura fetch failed, using local store: ${err.message}`);
    }

    const storeNotifications = getWorkflowNotifications(workflowId);
    const notifMap = new Map();

    for (const item of storeNotifications) {
      notifMap.set(item.id, item);
    }
    for (const item of hasuraNotifications) {
      notifMap.set(item.id, item);
    }

    const merged = Array.from(notifMap.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    return NextResponse.json({
      success: true,
      workflow_notifications: merged,
      count: merged.length
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
