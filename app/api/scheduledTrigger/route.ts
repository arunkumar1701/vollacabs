import { NextRequest, NextResponse } from 'next/server';
import { executeTriggerRun, hasuraRequestAdmin } from '../../../lib/trigger-helper';

export async function POST(req: NextRequest) {
  try {
    // Hasura Cron Triggers send a JSON payload. We don't strictly need to parse it 
    // unless we need the scheduled time. We just execute all scheduled triggers.
    
    // 1. Fetch all scheduled triggers
    const triggerData = await hasuraRequestAdmin(`
      query GetScheduledTriggers {
        workflow_triggers(where: { type: { _eq: "scheduled" } }) {
          id
          config
          workflow {
            id
            org_id
          }
        }
      }
    `);

    const triggers = triggerData?.workflow_triggers || [];
    const results = [];

    // 2. Execute each
    // In a real production system, you would check `config.cron` against the current time
    // and check `last_run_at` to avoid duplicate runs.
    for (const trigger of triggers) {
      if (!trigger.workflow) continue;
      
      const orgId = trigger.workflow.org_id;
      const workflowId = trigger.workflow.id;
      
      console.log(`[ScheduledTrigger] Executing workflow ${workflowId} for trigger ${trigger.id}`);
      
      try {
        const result = await executeTriggerRun(workflowId, orgId);
        results.push({ triggerId: trigger.id, ...result });
      } catch (err: any) {
        console.error(`[ScheduledTrigger] Failed to execute trigger ${trigger.id}:`, err);
        results.push({ triggerId: trigger.id, status: 'failed', error: err.message });
      }
    }

    return NextResponse.json({ executed: results.length, results });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ message: err.message || "Internal error" }, { status: 500 });
  }
}
