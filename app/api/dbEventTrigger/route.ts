import { NextRequest, NextResponse } from 'next/server';
import { executeTriggerRun, hasuraRequestAdmin } from '../../../lib/trigger-helper';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    const event = payload.event;
    
    if (!event || event.op !== 'INSERT') {
      return NextResponse.json({ message: "Ignored non-insert event" });
    }

    const appEvent = event.data.new;
    const eventName = appEvent.event_name;
    
    if (!eventName) {
      return NextResponse.json({ message: "No event_name provided" }, { status: 400 });
    }

    // 1. Fetch triggers mapped to this event_name
    // In Phase 3 schema, config is JSONB. We can filter on it using _contains in Hasura.
    // Or we fetch all database_event triggers and filter in JS if needed.
    // Let's use Hasura filtering:
    const triggerData = await hasuraRequestAdmin(`
      query GetDbEventTriggers($eventName: String!) {
        workflow_triggers(where: { 
          type: { _eq: "database_event" },
          config: { _contains: { event_name: $eventName } }
        }) {
          id
          workflow {
            id
            org_id
          }
        }
      }
    `, { eventName });

    const triggers = triggerData?.workflow_triggers || [];
    const results = [];

    // 2. Execute each
    for (const trigger of triggers) {
      if (!trigger.workflow) continue;
      
      const orgId = trigger.workflow.org_id;
      const workflowId = trigger.workflow.id;
      
      console.log(`[DbEventTrigger] Executing workflow ${workflowId} for trigger ${trigger.id} on event ${eventName}`);
      
      try {
        const result = await executeTriggerRun(workflowId, orgId);
        results.push({ triggerId: trigger.id, ...result });
      } catch (err: any) {
        console.error(`[DbEventTrigger] Failed to execute trigger ${trigger.id}:`, err);
        results.push({ triggerId: trigger.id, status: 'failed', error: err.message });
      }
    }

    return NextResponse.json({ executed: results.length, results });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ message: err.message || "Internal error" }, { status: 500 });
  }
}
