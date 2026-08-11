const fs = require('fs');

let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');
code = code.replace(/await updateStep\(\{ variables: \{ id: step.id, position: step.position, config: JSON.parse\(e.target.value\) \} \}\);/g, `try { await updateStep({ variables: { id: step.id, position: step.position, config: JSON.parse(e.target.value) } }); } catch(err: any) { alert(err.message); }`);

fs.writeFileSync('components/WorkflowApp.tsx', code);
