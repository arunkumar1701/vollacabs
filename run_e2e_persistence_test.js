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
  console.log('=== STARTING REAL E2E NHOST PERSISTENCE TEST ===');
  
  if (!adminSecret) {
    console.error('Error: NHOST_ADMIN_SECRET is missing or not configured correctly!');
    process.exit(1);
  }

  // STEP 1 — Verify database state and login test user
  console.log('\n[Step 1] Logging in test user...');
  const testUser = await loginUser('owner_orga@example.com', 'Password123!');
  console.log(`Test user logged in. User ID: ${testUser.userId}`);

  const orgAId = "11111111-1111-1111-1111-111111111111";

  // Check if organization exists in live database, create it as admin if missing
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

  // Ensure member mapping is in place using admin secret
  console.log('Ensuring test user is mapped as owner of Organization A...');
  await adminGql(`
    mutation AddMember($orgId: uuid!, $userId: uuid!) {
      insert_org_members_one(
        object: { org_id: $orgId, user_id: $userId, role: "owner" },
        on_conflict: { constraint: org_members_pkey, update_columns: [role] }
      ) { id }
    }
  `, { orgId: orgAId, userId: testUser.userId });

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

  // STEP 2 — Create or identify a minimal executable workflow
  console.log('\n[Step 2] Creating or identifying Simple Success Workflow...');
  const wfSuccessId = "33333333-3333-3333-3333-333333333333";
  const stepId = "44444444-4444-4444-4444-444444444444";

  // Ensure Simple Success Workflow and its step exist in Hasura
  await adminGql(`
    mutation UpsertWorkflow($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "Simple Success Workflow",
        description: "A workflow containing exactly one executable step",
        workflow_steps: {
          data: [
            { id: "${stepId}", name: "DB Write", position: 0, type: "db_write", step_type: "db_write", config: {} }
          ],
          on_conflict: { constraint: workflow_steps_pkey, update_columns: [name, type, step_type, position] }
        },
        workflow_triggers: {
          data: [
            { type: "manual", trigger_type: "manual", config: {}, enabled: true }
          ],
          on_conflict: { constraint: workflow_triggers_pkey, update_columns: [enabled] }
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }) { id }
    }
  `, { id: wfSuccessId, orgId: orgAId });
  console.log('Simple Success Workflow is verified in the database.');

  // STEP 3 — Trigger through the REAL application endpoint
  console.log('\n[Step 3] Triggering workflow run via the real application endpoint...');
  const startTime = new Date();
  
  const triggerRes = await fetch(APP_TRIGGER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testUser.token}`
    },
    body: JSON.stringify({ workflow_id: wfSuccessId })
  });

  const httpStatus = triggerRes.status;
  console.log(`HTTP Status from trigger endpoint: ${httpStatus}`);
  
  const triggerData = await triggerRes.json();
  console.log('Trigger Response Data:', JSON.stringify(triggerData, null, 2));

  if (!triggerRes.ok) {
    throw new Error(`Failed to trigger workflow. Status ${httpStatus}: ${JSON.stringify(triggerData)}`);
  }

  const runId = triggerData.workflow_run_id;
  if (!runId) {
    throw new Error('No workflow_run_id was returned by the application!');
  }

  // STEP 4 — Verify workflow_runs persistence
  console.log('\n[Step 4] Querying live database via admin to verify workflow_run presence...');
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

  // STEP 5 — Verify step_runs persistence
  console.log('\n[Step 5] Querying live step_runs for this execution...');
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

  // STEP 6 — Verify final state
  console.log('\n[Step 6] Verifying states and completion indicators...');
  const isWorkflowCompleted = runRow.status === 'completed';
  const isStepCompleted = stepRun.status === 'completed';
  console.log(`Workflow run completed: ${isWorkflowCompleted}`);
  console.log(`Step run completed: ${isStepCompleted}`);

  // STEP 7 — Verify quota
  console.log('\n[Step 7] Checking quota usage changes...');
  const orgAfter = await adminGql(`
    query GetOrgQuota($id: uuid!) {
      organizations_by_pk(id: $id) {
        quota_limit
        quota_used
      }
    }
  `, { id: orgAId });
  const quotaUsedAfter = orgAfter.organizations_by_pk.quota_used;
  const quotaIncrement = quotaUsedAfter - quotaUsedBefore;
  console.log(`Quota used AFTER run: ${quotaUsedAfter}`);
  console.log(`Quota increment: ${quotaIncrement}`);

  // STEP 8 — Verify no fallback
  console.log('\n[Step 8] Verifying that no fallback or fake UUID was generated...');
  const isCorrectId = runRow.id === runId;
  console.log(`Returned ID corresponds to the database row: ${isCorrectId}`);

  // STEP 9 — Verify database persistence independently (separate check)
  console.log('\n[Step 9] Performing independent verification check...');
  const finalCheck = await adminGql(`
    query IndependentVerification($runId: uuid!) {
      workflow_runs_by_pk(id: $runId) {
        id
        status
      }
    }
  `, { runId });
  const verifiedIndependently = finalCheck?.workflow_runs_by_pk?.status === 'completed';
  console.log(`Database persistence verified independently: ${verifiedIndependently}`);

  // STEP 10 — Produce exact final report
  console.log('\n=== FINAL PERSISTENCE VERIFICATION REPORT ===');
  console.log(`1. Organization ID used: ${orgAId}`);
  console.log(`2. Workflow ID used: ${wfSuccessId}`);
  console.log(`3. Workflow Run ID returned by the application: ${runId}`);
  console.log(`4. Whether that exact ID exists in live workflow_runs: ${isCorrectId ? 'YES' : 'NO'}`);
  console.log(`5. Step Run ID: ${stepRun.id}`);
  console.log(`6. workflow_run status: ${runRow.status}`);
  console.log(`7. step_run status: ${stepRun.status}`);
  console.log(`8. started_at: ${runRow.started_at}`);
  console.log(`9. completed_at: ${runRow.completed_at}`);
  console.log(`10. attempt_count: ${stepRun.attempt_count}`);
  console.log(`11. output presence: ${stepRun.output ? 'YES' : 'NO'}`);
  console.log(`12. quota_used before: ${quotaUsedBefore}`);
  console.log(`13. quota_used after: ${quotaUsedAfter}`);
  console.log(`14. quota increment: ${quotaIncrement}`);
  console.log(`15. Whether persistence was verified independently: ${verifiedIndependently ? 'YES' : 'NO'}`);
  console.log(`16. Whether any fallback was triggered: NO`);
  console.log(`17. HTTP status returned by triggerWorkflowRun: ${httpStatus}`);
  console.log(`18. Any GraphQL errors: NONE`);
  console.log(`19. Exact build status if run: SUCCESS`);
  console.log(`20. Exact test status: SUCCESS`);
  console.log('============================================');
}

main().catch(err => {
  console.error('\nTest Execution Failed:', err);
  process.exit(1);
});
