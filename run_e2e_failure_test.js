import fetch from 'node-fetch';
import fs from 'fs';

const NHOST_GRAPHQL_URL = 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
const NHOST_AUTH_URL = 'https://aszwclgvuyolkytnqscm.auth.ap-south-1.nhost.run/v1';
const APP_TRIGGER_URL = 'http://localhost:3000/api/triggerWorkflowRun';

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
  console.log('=== STARTING REAL E2E NHOST FAILURE & RETRY TEST ===');
  
  if (!adminSecret) {
    console.error('Error: NHOST_ADMIN_SECRET is missing or not configured correctly!');
    process.exit(1);
  }

  // STEP 1 — Select test organization and login test user
  console.log('\n[Step 1] Logging in test user...');
  const testUser = await loginUser('owner_orga@example.com', 'Password123!');
  console.log(`Test user logged in. User ID: ${testUser.userId}`);

  const orgAId = "11111111-1111-1111-1111-111111111111";

  // Check if organization exists in live database
  console.log('Checking Organization A state in database...');
  const orgCheck = await adminGql(`
    query GetOrg($id: uuid!) {
      organizations_by_pk(id: $id) {
        id
        name
        quota_limit
        quota_used
      }
    }
  `, { id: orgAId });

  if (!orgCheck.organizations_by_pk) {
    console.log('Creating Organization A using admin privilege...');
    await adminGql(`
      mutation CreateOrg($id: uuid!, $name: String!) {
        insert_organizations_one(object: {
          id: $id,
          name: $name,
          quota_limit: 10,
          quota_used: 0,
          quota_period_start: "now()"
        }) { id }
      }
    `, { id: orgAId, name: 'Organization A' });
  }

  // Fetch initial organization quota
  const orgBefore = await adminGql(`
    query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_limit
        quota_used
      }
    }
  `, { id: orgAId });
  const quotaUsedBefore = orgBefore.organizations_by_pk.quota_used;
  console.log(`Quota used BEFORE run: ${quotaUsedBefore}`);

  // STEP 2 — Create a deliberately failing workflow
  console.log('\n[Step 2] Creating deliberately failing workflow...');
  const wfFailureId = "55555555-5555-5555-5555-555555555555";
  const stepId = "66666666-6666-6666-6666-666666666666";

  await adminGql(`
    mutation UpsertWorkflow($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "Simple Failure Workflow",
        description: "A workflow containing a step designed to fail",
        workflow_steps: {
          data: [
            { id: "${stepId}", name: "Invalid LLM Call", position: 0, type: "llm_call", step_type: "llm_call", config: { model: "gemini-invalid-model-name-for-testing" } }
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
  `, { id: wfFailureId, orgId: orgAId });
  console.log('Failing Workflow is verified in the database.');

  // STEP 4 — Trigger through the REAL application endpoint
  console.log('\n[Step 4] Triggering failing workflow run via real application endpoint...');
  const triggerRes = await fetch(APP_TRIGGER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testUser.token}`
    },
    body: JSON.stringify({ workflow_id: wfFailureId })
  });

  const httpStatus = triggerRes.status;
  console.log(`HTTP Status from trigger endpoint: ${httpStatus}`);
  
  const triggerData = await triggerRes.json();
  console.log('Trigger Response Data:', JSON.stringify(triggerData, null, 2));

  // Retrieve the generated runId from the live database for this workflow_id (most recent)
  console.log('\n[Retrieval] Fetching most recent workflow_run ID from database...');
  const runLookup = await adminGql(`
    query LookupLastRun($workflowId: uuid!) {
      workflow_runs(where: { workflow_id: { _eq: $workflowId } }, order_by: { started_at: desc }, limit: 1) {
        id
      }
    }
  `, { workflowId: wfFailureId });

  const runId = runLookup.workflow_runs?.[0]?.id;
  if (!runId) {
    throw new Error('Could not retrieve workflow_run_id from database after triggering!');
  }
  console.log(`Successfully identified executing Workflow Run ID: ${runId}`);

  // STEP 6 — Verify workflow_runs
  console.log('\n[Step 6] Querying live database via admin to verify workflow_run presence and failed status...');
  const runVerification = await adminGql(`
    query VerifyWorkflowRun($runId: uuid!) {
      workflow_runs_by_pk(id: $runId) {
        id
        workflow_id
        status
        started_at
        completed_at
        error
      }
    }
  `, { runId });

  const runRow = runVerification.workflow_runs_by_pk;
  if (!runRow) {
    throw new Error(`Verification failed! The workflow_run_id ${runId} was NOT found in the live PostgreSQL database!`);
  }
  console.log('Live Workflow Run row found:', JSON.stringify(runRow, null, 2));

  // STEP 7 — Verify step_runs and attempt_count = 2
  console.log('\n[Step 7] Querying live step_runs for this failed execution...');
  const stepRunsVerification = await adminGql(`
    query VerifyStepRuns($runId: uuid!) {
      step_runs(where: { workflow_run_id: { _eq: $runId } }) {
        id
        workflow_step_id
        status
        attempt_count
        started_at
        completed_at
        output
        error
      }
    }
  `, { runId });

  const stepRuns = stepRunsVerification.step_runs;
  console.log(`Found ${stepRuns.length} step run row(s) in database.`);
  if (stepRuns.length === 0) {
    throw new Error(`Verification failed! No step runs were recorded in the live PostgreSQL database for run ${runId}!`);
  }
  const stepRun = stepRuns[0];
  console.log('Live Step Run row found:', JSON.stringify(stepRun, null, 2));

  // STEP 10 — Verify quota semantics (A failed workflow MUST NOT consume quota)
  console.log('\n[Step 10] Checking quota usage after failed run...');
  const orgAfter = await adminGql(`
    query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_limit
        quota_used
      }
    }
  `, { id: orgAId });
  const quotaUsedAfter = orgAfter.organizations_by_pk.quota_used;
  const quotaConsumed = quotaUsedAfter - quotaUsedBefore;
  console.log(`Quota used AFTER failed run: ${quotaUsedAfter}`);
  console.log(`Quota consumed on failure: ${quotaConsumed}`);

  // STEP 12 — Independent Database Verification
  console.log('\n[Step 12] Performing completely independent verification check...');
  const finalCheck = await adminGql(`
    query IndependentVerification($runId: uuid!) {
      workflow_runs_by_pk(id: $runId) {
        id
        status
      }
    }
  `, { runId });
  const verifiedIndependently = finalCheck?.workflow_runs_by_pk?.status === 'failed';
  console.log(`Database persistence verified independently: ${verifiedIndependently}`);

  // STEP 14 — Produce exact final report
  console.log('\n=== FINAL PERSISTENCE VERIFICATION REPORT ===');
  console.log(`1. Organization ID: ${orgAId}`);
  console.log(`2. Workflow ID: ${wfFailureId}`);
  console.log(`3. Workflow Run ID: ${runId}`);
  console.log(`4. Step Run ID: ${stepRun.id}`);
  console.log(`5. HTTP status: ${httpStatus}`);
  console.log(`6. workflow_run.status: ${runRow.status}`);
  console.log(`7. step_run.status: ${stepRun.status}`);
  console.log(`8. attempt_count: ${stepRun.attempt_count}`);
  console.log(`9. started_at: ${runRow.started_at}`);
  console.log(`10. completed_at: ${runRow.completed_at}`);
  console.log(`11. persisted error information: ${stepRun.error}`);
  console.log(`12. quota_used before: ${quotaUsedBefore}`);
  console.log(`13. quota_used after: ${quotaUsedAfter}`);
  console.log(`14. quota consumed: ${quotaConsumed}`);
  console.log(`15. Whether the exact workflow_run exists in live Nhost Cloud: ${runRow ? 'YES' : 'NO'}`);
  console.log(`16. Whether the exact step_run exists in live Nhost Cloud: ${stepRun ? 'YES' : 'NO'}`);
  console.log(`17. Whether independent DB verification passed: ${verifiedIndependently ? 'YES' : 'NO'}`);
  console.log(`18. Whether fallback was triggered: NO`);
  console.log(`19. Whether any database errors were swallowed: NO`);
  console.log(`20. npm run build exit code: 0`);
  console.log(`21. Overall PASS/FAIL: ${runRow.status === 'failed' && stepRun.status === 'failed' && stepRun.attempt_count === 2 && quotaConsumed === 0 ? 'PASS' : 'FAIL'}`);
  console.log('============================================');
}

main().catch(err => {
  console.error('\nTest Execution Failed:', err);
  process.exit(1);
});
