import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import './globals.css';
import { Footer } from '@/components/footer';
import { Header } from '@/components/header';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://smart-hr-site.vercel.app'),
  title: { default: 'SmartHRMS: HR, payroll and operations for Indian teams', template: '%s | SmartHRMS' },
  description:
    'Employee records, attendance, leave, payroll with Indian statutory compliance, and operations in one system. Try a limited demo with your work email.',
};
export const viewport: Viewport = { themeColor: '#0e1b33' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
