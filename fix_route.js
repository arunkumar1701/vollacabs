const fs = require('fs');
let code = fs.readFileSync('app/api/webhookAction/route.ts', 'utf8');
code = code.replace(/trigger\.trigger_type \|\| trigger\.type/g, 'trigger.trigger_type');
code = code.replace(/          trigger\.trigger_type/g, '          trigger_type\n          type');
fs.writeFileSync('app/api/webhookAction/route.ts', code);
