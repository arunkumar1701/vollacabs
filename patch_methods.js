const fs = require('fs');
let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');

const newMethods = `
  const handleReorderStep = async (step: any, direction: 'up' | 'down') => {
    if (isReordering) return;
    const sortedSteps = [...(workflow.workflow_steps || [])].sort((a: any, b: any) => a.position - b.position);
    const currentIndex = sortedSteps.findIndex((s: any) => s.id === step.id);
    if (direction === 'up' && currentIndex <= 0) return;
    if (direction === 'down' && currentIndex >= sortedSteps.length - 1) return;

    setIsReordering(true);
    const swapStep = sortedSteps[direction === 'up' ? currentIndex - 1 : currentIndex + 1];
    
    try {
      // Step 1: Move target to a temporary safe position (-1)
      await updateStepMutation({ variables: { id: step.id, _set: { position: -1 } } });
      // Step 2: Move swapStep to target's original position
      await updateStepMutation({ variables: { id: swapStep.id, _set: { position: step.position } } });
      // Step 3: Move target from -1 to swapStep's original position
      await updateStepMutation({ variables: { id: step.id, _set: { position: swapStep.position } } });
      
      addLog('GQL', \`Reordered step "\${step.name}".\`);
      refetch();
    } catch (err: any) {
      addLog('ERROR', \`Reorder failed: \${err.message}\`);
    } finally {
      setIsReordering(false);
    }
  };

  const handleSaveStepConfig = async (id: string, config: any) => {
    if (isSavingConfig) return;
    setIsSavingConfig(true);
    try {
      await updateStepMutation({ variables: { id, _set: { config } } });
      addLog('GQL', \`Updated step configuration.\`);
      setEditingStep(null);
      refetch();
    } catch (err: any) {
      addLog('ERROR', \`Failed to save config: \${err.message}\`);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleSaveTriggerConfig = async (id: string, config: any, enabled: boolean) => {
    if (isSavingConfig) return;
    setIsSavingConfig(true);
    try {
      await updateTriggerMutation({ variables: { id, _set: { config, enabled } } });
      addLog('GQL', \`Updated trigger configuration.\`);
      setEditingTrigger(null);
      refetch();
    } catch (err: any) {
      addLog('ERROR', \`Failed to save trigger config: \${err.message}\`);
    } finally {
      setIsSavingConfig(false);
    }
  };
`;

code = code.replace(
  `  const handleDeleteStep = async (id: string, index: number) => {`,
  newMethods + `\n  const handleDeleteStep = async (id: string, index: number) => {`
);

fs.writeFileSync('components/WorkflowApp.tsx', code);
