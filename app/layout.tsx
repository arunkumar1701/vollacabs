import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { Auth } from '@/components/Auth';

export const metadata: Metadata = {
  title: 'Workflow Automation Hub',
  description: 'Nhost + Hasura GraphQL Orchestrator',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Providers>
          <Auth>{children}</Auth>
        </Providers>
      </body>
    </html>
  );
}

