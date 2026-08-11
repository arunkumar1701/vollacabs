fetch('http://localhost:3000/api/triggerWorkflowRun', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    action: { name: 'triggerWorkflowRun' },
    input: { workflow_id: "00000000-0000-0000-0000-000000000000" },
    session_variables: { 'x-hasura-user-id': '00000000-0000-0000-0000-000000000000' }
  })
}).then(res => res.json()).then(console.log).catch(console.error);
