import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'sparx — AI YouTube Studio',
  description: 'Dashboard for the sparx multi-agent video pipeline',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
