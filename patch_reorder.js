const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

// Add states for editing
code = code.replace(
  `  const [approvingSteps, setApprovingSteps] = useState<Record<string, boolean>>({});`,
  `  const [approvingSteps, setApprovingSteps] = useState<Record<string, boolean>>({});\n  const [editingStep, setEditingStep] = useState<any>(null);\n  const [editingTrigger, setEditingTrigger] = useState<any>(null);\n  const [isReordering, setIsReordering] = useState(false);\n  const [isSavingConfig, setIsSavingConfig] = useState(false);`
);

fs.writeFileSync('components/WorkflowApp.tsx', code);
