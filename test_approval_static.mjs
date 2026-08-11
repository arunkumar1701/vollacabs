import { POST } from './app/api/approveStep/route.ts';
import assert from 'assert';

// We will mock global fetch and process.env
process.env.NHOST_GRAPHQL_URL = 'http://localhost:8080/v1/graphql';
process.env.NHOST_ADMIN_SECRET = 'test-secret';

let fetchMocks = [];

global.fetch = async (url, options) => {
  if (fetchMocks.length > 0) {
    const handler = fetchMocks.shift();
    return handler(url, options);
  }
  throw new Error("No fetch mock provided");
};

class MockRequest {
  constructor(body) {
    this.body = body;
  }
  async json() {
    return this.body;
  }
}

class MockResponse {
  static json(body, init) {
    return {
      status: init?.status || 200,
      json: async () => body
    };
  }
}

// Mock NextResponse
import * as NextServer from 'next/server.js';
NextServer.NextResponse = MockResponse;

async function runTest(name, body, mocks, expectedStatus) {
  console.log(`Running test: ${name}`);
  fetchMocks = mocks;
  const req = new MockRequest(body);
  const res = await POST(req);
  const data = await res.json();
  console.log(`  Expected HTTP: ${expectedStatus}, Actual: ${res.status}`);
  console.log(`  Message: ${data.message}`);
  assert.strictEqual(res.status, expectedStatus, `Test ${name} failed`);
}

async function main() {
  console.log("STATIC / UNIT TESTS FOR PHASE 5B");
  console.log("================================");

  // Mocks for a happy path
  const orgAMemberMockOwner = async () => ({
    ok: true, json: async () => ({ data: { org_members: [{ id: 'm1', role: 'owner' }] } })
  });
  
  const orgAMemberMockEditor = async () => ({
    ok: true, json: async () => ({ data: { org_members: [{ id: 'm2', role: 'editor' }] } })
  });

  const orgAMemberMockViewer = async () => ({
    ok: true, json: async () => ({ data: { org_members: [{ id: 'm3', role: 'viewer' }] } })
  });

  const orgBMemberMockOwner = async () => ({
    ok: true, json: async () => ({ data: { org_members: [] } })
  });

  const stepRunDetailsMock = async () => ({
    ok: true, json: async () => ({ data: {
      step_runs_by_pk: {
        id: 's1', status: 'paused', workflow_run_id: 'w1',
        workflow_run: { id: 'w1', status: 'paused', workflow: { id: 'wf1', org_id: 'orgA' } }
      }
    } })
  });

  const atomicApproveSuccess = async () => ({
    ok: true, json: async () => ({ data: { update_step_runs: { affected_rows: 1 } } })
  });

  const atomicApproveFail = async () => ({
    ok: true, json: async () => ({ data: { update_step_runs: { affected_rows: 0 } } })
  });

  const resumeWorkflowRunSuccess = async () => ({
    ok: true, json: async () => ({ data: { update_workflow_runs_by_pk: { id: 'w1' } } })
  });
  
  const executeWorkflowMocks = [
    async () => ({ ok: true, json: async () => ({ data: { workflows_by_pk: { workflow_steps: [] }, step_runs: [] } }) }), // get steps
    async () => ({ ok: true, json: async () => ({ data: { update_workflow_runs_by_pk: { id: 'w1' } } }) }) // complete run
  ];

  const payload = { action: { name: 'approveStep' }, input: { step_run_id: 's1' }, session_variables: { 'x-hasura-user-id': 'u1' } };

  // A. owner approves Org A → allowed
  await runTest('A. owner approves Org A', payload, [
    stepRunDetailsMock, orgAMemberMockOwner, atomicApproveSuccess, resumeWorkflowRunSuccess, ...executeWorkflowMocks
  ], 200);

  // B. editor approves Org A → allowed
  await runTest('B. editor approves Org A', payload, [
    stepRunDetailsMock, orgAMemberMockEditor, atomicApproveSuccess, resumeWorkflowRunSuccess, ...executeWorkflowMocks
  ], 200);

  // C. viewer approves Org A → denied
  await runTest('C. viewer approves Org A', payload, [
    stepRunDetailsMock, orgAMemberMockViewer
  ], 403);

  // D/E. Org B owner/editor approves Org A → denied
  await runTest('D/E. Org B owner approves Org A (cross-org)', payload, [
    stepRunDetailsMock, orgBMemberMockOwner
  ], 403);

  // F. unknown step_run UUID → denied/not found
  await runTest('F. unknown step_run', payload, [
    async () => ({ ok: true, json: async () => ({ data: { step_runs_by_pk: null } }) })
  ], 404);

  // G/H. already approved or non-paused step → rejected
  await runTest('G/H. non-paused step', payload, [
    async () => ({ ok: true, json: async () => ({ data: {
      step_runs_by_pk: { status: 'completed', workflow_run_id: 'w1', workflow_run: { status: 'running', workflow: { org_id: 'orgA' } } }
    } }) })
  ], 400);

  // I. simultaneous approval attempts
  await runTest('I. simultaneous approval attempts (second fails atomic check)', payload, [
    stepRunDetailsMock, orgAMemberMockOwner, atomicApproveFail
  ], 409);
  
  console.log("All static unit tests passed!");
}

main().catch(console.error);
