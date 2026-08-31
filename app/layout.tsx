import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Мій розклад — Осінь 2026 / 27',
  description:
    'Зручний тижневий розклад занять із фільтрами, форматами навчання та автоматичним пошуком конфліктів.',
  openGraph: {
    title: 'Мій розклад',
    description: 'Осінь 2026 / 27 — тижневий розклад із пошуком конфліктів.',
    locale: 'uk_UA',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Мій розклад — Осінь 2026 / 27' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Мій розклад',
    description: 'Осінь 2026 / 27 — тижневий розклад із пошуком конфліктів.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
