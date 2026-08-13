import fetch from 'node-fetch';

const NHOST_GRAPHQL_URL = 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
const NHOST_AUTH_URL = 'https://aszwclgvuyolkytnqscm.auth.ap-south-1.nhost.run/v1';
const APP_URL = 'http://localhost:3000';

// Helper to log in and get JWT token
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

// Helper to execute GraphQL queries on Nhost Cloud directly
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
  return { status: res.status, data };
}

async function runAudit() {
  console.log('=== STARTING PHASE 6 STEP 1 EXECUTION RELIABILITY AUDIT ===\n');

  // 1. Authenticate users
  const ownerA = await login('owner_orga@example.com', 'Password123!');
  const editorA = await login('editor_orga@example.com', 'Password123!');
  const viewerA = await login('viewer_orga@example.com', 'Password123!');
  const ownerB = await login('owner_orgb@example.com', 'Password123!');

  console.log('Auth Tokens obtained:');
  console.log(' - Owner Org A:', ownerA.userId);
  console.log(' - Editor Org A:', editorA.userId);
  console.log(' - Viewer Org A:', viewerA.userId);
  console.log(' - Owner Org B:', ownerB.userId);

  // 2. Check current DB state
  const dbCheck = await gqlQuery(ownerA.token, `
    query CheckSchema {
      organizations { id name }
      org_members { id org_id user_id role }
      workflows { id name org_id }
      workflow_runs { id status }
    }
  `);

  console.log('\nDirect Cloud DB Initial State:');
  console.log(JSON.stringify(dbCheck.data, null, 2));
}

runAudit().catch(err => {
  console.error('Audit crashed:', err);
});
