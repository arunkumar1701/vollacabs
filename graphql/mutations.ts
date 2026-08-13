import { gql } from '@apollo/client';

export const CREATE_WORKFLOW = gql`
  mutation CreateWorkflow($orgId: uuid!, $name: String!, $description: String) {
    insert_workflows_one(object: { org_id: $orgId, name: $name, description: $description }) {
      id
      name
      description
      status
    }
  }
`;

export const UPDATE_WORKFLOW = gql`
  mutation UpdateWorkflow($id: uuid!, $name: String!, $description: String) {
    update_workflows_by_pk(pk_columns: { id: $id }, _set: { name: $name, description: $description }) {
      id
      name
      description
    }
  }
`;

export const DELETE_WORKFLOW = gql`
  mutation DeleteWorkflow($id: uuid!) {
    delete_workflows_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_WORKFLOW_STEP = gql`
  mutation InsertWorkflowStep($workflowId: uuid!, $type: String!, $position: Int!, $config: jsonb!, $name: String!) {
    insert_workflow_steps_one(object: { workflow_id: $workflowId, type: $type, step_type: $type, position: $position, config: $config, name: $name }) {
      id
      type
      step_type
      position
      config
      name
    }
  }
`;

export const UPDATE_WORKFLOW_STEP = gql`
  mutation UpdateWorkflowStep($id: uuid!, $position: Int, $config: jsonb) {
    update_workflow_steps_by_pk(pk_columns: { id: $id }, _set: { position: $position, config: $config }) {
      id
      position
      config
    }
  }
`;

export const DELETE_WORKFLOW_STEP = gql`
  mutation DeleteWorkflowStep($id: uuid!) {
    delete_workflow_steps_by_pk(id: $id) {
      id
    }
  }
`;

export const INSERT_WORKFLOW_TRIGGER = gql`
  mutation InsertWorkflowTrigger($workflowId: uuid!, $type: String!, $config: jsonb!) {
    insert_workflow_triggers_one(object: { workflow_id: $workflowId, type: $type, trigger_type: $type, config: $config }) {
      id
      type
      trigger_type
      config
      enabled
    }
  }
`;

export const UPDATE_WORKFLOW_TRIGGER = gql`
  mutation UpdateWorkflowTrigger($id: uuid!, $config: jsonb, $enabled: Boolean) {
    update_workflow_triggers_by_pk(pk_columns: { id: $id }, _set: { config: $config, enabled: $enabled }) {
      id
      config
      enabled
    }
  }
`;

export const DELETE_WORKFLOW_TRIGGER = gql`
  mutation DeleteWorkflowTrigger($id: uuid!) {
    delete_workflow_triggers_by_pk(id: $id) {
      id
    }
  }
`;

export const APPROVE_STEP = gql`
  mutation ApproveStep($stepRunId: uuid!) {
    approveStep(step_run_id: $stepRunId) {
      step_run_id
      workflow_run_id
      status
      message
    }
  }
`;
