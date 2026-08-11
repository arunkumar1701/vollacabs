import fs from 'fs';

let passed = true;
const stepRunsYaml = fs.readFileSync('./nhost/metadata/databases/default/tables/public_step_runs.yaml', 'utf8');
const workflowRunsYaml = fs.readFileSync('./nhost/metadata/databases/default/tables/public_workflow_runs.yaml', 'utf8');

if (!stepRunsYaml.includes('_eq: X-Hasura-User-Id') || !stepRunsYaml.includes('org_members:') || !stepRunsYaml.includes('organization:')) {
    console.error('❌ public_step_runs.yaml does not properly enforce organization user permissions');
    passed = false;
}

if (!workflowRunsYaml.includes('_eq: X-Hasura-User-Id') || !workflowRunsYaml.includes('org_members:') || !workflowRunsYaml.includes('organization:')) {
    console.error('❌ public_workflow_runs.yaml does not properly enforce organization user permissions');
    passed = false;
}

if (passed) {
    console.log('✅ Subscription Security Static Tests Passed!');
} else {
    process.exit(1);
}
