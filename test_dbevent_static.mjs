import fs from 'fs';

let passed = true;
const content = fs.readFileSync('./app/api/dbEventTrigger/route.ts', 'utf8');

if (content.includes('executeTriggerRun(payload.workflow_id')) {
    console.error('❌ dbEventTrigger trusts workflow_id from payload directly!');
    passed = false;
}

if (!content.includes('workflow_triggers(where:') || !content.includes('config: { _contains: { event_name: $eventName } }')) {
    console.error('❌ dbEventTrigger does not properly fetch triggers by eventName from trusted configuration');
    passed = false;
}

if (passed) {
    console.log('✅ DB Event Trigger Static Tests Passed!');
} else {
    process.exit(1);
}
