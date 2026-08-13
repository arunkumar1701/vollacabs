import fetch from 'node-fetch';

const NHOST_GRAPHQL_URL = 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';

async function main() {
  const secret = process.env.NHOST_ADMIN_SECRET || '{{ secrets.HASURA_GRAPHQL_ADMIN_SECRET }}';
  console.log('Sending request with admin secret:', secret);
  const res = await fetch(NHOST_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-hasura-admin-secret': secret
    },
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
  console.log('Result:', JSON.stringify(data, null, 2));
}

main().catch(console.error);
