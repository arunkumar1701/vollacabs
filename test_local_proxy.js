import fetch from 'node-fetch';
import https from 'https';

async function main() {
  const agent = new https.Agent({ rejectUnauthorized: false });
  const res = await fetch('https://127.0.0.1:443/v1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'host': 'local.graphql.nhost.run',
      'x-hasura-admin-secret': 'nhost-admin-secret'
    },
    agent,
    body: JSON.stringify({
      query: `
        query {
          organizations {
            id
            name
          }
        }
      `
    })
  });
  const data = await res.json();
  console.log('Status:', res.status);
  console.log('Result:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
