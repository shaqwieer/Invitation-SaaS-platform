import type { Metadata } from 'next';
import { ScannerClient } from './ScannerClient';

/**
 * The reception scanner.
 *
 * Door staff have no account — they hold the event password, so this page is
 * reachable by URL and gated by the password inside. Never indexed, never
 * cached, and always dynamic: the session lives in the browser, not the URL.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'ماسح الاستقبال · دعوة',
  robots: { index: false, follow: false },
};

export default function ScanPage({ params }: { params: { eventId: string } }) {
  return <ScannerClient eventId={params.eventId} />;
}
