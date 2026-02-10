import type { Metadata } from 'next';
import './globals.css';

// Needed for per-request CSP nonces (middleware) and session-aware rendering.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'RideIQ Admin',
  description: 'RideIQ internal administration console',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
