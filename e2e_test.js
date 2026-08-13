const { NhostClient } = require('@nhost/nhost-js');

const nhost = new NhostClient({
  subdomain: 'aszwclgvuyolkytnqscm',
  region: 'ap-south-1',
  adminSecret: '8du6^*l1$7^T0vx9feyViQgKP@i+Xzn:'
});

async function run() {
  console.log("=== STARTING E2E AUDIT ===");
  
  // 1. & 2. Get Orgs and Users
  const qOrgs = `
    query {
      organizations {
        id
        name
        org_members {
          user_id
          role
        }
      }
    }
  `;
  const orgsRes = await nhost.graphql.request(qOrgs);
  const orgA = orgsRes.data.organizations.find(o => o.name === 'Organization A');
  const orgB = orgsRes.data.organizations.find(o => o.name === 'Organization B');
  
  const orgAOwner = orgA.org_members.find(m => m.role === 'owner').user_id;
  const orgAEditor = orgA.org_members.find(m => m.role === 'editor').user_id;
  const orgAViewer = orgA.org_members.find(m => m.role === 'viewer').user_id;
  const orgBUser = orgB.org_members[0].user_id;

  // 3 & 4. Build a workflow
  const mCreateWf = `
    mutation($orgId: uuid!) {
      insert_workflows_one(object: {
        name: "E2E Audit Workflow v4",
        org_id: $orgId
      }) {
        id
      }
    }
  `;
  const wfRes = await nhost.graphql.request(mCreateWf, { orgId: orgA.id });
  const wfId = wfRes.data.insert_workflows_one.id;
  console.log("Workflow ID:", wfId);
  
  const steps = [
    { type: 'http_request', position: 0, config: { prompt: "Say 'active'", model: 'gemini-3.5-flash' }, name: "LLM" },
    { type: 'http_request', position: 1, config: { url: "https://httpbin.org/post", method: "POST" }, name: "HTTP" },
    { type: 'conditional_branch', position: 2, config: { condition: { field: "status", operator: "equals", value: "active" } }, name: "Branch" },
    { type: 'approval_gate', position: 3, config: { approver: "approver@example.com" }, name: "Approval" }
  ];
  
  for (const step of steps) {
    const mStep = `
      mutation($wfId: uuid!, $type: String!, $pos: Int!, $config: jsonb!, $name: String!) {
        insert_workflow_steps_one(object: {
          workflow_id: $wfId,
          step_type: $type,
          type: $type,
          position: $pos,
          config: $config,
          name: $name
        }) {
          id
        }
      }
    `;
    await nhost.graphql.request(mStep, { wfId, type: step.type, pos: step.position, config: step.config, name: step.name });
  }

  // 6. Start workflow manually
  const resTrigger = await fetch('http://localhost:3000/api/triggerWorkflowRun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: wfId, userId: orgAOwner })
  });
  const dataTrigger = await resTrigger.json();
  console.log("Trigger Result:", dataTrigger);
  const runId = dataTrigger.workflow_run_id;

  // 8 & 9. Wait and verify pause state
  await new Promise(r => setTimeout(r, 6000));
  
  const qRun = `
    query($runId: uuid!) {
      workflow_runs_by_pk(id: $runId) {
        status
        step_runs {
          id
          status
          workflow_step { type }
        }
      }
    }
  `;
  const runRes = await nhost.graphql.request(qRun, { runId });
  if (runRes.error) {
     console.error("GraphQL Error:", JSON.stringify(runRes.error, null, 2));
     return;
  }
  
  const runState = runRes.data.workflow_runs_by_pk;
  console.log("Run Status:", runState.status);
  const approvalStepRun = runState.step_runs.find(s => s.workflow_step.type === 'approval_gate');
  
  if (!approvalStepRun) {
    console.log("approval_gate not found! Step runs:", JSON.stringify(runState.step_runs, null, 2));
    return;
  }
  
  console.log("Approval Step Status:", approvalStepRun.status);

  // 10 & 11. Approve as Editor
  console.log("Approving...");
  const resApprove = await fetch('http://localhost:3000/api/approveStep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stepRunId: approvalStepRun.id, userId: orgAEditor })
  });
  console.log("Approve Result:", await resApprove.json());
  
  await new Promise(r => setTimeout(r, 4000));
  
  // 12. Verify completion
  const runRes2 = await nhost.graphql.request(qRun, { runId });
  console.log("Run Status After Approval:", runRes2.data.workflow_runs_by_pk.status);
  
  // 13. Non-manual trigger (Webhook)
  const mTrig = `
    mutation($wfId: uuid!) {
      insert_workflow_triggers_one(object: {
        workflow_id: $wfId,
        trigger_type: "webhook", type: "webhook",
        config: { endpoint: "/api/webhookAction" }
      }) {
        id
      }
    }
  `;
  const trigRes = await nhost.graphql.request(mTrig, { wfId });
  console.log("trigRes:", JSON.stringify(trigRes));
  const triggerId = trigRes.data?.insert_workflow_triggers_one?.id;
  
  const resWebhook = await fetch('http://localhost:3000/api/webhookAction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-webhook-secret': 'secret123' },
    body: JSON.stringify({ input: { trigger_id: triggerId } })
  });
  console.log("Webhook Trigger Result:", await resWebhook.text());

  // 14. Cross-org isolation
  const resBadTrigger = await fetch('http://localhost:3000/api/triggerWorkflowRun', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workflowId: wfId, userId: orgBUser })
  });
  console.log("Bad Trigger Status:", resBadTrigger.status, await resBadTrigger.json());

  const resBadApprove = await fetch('http://localhost:3000/api/approveStep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stepRunId: approvalStepRun.id, userId: orgBUser })
  });
  console.log("Bad Approve Status:", resBadApprove.status, await resBadApprove.json());
}

run().catch(console.error);
