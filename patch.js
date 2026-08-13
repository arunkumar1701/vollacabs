const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

code = code.replace(
  `  const handleAddStep = async (type: string) => {\n    const position = (workflow.workflow_steps || []).length;`,
  `  const handleAddStep = async (type: string) => {\n    if (isAddingStep) return;\n    setIsAddingStep(true);\n    const position = (workflow.workflow_steps || []).length;`
);

code = code.replace(
  `    } catch(err: any) { \n       addLog('ERROR', \`Failed to add step: \${err.message}\`);\n    }\n  };`,
  `    } catch(err: any) { \n       addLog('ERROR', \`Failed to add step: \${err.message}\`);\n    } finally {\n      setIsAddingStep(false);\n    }\n  };`
);

code = code.replace(
  `  const handleAddTrigger = async (type: string) => {\n    try { `,
  `  const handleAddTrigger = async (type: string) => {\n    if (isAddingTrigger) return;\n    setIsAddingTrigger(true);\n    try { `
);

code = code.replace(
  `    } catch(err: any) {\n      addLog('ERROR', \`Failed to add trigger: \${err.message}\`);\n    }\n  };`,
  `    } catch(err: any) {\n      addLog('ERROR', \`Failed to add trigger: \${err.message}\`);\n    } finally {\n      setIsAddingTrigger(false);\n    }\n  };`
);

fs.writeFileSync('components/WorkflowApp.tsx', code);
