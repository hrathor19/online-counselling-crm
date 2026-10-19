import type { Metadata, Viewport } from 'next';
import { Caveat, Inter } from 'next/font/google';
import './globals.css';
import { Providers } from './providers';
import { PwaRegister } from '@/components/shared/pwa-register';

const inter = Inter({ subsets: ['latin'] });
// The handwritten aside on the login screen. Exposed as a variable rather than
// a className so only that one element pays for it; `display: swap` keeps it
// from blocking first paint on a decorative flourish.
const caveat = Caveat({ subsets: ['latin'], weight: ['600'], display: 'swap', variable: '--font-handwritten' });

export const metadata: Metadata = {
  title: 'Counselling CRM',
  description: 'Lead management system for KollegeApply counselling teams',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Counselling CRM',
  },
  icons: {
    // Declared here rather than via an app/icon.* file on purpose: the file
    // convention overrides this whole `icons` object, which silently drops
    // the apple-touch-icon tag.
    //
    // Browser tabs get the vector mark so it stays crisp at any size; Apple
    // home-screen icons must be raster on an opaque background, so those use
    // the generated PNG route.
    icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
    apple: '/api/pwa/icon/192',
  },
};

export const viewport: Viewport = {
  themeColor: '#0d2455',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${inter.className} ${caveat.variable}`}>
        <Providers>{children}</Providers>
        <PwaRegister />
      </body>
    </html>
  );
}
