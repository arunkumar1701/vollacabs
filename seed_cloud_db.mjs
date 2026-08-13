import fetch from 'node-fetch';

const NHOST_GRAPHQL_URL = 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
const NHOST_AUTH_URL = 'https://aszwclgvuyolkytnqscm.auth.ap-south-1.nhost.run/v1';

async function login(email, password) {
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

async function gqlQuery(token, query, variables = {}) {
  const res = await fetch(NHOST_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });
  const data = await res.json();
  if (data.errors) {
    console.warn(`Query Warning (Status ${res.status}):`, JSON.stringify(data.errors, null, 2));
  }
  return data;
}

async function main() {
  console.log('Logging in all test users...');
  const ownerA = await login('owner_orga@example.com', 'Password123!');
  const editorA = await login('editor_orga@example.com', 'Password123!');
  const viewerA = await login('viewer_orga@example.com', 'Password123!');
  const ownerB = await login('owner_orgb@example.com', 'Password123!');

  console.log('User IDs:');
  console.log(' - ownerA:', ownerA.userId);
  console.log(' - editorA:', editorA.userId);
  console.log(' - viewerA:', viewerA.userId);
  console.log(' - ownerB:', ownerB.userId);

  const orgAId = "11111111-1111-1111-1111-111111111111";
  const orgBId = "22222222-2222-2222-2222-222222222222";

  console.log('\n--- SEEDING ORG A (as owner_orga) ---');
  // 1. Check/Insert Org A
  const orgCheckA = await gqlQuery(ownerA.token, `
    query GetOrg($id: uuid!) {
      organizations_by_pk(id: $id) { id }
    }
  `, { id: orgAId });

  if (!orgCheckA.data?.organizations_by_pk) {
    console.log('Creating Organization A...');
    await gqlQuery(ownerA.token, `
      mutation CreateOrg($id: uuid!, $name: String!) {
        insert_organizations_one(object: { id: $id, name: $name, quota_limit: 10, quota_used: 0 }) { id }
      }
    `, { id: orgAId, name: 'Organization A' });
  } else {
    console.log('Organization A already exists.');
  }

  // 2. Add ownerA to Org A
  console.log('Adding ownerA to Org A members...');
  await gqlQuery(ownerA.token, `
    mutation AddOwner {
      insert_org_members_one(object: { org_id: "${orgAId}", user_id: "${ownerA.userId}", role: "owner" }, on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }) { id }
    }
  `);

  // 3. Add editorA to Org A (using ownerA's token)
  console.log('Adding editorA to Org A members...');
  await gqlQuery(ownerA.token, `
    mutation AddEditor {
      insert_org_members_one(object: { org_id: "${orgAId}", user_id: "${editorA.userId}", role: "editor" }, on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }) { id }
    }
  `);

  // 4. Add viewerA to Org A (using ownerA's token)
  console.log('Adding viewerA to Org A members...');
  await gqlQuery(ownerA.token, `
    mutation AddViewer {
      insert_org_members_one(object: { org_id: "${orgAId}", user_id: "${viewerA.userId}", role: "viewer" }, on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }) { id }
    }
  `);

  console.log('\n--- SEEDING ORG B (as owner_orgb) ---');
  // 1. Check/Insert Org B
  const orgCheckB = await gqlQuery(ownerB.token, `
    query GetOrg($id: uuid!) {
      organizations_by_pk(id: $id) { id }
    }
  `, { id: orgBId });

  if (!orgCheckB.data?.organizations_by_pk) {
    console.log('Creating Organization B...');
    await gqlQuery(ownerB.token, `
      mutation CreateOrg($id: uuid!, $name: String!) {
        insert_organizations_one(object: { id: $id, name: $name, quota_limit: 10, quota_used: 0 }) { id }
      }
    `, { id: orgBId, name: 'Organization B' });
  } else {
    console.log('Organization B already exists.');
  }

  // 2. Add ownerB to Org B
  console.log('Adding ownerB to Org B members...');
  await gqlQuery(ownerB.token, `
    mutation AddOwnerB {
      insert_org_members_one(object: { org_id: "${orgBId}", user_id: "${ownerB.userId}", role: "owner" }, on_conflict: { constraint: org_members_org_id_user_id_key, update_columns: [role] }) { id }
    }
  `);


  console.log('\n--- CREATING WORKFLOWS FOR ORG A ---');
  // Workflow 1: Simple Success (1 step: db_write)
  const wfSuccessId = "33333333-3333-3333-3333-333333333333";
  console.log('Creating Simple Success Workflow...');
  await gqlQuery(ownerA.token, `
    mutation CreateWfSuccess($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "Simple Success Workflow",
        description: "A workflow containing exactly one executable step",
        workflow_steps: {
          data: [
            { id: "44444444-4444-4444-4444-444444444444", name: "DB Write", position: 0, type: "db_write", config: {} }
          ]
        },
        workflow_triggers: {
          data: [
            { type: "manual", config: {}, enabled: true }
          ]
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }) { id }
    }
  `, { id: wfSuccessId, orgId: orgAId });

  // Workflow 2: Failing (1 step: failing http_request)
  const wfFailingId = "55555555-5555-5555-5555-555555555555";
  console.log('Creating Failing Workflow...');
  await gqlQuery(ownerA.token, `
    mutation CreateWfFailing($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "Failing Workflow",
        description: "A workflow that intentionally fails",
        workflow_steps: {
          data: [
            { id: "66666666-6666-6666-6666-666666666666", name: "Failing HTTP Request", position: 0, type: "http_request", config: { url: "https://this-domain-does-not-exist-123456789.com" } }
          ]
        },
        workflow_triggers: {
          data: [
            { type: "manual", config: {}, enabled: true }
          ]
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }) { id }
    }
  `, { id: wfFailingId, orgId: orgAId });

  // Workflow 3: Approval Gate (3 steps: db_write, approval_gate, db_write)
  const wfApprovalId = "77777777-7777-7777-7777-777777777777";
  console.log('Creating Approval Gate Workflow...');
  await gqlQuery(ownerA.token, `
    mutation CreateWfApproval($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "Approval Gate Workflow",
        description: "A workflow requiring manual approval",
        workflow_steps: {
          data: [
            { id: "88888888-8888-8888-8888-888888888888", name: "Pre-Approval Step", position: 0, type: "db_write", config: {} },
            { id: "99999999-9999-9999-9999-999999999999", name: "Approval Gate", position: 1, type: "approval_gate", config: {} },
            { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", name: "Post-Approval Step", position: 2, type: "db_write", config: {} }
          ]
        },
        workflow_triggers: {
          data: [
            { type: "manual", config: {}, enabled: true }
          ]
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }) { id }
    }
  `, { id: wfApprovalId, orgId: orgAId });

  console.log('\n--- CREATING WORKFLOWS FOR ORG B ---');
  const wfBId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  console.log('Creating Org B Workflow...');
  await gqlQuery(ownerB.token, `
    mutation CreateWfB($id: uuid!, $orgId: uuid!) {
      insert_workflows_one(object: {
        id: $id,
        org_id: $orgId,
        name: "Org B Workflow",
        description: "A workflow belonging to Org B",
        workflow_steps: {
          data: [
            { id: "cccccccc-cccc-cccc-cccc-cccccccccccc", name: "Org B Step", position: 0, type: "db_write", config: {} }
          ]
        },
        workflow_triggers: {
          data: [
            { type: "manual", config: {}, enabled: true }
          ]
        }
      }, on_conflict: { constraint: workflows_pkey, update_columns: [name, description] }) { id }
    }
  `, { id: wfBId, orgId: orgBId });

  console.log('\nDone seeding database!');
}

main().catch(console.error);
