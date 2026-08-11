const fs = require('fs');
const yaml = require('js-yaml');

const dir = './nhost/metadata/databases/default/tables/';

function updateTable(tableName, config) {
  const file = `${dir}public_${tableName}.yaml`;
  let doc = yaml.load(fs.readFileSync(file, 'utf8'));
  
  if (config.object_relationships) {
    doc.object_relationships = doc.object_relationships || [];
    config.object_relationships.forEach(rel => {
      if (!doc.object_relationships.find(r => r.name === rel.name)) {
        doc.object_relationships.push(rel);
      }
    });
  }

  doc.select_permissions = [{
    role: 'user',
    permission: {
      columns: '*',
      filter: config.select_filter
    }
  }];
  
  if (config.insert_filter) {
    doc.insert_permissions = [{
      role: 'user',
      permission: {
        check: config.insert_filter,
        columns: '*',
        set: config.insert_set || {}
      }
    }];
  }

  if (config.update_filter) {
    doc.update_permissions = [{
      role: 'user',
      permission: {
        columns: '*',
        filter: config.update_filter,
        check: config.update_filter
      }
    }];
  }

  if (config.delete_filter) {
    doc.delete_permissions = [{
      role: 'user',
      permission: {
        filter: config.delete_filter
      }
    }];
  }

  fs.writeFileSync(file, yaml.dump(doc));
}

// organizations
updateTable('organizations', {
  select_filter: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } },
  update_filter: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, { role: { _eq: "owner" } } ] } }
});

// org_members
updateTable('org_members', {
  select_filter: { organization: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } } },
  insert_filter: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, { role: { _eq: "owner" } } ] } } },
  update_filter: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, { role: { _eq: "owner" } } ] } } },
  delete_filter: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, { role: { _eq: "owner" } } ] } } }
});

const ownerOrEditor = {
  _or: [
    { role: { _eq: "owner" } },
    { role: { _eq: "editor" } }
  ]
};

// workflows
updateTable('workflows', {
  object_relationships: [{ name: 'organization', using: { foreign_key_constraint_on: 'org_id' } }],
  select_filter: { organization: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } } },
  insert_filter: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } },
  update_filter: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } },
  delete_filter: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } }
});

// workflow_steps
updateTable('workflow_steps', {
  object_relationships: [{ name: 'workflow', using: { foreign_key_constraint_on: 'workflow_id' } }],
  select_filter: { workflow: { organization: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } } } },
  insert_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } },
  update_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } },
  delete_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } }
});

// workflow_triggers
updateTable('workflow_triggers', {
  object_relationships: [{ name: 'workflow', using: { foreign_key_constraint_on: 'workflow_id' } }],
  select_filter: { workflow: { organization: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } } } },
  insert_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } },
  update_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } },
  delete_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } }
});

// workflow_runs
updateTable('workflow_runs', {
  object_relationships: [{ name: 'workflow', using: { foreign_key_constraint_on: 'workflow_id' } }],
  select_filter: { workflow: { organization: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } } } },
  insert_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } },
  update_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } },
  delete_filter: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } }
});

// step_runs
updateTable('step_runs', {
  object_relationships: [
    { name: 'workflow_run', using: { foreign_key_constraint_on: 'workflow_run_id' } },
    { name: 'workflow_step', using: { foreign_key_constraint_on: 'workflow_step_id' } }
  ],
  select_filter: { workflow_run: { workflow: { organization: { org_members: { user_id: { _eq: "X-Hasura-User-Id" } } } } } },
  insert_filter: { workflow_run: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } } },
  update_filter: { workflow_run: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } } },
  delete_filter: { workflow_run: { workflow: { organization: { org_members: { _and: [ { user_id: { _eq: "X-Hasura-User-Id" } }, ownerOrEditor ] } } } } }
});
