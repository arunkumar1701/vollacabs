import fs from 'fs';

let passed = true;
const content = fs.readFileSync('./app/api/scheduledTrigger/route.ts', 'utf8');

if (!content.includes('cronParser.parseExpression')) {
    console.error('❌ scheduledTrigger does not parse cron expressions');
    passed = false;
}

if (!content.includes('continue; // Does not match current minute') && !content.includes('diffMs > 60000')) {
    console.error('❌ scheduledTrigger does not enforce cron schedule properly');
    passed = false;
}

if (!content.includes('tz: \'UTC\'')) {
    console.warn('⚠️ Note: timezone behavior might not be documented/implemented clearly');
}

if (passed) {
    console.log('✅ Scheduler Static Tests Passed!');
} else {
    process.exit(1);
}
