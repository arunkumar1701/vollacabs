const { NhostClient } = require('@nhost/nhost-js');
const nhost = new NhostClient({
  subdomain: 'aszwclgvuyolkytnqscm',
  region: 'ap-south-1',
  adminSecret: '8du6^*l1$7^T0vx9feyViQgKP@i+Xzn:'
});

async function run() {
  const q = `
    query {
      __type(name: "workflow_triggers") {
        fields {
          name
          type {
            name
            kind
            ofType {
              name
              kind
            }
          }
        }
      }
    }
  `;
  const res = await nhost.graphql.request(q);
  console.log(JSON.stringify(res, null, 2));
}
run();
