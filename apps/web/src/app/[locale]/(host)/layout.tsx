/**
 * Every authenticated host screen, inside the application frame.
 *
 * A route group, so the folder name adds nothing to the URL — /ar/dashboard and
 * /ar/events/:id/guests keep the paths they already had.
 *
 * `/admin` and `/checkout` stay outside deliberately: the admin panel is a
 * different product surface with its own chrome, and checkout is a focused
 * payment flow that should not offer six ways to navigate away mid-transaction.
 */
import { AppShell } from '@/components/AppShell';
import { EventProvider } from '@/components/EventContext';

export default function HostLayout({ children }: { children: React.ReactNode }) {
  return (
    <EventProvider>
      <AppShell>{children}</AppShell>
    </EventProvider>
  );
}
