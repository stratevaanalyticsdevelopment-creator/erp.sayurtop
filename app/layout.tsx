import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Strateva O2C ERP — Sayur Top',
  description: 'Sistem Order-to-Cash terintegrasi untuk distribusi sayur, buah, dan bahan segar.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
