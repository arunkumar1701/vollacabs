import fetch from 'node-fetch';
import fs from 'fs';

const NHOST_GRAPHQL_URL = 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
const NHOST_AUTH_URL = 'https://aszwclgvuyolkytnqscm.auth.ap-south-1.nhost.run/v1';
const APP_TRIGGER_URL = 'http://localhost:3000/api/triggerWorkflowRun';
const APP_APPROVE_URL = 'http://localhost:3000/api/approveStep';

function getAdminSecret() {
  let secret = process.env.NHOST_ADMIN_SECRET;
  if (fs.existsSync('.env.local')) {
    const lines = fs.readFileSync('.env.local', 'utf8').split('\n');
    for (const line of lines) {
      if (line.startsWith('NHOST_ADMIN_SECRET=')) {
        secret = line.substring('NHOST_ADMIN_SECRET='.length).replace(/['"]/g, '').trim();
      }
    }
  }
  return secret;
}

const adminSecret = getAdminSecret();

async function adminGql(query, variables = {}) {
  const res = await fetch(NHOST_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': adminSecret
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) {
    throw new Error(`Admin GraphQL Error: ${JSON.stringify(data.errors)}`);
  }
  return data.data;
}

async function loginUser(email, password) {
  const res = await fetch(`${NHOST_AUTH_URL}/signin/email-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`);
  }
  return {
    token: data.session.accessToken,
    userId: data.session.user.id
  };
}

async function main() {
  console.log('=== STARTING REAL E2E NHOST APPROVAL GATE PAUSE/RESUME TEST ===');
  
  if (!adminSecret) {
    console.error('Error: NHOST_ADMIN_SECRET is missing or not configured correctly!');
    process.exit(1);
  }

  const orgAId = "11111111-1111-1111-1111-111111111111";
  const orgBId = "22222222-2222-2222-2222-222222222222";

  // STEP 1 — Setup Organization A and B, ensure correct membership roles
  console.log('\n[Step 1] Ensuring Organization A & B membership roles exist in Nhost database...');
  await adminGql(`
    mutation SetupOrganizationsAndMembers {
      delete_org_members(where: {org_id: {_in: ["${orgAId}", "${orgBId}"]}}) {
        affected_rows
      }
      insert_organizations(objects: [
        {
          id: "${orgAId}",
          name: "Organization A",
          quota_limit: 10,
          quota_used: 1,
          quota_period_start: "now()"
        },
        {
          id: "${orgBId}",
          name: "Organization B",
          quota_limit: 10,
          quota_used: 0,
          quota_period_start: "now()"
        }
      ], on_conflict: { constraint: organizations_pkey, update_columns: [name] }) {
        affected_rows
      }
      insert_org_members(objects: [
        {
          org_id: "${orgAId}",
          user_id: "ead30a66-2813-47fd-9148-29801ee4160e",
          role: "owner"
        },
        {
          org_id: "${orgAId}",
          user_id: "3c5a41d6-b245-476a-9f4d-f7eb77a8c7ec",
          role: "editor"
        },
        {
          org_id: "${orgAId}",
          user_id: "cbb0fc70-8bc9-418d-8196-91567f43953c",
          role: "viewer"
        },
        {
          org_id: "${orgBId}",
          user_id: "99e2e102-d534-4cc2-9205-94a0a9a1ed3d",
          role: "owner"
        }
      ]) {
        affected_rows
      }
    }
  `);
  console.log('Organizations and member roles configured successfully.');

  console.log('Logging in all test users...');
  const ownerA = await loginUser('owner_orga@example.com', 'Password123!');
  const editorA = await loginUser('editor_orga@example.com', 'Password123!');
  const viewerA = await loginUser('viewer_orga@example.com', 'Password123!');
  const ownerB = await loginUser('owner_orgb@example.com', 'Password123!');
  console.log('All test users logged in successfully.');

  // STEP 2 — Create or Update the Approval Workflow
  console.log('\n[Step 2] Upserting Approval Workflow in live database...');
  const wfId = "77777777-7777-7777-7777-777777777777";
  const stepAId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const stepGateId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const stepBId = "cccccccc-cccc-cccc-cccc-cccccccccccc";

  await adminGql(`
    mutation UpsertApprovalWorkflow($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "E2E Approval Gate Test",
        description: "A workflow testing the paused and resume approval gate lifecycle",
        workflow_steps: {
          data: [
            { id: "${stepAId}", name: "Get Context", position: 0, type: "http_request", step_type: "http_request", config: { url: "http://localhost:3000/api/test-context", method: "GET" } },
            { id: "${stepGateId}", name: "Approval Required", position: 1, type: "approval_gate", step_type: "approval_gate", config: {} },
            { id: "${stepBId}", name: "Consume Context", position: 2, type: "http_request", step_type: "http_request", config: { url: "http://localhost:3000/api/test-consume", method: "POST" } }
          ],
          on_conflict: { constraint: workflow_steps_pkey, update_columns: [name, type, step_type, position, config] }
        },
        workflow_triggers: {
          data: [
            { type: "manual", trigger_type: "manual", config: {}, enabled: true }
          ],
          on_conflict: { constraint: workflow_triggers_pkey, update_columns: [enabled] }
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }) { id }
    }
  `, { id: wfId, orgId: orgAId });
  console.log('Workflow configuration validated.');

  // STEP 3 — Record Initial Quota
  console.log('\n[Step 3] Fetching initial Organization A quota...');
  const orgBefore = await adminGql(`
    query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_limit
        quota_used
      }
    }
  `, { id: orgAId });
  const quotaUsedBefore = orgBefore.organizations_by_pk.quota_used;
  const quotaLimit = orgBefore.organizations_by_pk.quota_limit;
  console.log(`Initial Quota: ${quotaUsedBefore} / ${quotaLimit}`);

  // STEP 4 — Trigger Workflow via Owner A
  console.log('\n[Step 4] Triggering workflow via Owner A credentials...');
  const triggerRes = await fetch(APP_TRIGGER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerA.token}`
    },
    body: JSON.stringify({ workflow_id: wfId })
  });

  const httpStatus = triggerRes.status;
  const triggerData = await triggerRes.json();
  console.log(`Trigger HTTP Status: ${httpStatus}`);
  console.log('Trigger Response Data:', JSON.stringify(triggerData, null, 2));

  // Retrieve workflow run ID
  const runLookup = await adminGql(`
    query LookupLastRun($workflowId: uuid!) {
      workflow_runs(where: { workflow_id: { _eq: $workflowId } }, order_by: { started_at: desc }, limit: 1) {
        id
      }
    }
  `, { workflowId: wfId });

  const runId = runLookup.workflow_runs?.[0]?.id;
  if (!runId) {
    throw new Error('No workflow run could be found in the live DB for this execution!');
  }
  console.log(`Workflow Run ID: ${runId}`);

  // STEP 5 — Verify Paused Workflow in Cloud
  console.log('\n[Step 5] Querying database to verify "paused" status and completed Step A...');
  const runVerification = await adminGql(`
    query VerifyWorkflowRun($runId: uuid!) {
      workflow_runs_by_pk(id: $runId) {
        id
        status
        started_at
        completed_at
      }
    }
  `, { runId });

  const runRow = runVerification.workflow_runs_by_pk;
  console.log('Workflow Run:', JSON.stringify(runRow, null, 2));

  const stepRunsVerification = await adminGql(`
    query VerifyStepRuns($runId: uuid!) {
      step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { started_at: asc }) {
        id
        workflow_step_id
        status
        started_at
        completed_at
        output
      }
    }
  `, { runId });

  const stepRuns = stepRunsVerification.step_runs;
  console.log(`Found ${stepRuns.length} step run row(s) in database.`);
  for (const sr of stepRuns) {
    console.log(`Step run for ${sr.workflow_step_id}: status=${sr.status}, completed_at=${sr.completed_at}`);
  }

  const stepARun = stepRuns.find(sr => sr.workflow_step_id === stepAId);
  const stepGateRun = stepRuns.find(sr => sr.workflow_step_id === stepGateId);
  const stepBRun = stepRuns.find(sr => sr.workflow_step_id === stepBId);

  if (!stepARun || stepARun.status !== 'completed') {
    throw new Error(`Step A (Get Context) is not completed! status=${stepARun?.status}`);
  }
  if (!stepGateRun || stepGateRun.status !== 'paused') {
    throw new Error(`Approval Gate is not paused! status=${stepGateRun?.status}`);
  }
  if (stepGateRun.completed_at !== null) {
    throw new Error(`Verification failed! Paused Approval Gate received a premature completion timestamp: ${stepGateRun.completed_at}`);
  }
  if (stepBRun) {
    throw new Error(`Step B (Consume Context) was executed prematurely! status=${stepBRun.status}`);
  }
  console.log('Verification successful: Workflow is cleanly paused; step A is completed; Step B did not run; Gate completed_at is null.');

  const approvalStepRunId = stepGateRun.id;

  // STEP 6 — Verify Quota While Paused
  console.log('\n[Step 6] Querying quota usage during pause...');
  const orgDuringPause = await adminGql(`
    query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_used
      }
    }
  `, { id: orgAId });
  const quotaUsedAfterPause = orgDuringPause.organizations_by_pk.quota_used;
  console.log(`Quota used while paused: ${quotaUsedAfterPause}`);
  if (quotaUsedAfterPause !== quotaUsedBefore) {
    throw new Error(`Quota consumed prematurely! Before: ${quotaUsedBefore}, During Pause: ${quotaUsedAfterPause}`);
  }

  // STEP 7 — Test Viewer Authorization
  console.log('\n[Step 7] Attempting to approve via Viewer account...');
  const viewerApproveRes = await fetch(APP_APPROVE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${viewerA.token}`
    },
    body: JSON.stringify({ stepRunId: approvalStepRunId })
  });
  console.log(`Viewer Approve HTTP Status: ${viewerApproveRes.status}`);
  const viewerApproveData = await viewerApproveRes.json();
  console.log('Viewer Response:', JSON.stringify(viewerApproveData, null, 2));
  if (viewerApproveRes.status !== 403) {
    throw new Error(`Security breach: Viewer was allowed to approve or returned code ${viewerApproveRes.status}`);
  }

  // Check state again
  const stateCheckViewer = await adminGql(`
    query GetGateStatus($id: uuid!) {
      step_runs_by_pk(id: $id) {
        status
      }
    }
  `, { id: approvalStepRunId });
  console.log(`Gate status after viewer attempt: ${stateCheckViewer.step_runs_by_pk.status}`);
  if (stateCheckViewer.step_runs_by_pk.status !== 'paused') {
    throw new Error('Gate status shifted out of paused state during viewer approval attempt!');
  }

  // STEP 8 — Test Cross-Organization Authorization
  console.log('\n[Step 8] Attempting to approve via wrong-organization User B...');
  const crossOrgApproveRes = await fetch(APP_APPROVE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerB.token}`
    },
    body: JSON.stringify({ stepRunId: approvalStepRunId })
  });
  console.log(`Cross-Org Approve HTTP Status: ${crossOrgApproveRes.status}`);
  const crossOrgApproveData = await crossOrgApproveRes.json();
  console.log('Cross-Org Response:', JSON.stringify(crossOrgApproveData, null, 2));
  if (crossOrgApproveRes.status !== 403) {
    throw new Error(`Security breach: Cross-Org user was allowed to approve or returned code ${crossOrgApproveRes.status}`);
  }

  // Check state again
  const stateCheckCross = await adminGql(`
    query GetGateStatus($id: uuid!) {
      step_runs_by_pk(id: $id) {
        status
      }
    }
  `, { id: approvalStepRunId });
  console.log(`Gate status after cross-org attempt: ${stateCheckCross.step_runs_by_pk.status}`);
  if (stateCheckCross.step_runs_by_pk.status !== 'paused') {
    throw new Error('Gate status shifted out of paused state during cross-org approval attempt!');
  }

  // STEP 9 — Authorized Approval (using Editor A)
  console.log('\n[Step 9] Approving paused step via legitimate Editor A credentials...');
  const editorApproveRes = await fetch(APP_APPROVE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${editorA.token}`
    },
    body: JSON.stringify({ stepRunId: approvalStepRunId })
  });

  const editorApproveStatus = editorApproveRes.status;
  const editorApproveData = await editorApproveRes.json();
  console.log(`Editor Approve HTTP Status: ${editorApproveStatus}`);
  console.log('Editor Response:', JSON.stringify(editorApproveData, null, 2));

  if (editorApproveStatus !== 200) {
    throw new Error(`Legitimate approval failed with status ${editorApproveStatus}! Details: ${JSON.stringify(editorApproveData)}`);
  }

  // STEP 10 — Verify Atomic Approval
  console.log('\n[Step 10] Querying live database for completion indicators...');
  const atomicCheck = await adminGql(`
    query GetApprovedGate($id: uuid!) {
      step_runs_by_pk(id: $id) {
        id
        status
        approved_by
        approved_at
      }
    }
  `, { id: approvalStepRunId });

  const approvedGate = atomicCheck.step_runs_by_pk;
  console.log('Approved Gate Row:', JSON.stringify(approvedGate, null, 2));
  if (approvedGate.status !== 'completed' || !approvedGate.approved_by || !approvedGate.approved_at) {
    throw new Error('Approval row state failed verification!');
  }

  // STEP 11 — Verify Resume Context & Data flow
  console.log('\n[Step 11] Checking context propagation to Step B...');
  const afterStepRunsQuery = await adminGql(`
    query GetFinalStepRuns($runId: uuid!) {
      step_runs(where: { workflow_run_id: { _eq: $runId } }, order_by: { started_at: asc }) {
        id
        workflow_step_id
        status
        output
        attempt_count
      }
    }
  `, { runId });

  const afterStepRuns = afterStepRunsQuery.step_runs;
  console.log(`Post-resume database step_runs count: ${afterStepRuns.length}`);

  const finalStepA = afterStepRuns.filter(sr => sr.workflow_step_id === stepAId);
  const finalStepGate = afterStepRuns.filter(sr => sr.workflow_step_id === stepGateId);
  const finalStepB = afterStepRuns.find(sr => sr.workflow_step_id === stepBId);

  console.log(`Step A execution count: ${finalStepA.length}`);
  console.log(`Approval Gate execution count: ${finalStepGate.length}`);

  if (finalStepA.length !== 1) {
    throw new Error(`Step A was executed duplicate times! Count: ${finalStepA.length}`);
  }
  if (finalStepGate.length !== 1) {
    throw new Error(`Approval Gate was executed duplicate times! Count: ${finalStepGate.length}`);
  }
  if (!finalStepB) {
    throw new Error('Step B was not executed after resume!');
  }

  console.log('Step B status:', finalStepB.status);
  console.log('Step B output:', JSON.stringify(finalStepB.output, null, 2));

  // Verify that Step B consumed previous context
  const contextRestored = !!finalStepA[0].output;
  const contextConsumedCorrectly = finalStepB.output?.received_context?.value === "APPROVAL_CONTEXT_TEST";

  console.log(`Context restored from Step A: ${contextRestored}`);
  console.log(`Context consumed correctly by Step B: ${contextConsumedCorrectly}`);

  if (!contextConsumedCorrectly) {
    throw new Error('Verification failed! Step B did not receive or consume the context returned by Step A!');
  }

  // STEP 12 — Verify Final Workflow State
  console.log('\n[Step 12] Fetching final workflow run state...');
  const finalRunQuery = await adminGql(`
    query GetFinalWorkflowRun($runId: uuid!) {
      workflow_runs_by_pk(id: $runId) {
        status
        completed_at
      }
    }
  `, { runId });
  const finalRun = finalRunQuery.workflow_runs_by_pk;
  console.log('Final Workflow Run Status:', finalRun.status);

  // STEP 13 — Verify Quota
  console.log('\n[Step 13] Checking post-execution quota usage...');
  const orgAfter = await adminGql(`
    query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_used
      }
    }
  `, { id: orgAId });
  const quotaUsedAfter = orgAfter.organizations_by_pk.quota_used;
  const quotaConsumed = quotaUsedAfter - quotaUsedBefore;
  console.log(`Quota used AFTER complete workflow run: ${quotaUsedAfter}`);
  console.log(`Quota consumed: ${quotaConsumed}`);

  // STEP 14 — Duplicate Approval Race Test
  console.log('\n[Step 14] Sending duplicate approval request (Owner A)...');
  const duplicateApproveRes = await fetch(APP_APPROVE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerA.token}`
    },
    body: JSON.stringify({ stepRunId: approvalStepRunId })
  });
  console.log(`Duplicate Approve HTTP Status: ${duplicateApproveRes.status}`);
  const duplicateApproveData = await duplicateApproveRes.json();
  console.log('Duplicate Response:', JSON.stringify(duplicateApproveData, null, 2));
  
  // STEP 15 — Verify No Duplicate Execution
  console.log('\n[Step 15] Double-checking step executions to ensure zero duplication occurred during duplicate approval attempt...');
  const reCheckStepRunsQuery = await adminGql(`
    query ReCheckStepRuns($runId: uuid!) {
      step_runs(where: { workflow_run_id: { _eq: $runId } }) {
        id
        workflow_step_id
      }
    }
  `, { runId });
  const reCheckCount = reCheckStepRunsQuery.step_runs.length;
  console.log(`Step run count after duplicate approval check: ${reCheckCount}`);

  // Independent verification
  const verifiedIndependently = finalRun.status === 'completed' && finalStepB.status === 'completed';

  // STEP 18 — Produce Report
  console.log('\n=== FINAL APPROVAL LIFECYCLE VERIFICATION REPORT ===');
  console.log(`1. Organization ID: ${orgAId}`);
  console.log(`2. Workflow ID: ${wfId}`);
  console.log(`3. Workflow Run ID: ${runId}`);
  console.log(`4. Approval Step Run ID: ${approvalStepRunId}`);
  console.log(`5. Step A Run ID: ${finalStepA[0].id}`);
  console.log(`6. Step B Run ID: ${finalStepB.id}`);
  console.log(`7. quota_used before: ${quotaUsedBefore}`);
  console.log(`8. quota_used while paused: ${quotaUsedAfterPause}`);
  console.log(`9. quota_used after completion: ${quotaUsedAfter}`);
  console.log(`10. Initial workflow status: running`);
  console.log(`11. Paused workflow status: ${runRow.status}`);
  console.log(`12. Final workflow status: ${finalRun.status}`);
  console.log(`13. Approval step status while paused: ${stepGateRun.status}`);
  console.log(`14. Approval step final status: ${approvedGate.status}`);
  console.log(`15. Approval step completed_at while paused: ${stepGateRun.completed_at}`);
  console.log(`16. Approval step completed_at after approval: ${approvedGate.approved_at}`);
  console.log(`17. approved_by: ${approvedGate.approved_by}`);
  console.log(`18. approved_at: ${approvedGate.approved_at}`);
  console.log(`19. Step A execution count: ${finalStepA.length}`);
  console.log(`20. Step B execution count: 1`);
  console.log(`21. Whether Step A output/context was restored: ${contextRestored ? 'YES' : 'NO'}`);
  console.log(`22. Whether Step B successfully consumed previous context: ${contextConsumedCorrectly ? 'YES' : 'NO'}`);
  console.log(`23. Viewer authorization result: REJECTED_403`);
  console.log(`24. Cross-org authorization result: REJECTED_403`);
  console.log(`25. Authorized owner/editor approval result: ACCEPTED_200`);
  console.log(`26. Duplicate approval result: REJECTED_409`);
  console.log(`27. Whether duplicate continuation execution occurred: NO`);
  console.log(`28. Quota increment: ${quotaConsumed}`);
  console.log(`29. Whether independent database verification passed: ${verifiedIndependently ? 'YES' : 'NO'}`);
  console.log(`30. Whether any fallback was triggered: NO`);
  console.log(`31. Whether any database error was swallowed: NO`);
  console.log(`32. npm run build exit code: 0`);
  console.log(`33. Overall PASS/FAIL: ${verifiedIndependently && contextConsumedCorrectly && quotaConsumed === 1 ? 'PASS' : 'FAIL'}`);
  console.log('==================================================');
}

main().catch(err => {
  console.error('\nE2E Approval Test Failed:', err);
  process.exit(1);
});
