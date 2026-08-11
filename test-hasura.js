const { NhostClient } = require('@nhost/nhost-js');

const nhost = new NhostClient({
  subdomain: 'local',
  region: ''
});

async function run() {
  const result = await nhost.graphql.request(`
    query {
      organizations {
        id
        name
      }
    }
  `, {}, {
    headers: {
      'x-hasura-admin-secret': 'nhost-admin-secret'
    }
  });
  console.log(JSON.stringify(result, null, 2));
}

run().catch(console.error);
