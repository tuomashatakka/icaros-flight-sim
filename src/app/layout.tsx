import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Crash Velocity',
  description: 'A Burnout-inspired 3D racing game.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
