import { NhostClient } from '@nhost/react';

// Mute Apollo Client deprecation warnings globally across SSR and Client
const muteAllDeprecations = Symbol.for('apollo.deprecations');
(globalThis as any)[muteAllDeprecations] = true;

const envSub = process.env.NEXT_PUBLIC_NHOST_SUBDOMAIN;
const envReg = process.env.NEXT_PUBLIC_NHOST_REGION;

const subdomain = (!envSub || envSub === 'local') ? 'aszwclgvuyolkytnqscm' : envSub;
const region = (!envReg || envReg === 'local') ? 'ap-south-1' : envReg;

export const nhost = new NhostClient({
  subdomain,
  region,
});

if (typeof window !== 'undefined') {
  console.log('[Nhost Audit] Client initialized');
  console.log('[Nhost Audit] Subdomain:', subdomain);
  console.log('[Nhost Audit] Region:', region);
  console.log('[Nhost Audit] Target Auth URL:', nhost.auth.client.backendUrl);
  console.log('[Nhost Audit] Target GraphQL URL:', nhost.graphql.httpUrl);
}

