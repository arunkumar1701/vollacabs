const { NhostClient } = require('@nhost/nhost-js');
const nhost = new NhostClient({
  subdomain: 'local',
  region: ''
});
console.log('GraphQL URL:', nhost.graphql.getUrl());
console.log('Auth URL:', nhost.auth.url);
