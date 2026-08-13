import { NextRequest, NextResponse } from 'next/server';
import {
  addWorkflowRun,
  addStepRun,
  addWorkflowOutput,
  addWorkflowNotification,
  getWorkflowRuns
} from '../../../lib/workflow-store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const workflowId = body.workflowId || '00000000-0000-0000-0000-000000000000';
    const orgId = body.orgId || '00000000-0000-0000-0000-000000000000';

    const now = new Date();
    
    // Create 3 sample workflow runs with step runs, outputs, and notifications
    for (let i = 1; i <= 3; i++) {
      const runId = crypto.randomUUID();
      const step1Id = crypto.randomUUID();
      const step2Id = crypto.randomUUID();
      const step3Id = crypto.randomUUID();
      const outputId = crypto.randomUUID();
      const notifId = crypto.randomUUID();

      const runTime = new Date(now.getTime() - i * 600000).toISOString();
      const finishTime = new Date(now.getTime() - i * 600000 + 4000).toISOString();

      // 1. Add Workflow Run
      addWorkflowRun({
        id: runId,
        workflow_id: workflowId,
        status: i === 3 ? 'failed' : 'completed',
        input: { order_id: `ORD-${1000 + i}`, amount: 250 * i, customer: `Customer ${i}` },
        output: { result: `Processed Order ORD-${1000 + i}`, score: 0.95 - (i * 0.05) },
        started_at: runTime,
        completed_at: finishTime,
        created_at: runTime
      });

      // 2. Add Step Runs
      addStepRun({
        id: step1Id,
        workflow_run_id: runId,
        workflow_step_id: `step-llm-${i}`,
        status: 'completed',
        input: { prompt: `Analyze urgency for order ORD-${1000 + i}` },
        output: { text: `High priority order ORD-${1000 + i}. Customer tier VIP.` },
        attempt_count: 1,
        started_at: runTime,
        completed_at: new Date(now.getTime() - i * 600000 + 1000).toISOString(),
        created_at: runTime
      });

      addStepRun({
        id: step2Id,
        workflow_run_id: runId,
        workflow_step_id: `step-db-${i}`,
        status: 'completed',
        input: { record: `ORD-${1000 + i}` },
        output: { status: 'inserted', id: outputId },
        attempt_count: 1,
        started_at: new Date(now.getTime() - i * 600000 + 1500).toISOString(),
        completed_at: new Date(now.getTime() - i * 600000 + 2500).toISOString(),
        created_at: runTime
      });

      addStepRun({
        id: step3Id,
        workflow_run_id: runId,
        workflow_step_id: `step-notify-${i}`,
        status: i === 3 ? 'failed' : 'completed',
        input: { channel: 'email', recipient: `user${i}@example.com` },
        output: i === 3 ? null : { message_id: `MSG-${9000 + i}`, delivered: true },
        error: i === 3 ? 'Webhook timeout (504)' : undefined,
        attempt_count: i === 3 ? 2 : 1,
        started_at: new Date(now.getTime() - i * 600000 + 3000).toISOString(),
        completed_at: finishTime,
        created_at: runTime
      });

      // 3. Add Workflow Output
      addWorkflowOutput({
        id: outputId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        step_run_id: step2Id,
        org_id: orgId,
        data: {
          order_id: `ORD-${1000 + i}`,
          status: 'PROCESSED',
          timestamp: finishTime,
          summary: `Order ORD-${1000 + i} stored in database table workflow_outputs.`
        },
        created_at: finishTime
      });

      // 4. Add Workflow Notification
      addWorkflowNotification({
        id: notifId,
        workflow_id: workflowId,
        workflow_run_id: runId,
        step_run_id: step3Id,
        org_id: orgId,
        channel: 'slack',
        payload: {
          message: `Notification dispatched for workflow run ${runId}`,
          recipient: `#orders-channel`,
          status: i === 3 ? 'failed' : 'sent'
        },
        status: i === 3 ? 'failed' : 'delivered',
        created_at: finishTime
      });
    }

    const runs = getWorkflowRuns(workflowId);
    return NextResponse.json({
      success: true,
      message: "Successfully populated persistence tables (workflow_runs, step_runs, workflow_outputs, workflow_notifications)",
      count: runs.length
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
