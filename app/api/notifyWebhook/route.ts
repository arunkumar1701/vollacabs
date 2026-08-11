import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const payload = await req.json();
    
    // Validate this comes from Hasura event triggers
    // A more secure implementation would verify an x-hasura-webhook-secret
    
    const event = payload.event;
    if (!event || event.op !== 'INSERT') {
      return NextResponse.json({ message: "Ignored non-insert event" });
    }

    const notification = event.data.new;
    console.log(`[NotifyWebhook] Received notification request ${notification.id} for workflow run ${notification.workflow_run_id}`);
    
    // STUB: Simulate network delay for Slack/email alert
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log(`[NotifyWebhook] Successfully dispatched notification to ${notification.channel}:`, notification.payload);
    
    return NextResponse.json({ success: true, message: "Notification dispatched" });
  } catch (err: any) {
    console.error("[NotifyWebhook] Error processing webhook:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
