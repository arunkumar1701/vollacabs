const fs = require('fs');

let code = fs.readFileSync('components/WorkflowApp.tsx', 'utf8');
code = code.replace(/await createWorkflow\(\{ variables: \{ orgId: selectedOrgId, name, description: '' \} \}\);/g, `try { await createWorkflow({ variables: { orgId: selectedOrgId, name, description: '' } }); } catch(err: any) { alert(err.message); }`);

code = code.replace(/await updateWorkflow\(\{ variables: \{ id: workflow.id, name, description: workflow.description \} \}\);/g, `try { await updateWorkflow({ variables: { id: workflow.id, name, description: workflow.description } }); } catch(err: any) { alert(err.message); }`);
code = code.replace(/await deleteWorkflow\(\{ variables: \{ id: workflow.id \} \}\)/g, `deleteWorkflow({ variables: { id: workflow.id } }).catch((err: any) => alert(err.message))`);

code = code.replace(/await insertStep\(\{ variables: \{ workflowId: workflow.id, type, position, config: \{\} \} \}\);/g, `try { await insertStep({ variables: { workflowId: workflow.id, type, position, config: {} } }); } catch(err: any) { alert(err.message); }`);
code = code.replace(/await deleteStep\(\{ variables: \{ id \} \}\);/g, `try { await deleteStep({ variables: { id } }); } catch(err: any) { alert(err.message); }`);

code = code.replace(/await insertTrigger\(\{ variables: \{ workflowId: workflow.id, type, config: \{\} \} \}\);/g, `try { await insertTrigger({ variables: { workflowId: workflow.id, type, config: {} } }); } catch(err: any) { alert(err.message); }`);
code = code.replace(/await updateTrigger\(\{ variables: \{ id, config \} \}\);/g, `try { await updateTrigger({ variables: { id, config } }); } catch(err: any) { alert(err.message); }`);
code = code.replace(/await deleteTrigger\(\{ variables: \{ id \} \}\);/g, `try { await deleteTrigger({ variables: { id } }); } catch(err: any) { alert(err.message); }`);

fs.writeFileSync('components/WorkflowApp.tsx', code);
