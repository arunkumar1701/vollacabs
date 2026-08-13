import { NextRequest, NextResponse } from 'next/server';
import { executeTriggerRun, hasuraRequestAdmin } from '../../../lib/trigger-helper';
import { CronExpressionParser } from 'cron-parser';

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
    const now = new Date();
    for (const trigger of triggers) {
      if (!trigger.workflow) continue;
      
      const cronExpression = trigger.config?.cron;
      if (!cronExpression) continue; // Skip if no cron expression

      try {
        const interval = CronExpressionParser.parse(cronExpression, { currentDate: now, tz: 'UTC' });
        const prev = interval.prev().toDate();
        // Check if the cron expression was supposed to fire in the last minute (since this runs every minute)
        const diffMs = now.getTime() - prev.getTime();
        if (diffMs > 60000 || diffMs < 0) {
          console.log(`[ScheduledTrigger] Skipping trigger ${trigger.id}, schedule ${cronExpression} does not match current time.`);
          continue; // Does not match current minute
        }
      } catch (err: any) {
        console.error(`[ScheduledTrigger] Invalid cron expression for trigger ${trigger.id}:`, err.message);
        continue;
      }

      const orgId = trigger.workflow.org_id;
      const workflowId = trigger.workflow.id;
      
      console.log(`[ScheduledTrigger] Executing workflow ${workflowId} for trigger ${trigger.id} (matched cron ${cronExpression})`);
      
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
