import fs from 'fs';

let passed = true;

// 1. Check if the webhookAction route exists
if (!fs.existsSync('./app/api/webhookAction/route.ts')) {
    console.error('❌ webhookAction route not found');
    passed = false;
}

const content = fs.readFileSync('./app/api/webhookAction/route.ts', 'utf8');

// 2. Check for enabled validation
if (!content.includes('trigger.enabled !== true')) {
    console.error('❌ webhook handler does not strictly enforce trigger.enabled === true');
    passed = false;
}

// 3. Check for webhook secret
if (!content.includes('configSecret = trigger.config?.webhook_secret') || !content.includes('providedSecret !== configSecret')) {
    console.error('❌ webhook handler does not properly check webhook secret');
    passed = false;
}

// 4. Check for header extraction
if (!content.includes('req.headers.get(\'x-webhook-secret\')')) {
    console.error('❌ webhook handler does not extract x-webhook-secret from headers');
    passed = false;
}

if (passed) {
    console.log('✅ Webhook Static Tests Passed!');
} else {
    process.exit(1);
}
