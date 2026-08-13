import fetch from 'node-fetch';

const NHOST_GRAPHQL_URL = 'https://aszwclgvuyolkytnqscm.graphql.ap-south-1.nhost.run/v1';
const NHOST_AUTH_URL = 'https://aszwclgvuyolkytnqscm.auth.ap-south-1.nhost.run/v1';

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

async function main() {
  const ownerA = await login('owner_orga@example.com', 'Password123!');
  console.log('Logged in, fetching query fields...');

  const res = await fetch(NHOST_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ownerA.token}`
    },
    body: JSON.stringify({
      query: `
        query {
          __type(name: "mutation_root") {
            name
            fields {
              name
              description
            }
          }
        }
      `
    })
  });
  const data = await res.json();
  console.log('Query Fields:');
  if (data.data?.__type?.fields) {
    data.data.__type.fields.forEach(f => {
      console.log(` - ${f.name}`);
    });
  } else {
    console.log(JSON.stringify(data, null, 2));
  }
}

main().catch(console.error);
