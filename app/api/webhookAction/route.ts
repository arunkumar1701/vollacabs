import { NextRequest, NextResponse } from 'next/server';
import { executeTriggerRun, hasuraRequestAdmin } from '../../../lib/trigger-helper';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();

    // Hasura Action payload structure:
    // { action: { name: 'triggerWebhook' }, input: { trigger_id: '...' }, session_variables: {...} }
    const triggerId = payload.input?.trigger_id;
    if (!triggerId) {
      return NextResponse.json({ message: "Missing trigger_id in input" }, { status: 400 });
    }

    // Hasura forwards headers if forward_client_headers is true.
    // However, they are injected into the req.headers.
    const providedSecret = req.headers.get('x-webhook-secret') || req.headers.get('X-Webhook-Secret');

    // 1. Verify trigger exists, is webhook, and is enabled
    const triggerData = await hasuraRequestAdmin(`
      query GetTrigger($triggerId: uuid!) {
        workflow_triggers_by_pk(id: $triggerId) {
          id
          type
          enabled
          config
          workflow {
            id
            org_id
          }
        }
      }
    `, { triggerId });

    const trigger = triggerData?.workflow_triggers_by_pk;
    if (!trigger) {
      return NextResponse.json({ message: "Trigger not found" }, { status: 404 });
    }
    
    // Validate type
    if (trigger.type !== 'webhook') {
      return NextResponse.json({ message: "Invalid trigger type" }, { status: 400 });
    }
    
    // Validate enabled
    if (trigger.enabled !== true) {
      return NextResponse.json({ message: "Webhook is disabled" }, { status: 403 });
    }

    // Validate secret
    const configSecret = trigger.config?.webhook_secret;
    if (configSecret) {
      if (!providedSecret || providedSecret !== configSecret) {
        return NextResponse.json({ message: "Unauthorized: Invalid or missing X-Webhook-Secret" }, { status: 401 });
      }
    }

    const workflow = trigger.workflow;
    if (!workflow) {
      return NextResponse.json({ message: "Workflow not found" }, { status: 404 });
    }

    const orgId = workflow.org_id;
    const workflowId = workflow.id;

    console.log(`[WebhookAction] Executing workflow ${workflowId} for trigger ${triggerId}`);

    // 2. Execute via shared helper
    const result = await executeTriggerRun(workflowId, orgId);

    // Hasura Actions expect a specific output format matching the GraphQL return type
    return NextResponse.json({
      workflow_run_id: result.workflowRunId,
      status: result.status,
      message: result.message
    });
  } catch (err: any) {
    console.error(err);
    // Hasura Action returns 400 for business logic errors
    return NextResponse.json({ message: err.message || "Internal error" }, { status: 400 });
  }
}
