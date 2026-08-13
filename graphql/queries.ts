import { gql } from '@apollo/client';

export const GET_ORGANIZATIONS = gql`
  query GetOrganizations {
    organizations {
      id
      name
      quota_used
      quota_limit
      org_members {
        role
        user_id
      }
    }
  }
`;

export const GET_WORKFLOWS = gql`
  query GetWorkflows($orgId: uuid!) {
    workflows(where: { org_id: { _eq: $orgId } }, order_by: { updated_at: desc }) {
      id
      name
      description
      status
      created_at
      updated_at
      workflow_steps(order_by: { position: asc }) {
        id
        type
        step_type
        name
        position
        config
      }
      workflow_triggers {
        id
        type
        config
        enabled
      }
      workflow_runs(order_by: { started_at: desc }, limit: 1) {
        id
        status
        started_at
        completed_at
        step_runs(where: { status: { _eq: "paused" } }, limit: 1) {
          id
        }
      }
    }
  }
`;

export const SUBSCRIBE_WORKFLOW_RUN = gql`
  subscription SubscribeWorkflowRun($workflowId: uuid!) {
    workflow_runs(where: { workflow_id: { _eq: $workflowId } }, order_by: { started_at: desc }, limit: 1) {
      id
      status
      started_at
      completed_at
      error
      step_runs(order_by: { started_at: asc }) {
        id
        workflow_step_id
        status
        attempt_count
        error
        started_at
        completed_at
      }
    }
  }
`;
