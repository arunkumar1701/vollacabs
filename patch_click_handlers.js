const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

// For steps: find the step card wrapper div and add onClick and class cursor-pointer
const stepCardTarget = `                      <div className="flex flex-col gap-1 w-full">`;
const stepCardReplacement = `                      <div className={\`flex flex-col gap-1 w-full \${canEditWorkflow ? 'cursor-pointer hover:bg-slate-900/40 rounded-lg p-1 transition-colors' : ''}\`} onClick={() => canEditWorkflow && setEditingStep(step)}>`;

code = code.replace(stepCardTarget, stepCardReplacement);

// For triggers: find the trigger item and add onClick
const triggerItemTarget = `                          <div key={trigger.id} className="flex justify-between items-center bg-slate-900 border border-slate-800 p-2.5 rounded-xl">`;
const triggerItemReplacement = `                          <div key={trigger.id} className={\`flex justify-between items-center bg-slate-900 border border-slate-800 p-2.5 rounded-xl \${canEditWorkflow ? 'cursor-pointer hover:border-slate-700 transition-colors' : ''}\`} onClick={() => canEditWorkflow && setEditingTrigger(trigger)}>`;

code = code.replace(triggerItemTarget, triggerItemReplacement);


fs.writeFileSync('components/WorkflowApp.tsx', code);
