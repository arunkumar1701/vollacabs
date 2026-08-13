'use client';

import { useMemo } from 'react';
import { NhostProvider } from '@nhost/react';
import { ApolloProvider } from '@apollo/client';
import { onError } from '@apollo/client/link/error';
import { setContext } from '@apollo/client/link/context';
import { createApolloClient } from '@nhost/apollo';
import { nhost } from '../lib/nhost';

export function Providers({ children }: { children: React.ReactNode }) {
  const apolloClient = useMemo(() => {
    const errorLink = onError(({ graphQLErrors, networkError }) => {
      if (graphQLErrors) {
        graphQLErrors.forEach(({ message, path }) => {
          console.warn(`[GraphQL Notice]: ${message} (Path: ${path})`);
        });
      }
      if (networkError) {
        const msg = networkError.message || (networkError as any).type || 'Unknown Network Error';
        console.warn(`[Network Notice]: ${msg}`);
      }
    });

    const authLink = setContext((_, { headers }) => {
      const token = nhost.auth.getAccessToken();
      return {
        headers: {
          ...headers,
          ...(token ? { authorization: `Bearer ${token}` } : {})
        }
      };
    });

    const client = createApolloClient({
      nhost,
      generateLinks: (links) => [errorLink, authLink, ...links]
    });

    client.defaultOptions = {
      watchQuery: { errorPolicy: 'all' },
      query: { errorPolicy: 'all' },
      mutate: { errorPolicy: 'all' }
    };

    return client;
  }, []);

  return (
    <NhostProvider nhost={nhost}>
      <ApolloProvider client={apolloClient}>
        {children}
      </ApolloProvider>
    </NhostProvider>
  );
}


