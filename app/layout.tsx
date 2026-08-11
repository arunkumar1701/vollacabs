import type {Metadata} from 'next';
import './globals.css';
import { Providers } from '../components/Providers';
import { Auth } from '../components/Auth';

export default function RootLayout({children}: {children: React.ReactNode}) {
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
