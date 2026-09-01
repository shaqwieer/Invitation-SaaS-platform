'use client';

/**
 * The host's events, fetched once for the whole shell.
 *
 * Every host page needs the same three things — which events exist, which one
 * is being worked on, and how much package headroom is left — so they are
 * fetched here rather than three times over in three pages.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export interface HostEvent {
  id: string;
  title: string;
  type: string;
  status: string;
  sectionMode: string;
  startsAt: string;
  endsAt: string | null;
  timezone: string;
  hostName: string;
  partnerName: string | null;
  venueName: string | null;
  venueAddress: string | null;
  venueLat: number | null;
  venueLng: number | null;
  venueMapUrl: string | null;
  /** Which of the three design routes the host chose. */
  cardDesignMode: 'TEMPLATE' | 'CUSTOM_REQUEST' | 'UPLOAD';
  templateId: string | null;
  packageId: string | null;
  cardColor: string;
  cardTitleFont: string;
  customCardUrl: string | null;
  /** «البيانات المطلوبة في الكرت» — the wording the operator draws onto it. */
  cardDetails: string | null;
  /** Whether uploaded artwork exists; the bytes never travel in JSON. */
  hasCardImage: boolean;
  cardImageVersion: number;
  rsvpDeadline: string | null;
  defaultCompanionsAllowed: number;
  whatsappTemplateAr: string;
  whatsappTemplateEn: string;
  hasScannerPassword: boolean;
}

export interface Quota {
  cap: number | null;
  used: number;
  remaining: number | null;
  exceeded: boolean;
  packageName: string | null;
}

interface EventState {
  events: HostEvent[] | null;
  current: HostEvent | null;
  quota: Quota | null;
  /**
   * The URL named an event this account cannot see.
   *
   * Distinct from `current === null`, which is also true for a host with no
   * events at all — that is an empty state, this is a wrong door.
   */
  eventMissing: boolean;
  selectEvent: (id: string) => void;
  reload: () => Promise<void>;
}

const EventCtx = createContext<EventState | null>(null);

const STORAGE_KEY = 'da3wa.currentEvent';

export function EventProvider({ children }: { children: React.ReactNode }) {
  const { user, authFetch } = useAuth();
  const params = useParams<{ eventId?: string }>();

  const [events, setEvents] = useState<HostEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);

  const reload = useCallback(async () => {
    if (!user) return;
    const res = await authFetch('/api/events');
    if (!res.ok) return setEvents([]);
    const body = await res.json();
    setEvents(body.events ?? []);
  }, [user, authFetch]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Restore the last event the host was working on, so landing on /dashboard
  // after a reload does not silently switch them to a different wedding.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setSelected((current) => current ?? window.localStorage.getItem(STORAGE_KEY));
  }, []);

  const selectEvent = useCallback((id: string) => {
    setSelected(id);
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // The route wins over the stored selection: a host who opened a link to one
  // event's guest list is working on *that* event, whatever they picked last.
  const routeEventId = params?.eventId;

  /**
   * When the route names an event, that event is the only candidate.
   *
   * Falling back to the first event here would put *your* wedding in the sidebar
   * while the page below fetched someone else's id and 404'd — a mixed state
   * that reads like a bug on precisely the cross-tenant path that most needs to
   * be unambiguous.
   */
  const current = useMemo(() => {
    if (!events || events.length === 0) return null;
    if (routeEventId) return events.find((event) => event.id === routeEventId) ?? null;
    return events.find((event) => event.id === selected) ?? events[0]!;
  }, [events, routeEventId, selected]);

  const eventMissing =
    !!routeEventId && events !== null && !events.some((event) => event.id === routeEventId);

  useEffect(() => {
    if (!current) return setQuota(null);
    let cancelled = false;

    void authFetch(`/api/events/${current.id}/quota`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!cancelled) setQuota(body?.quota ?? null);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [current, authFetch]);

  const value = useMemo(
    () => ({ events, current, quota, eventMissing, selectEvent, reload }),
    [events, current, quota, eventMissing, selectEvent, reload],
  );

  return <EventCtx.Provider value={value}>{children}</EventCtx.Provider>;
}

export function useEvents(): EventState {
  const context = useContext(EventCtx);
  if (!context) throw new Error('useEvents must be used inside EventProvider');
  return context;
}
