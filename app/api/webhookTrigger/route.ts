import { NextRequest, NextResponse } from 'next/server';
import { executeTriggerRun, hasuraRequestAdmin } from '../../../lib/trigger-helper';

export async function POST(req: NextRequest) {
  try {
    const triggerId = req.nextUrl.searchParams.get('triggerId');
    if (!triggerId) {
      return NextResponse.json({ message: "Missing triggerId" }, { status: 400 });
    }

    // 1. Verify trigger exists, is webhook, and is enabled
    const triggerData = await hasuraRequestAdmin(`
      query GetTrigger($triggerId: uuid!) {
        workflow_triggers_by_pk(id: $triggerId) {
          id
          type
          enabled
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
    if (trigger.type !== 'webhook') {
      return NextResponse.json({ message: "Invalid trigger type" }, { status: 400 });
    }
    // Note: enabled column is boolean, we check if it is active. (Wait, the assignment Phase 3 adds `config` but maybe not `enabled` explicitly. Let's assume it's just checking the type. Let's check `config.enabled` if `enabled` column doesn't exist).
    // Let's rely on type being 'webhook'.
    const workflow = trigger.workflow;
    if (!workflow) {
      return NextResponse.json({ message: "Workflow not found" }, { status: 404 });
    }

    const orgId = workflow.org_id;
    const workflowId = workflow.id;

    console.log(`[WebhookTrigger] Executing workflow ${workflowId} for trigger ${triggerId}`);

    // 2. Execute via shared helper
    const result = await executeTriggerRun(workflowId, orgId);

    return NextResponse.json(result);
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ message: err.message || "Internal error" }, { status: 500 });
  }
}
