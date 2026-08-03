'use client';

/**
 * The door: who is working it, and who they let in.
 *
 * One screen because it answers one question, but the two lists are peers rather
 * than one stacked under the other — a table below a table buries the second
 * one and gives it no heading that stays in view. The night's four figures sit
 * on top, then a tab strip switches between the lists.
 *
 * Ending a session is the only remedy if the door password gets out mid-event,
 * so it is a plain visible button rather than something buried.
 */

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import type { ScanLogEntry, ScanStats } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import {
  Button,
  Card,
  EmptyState,
  LinkButton,
  Modal,
  PageHeader,
  Spinner,
  TableFrame,
  Td,
  Th,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';

interface Session {
  id: string;
  displayName: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
  _count: { checkIns: number };
}

export default function ScannersPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const n = (value: number) => displayNumber(value, locale);
  const { authFetch } = useAuth();
  const eventId = params.eventId;

  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [stats, setStats] = useState<ScanStats | null>(null);
  const [entries, setEntries] = useState<ScanLogEntry[] | null>(null);
  const [tab, setTab] = useState<'sessions' | 'log'>('sessions');
  const [revoking, setRevoking] = useState<Session | null>(null);
  const [undoing, setUndoing] = useState<ScanLogEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      authFetch(`/api/events/${eventId}/scan/sessions`),
      authFetch(`/api/events/${eventId}/checkins`),
    ]);
    if (a.ok) setSessions((await a.json()).sessions);
    if (b.ok) {
      const body = await b.json();
      setStats(body.stats);
      setEntries(body.entries);
    }
  }, [authFetch, eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const time = (iso: string) =>
    new Date(iso).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-GB', {
      day: 'numeric',
      month: 'short',
      hour: 'numeric',
      minute: '2-digit',
    });

  const revoke = async () => {
    if (!revoking) return;
    setBusy(true);
    const res = await authFetch(
      `/api/events/${eventId}/scan/sessions/${revoking.id}/revoke`,
      { method: 'POST' },
    );
    setBusy(false);
    setRevoking(null);
    setToast(
      res.ok
        ? { tone: 'success', text: t('scanners.revoked') }
        : { tone: 'error', text: t('common.genericError') },
    );
    if (res.ok) await load();
  };

  const undo = async () => {
    if (!undoing?.checkInId) return;
    setBusy(true);
    const res = await authFetch(`/api/events/${eventId}/checkins/${undoing.checkInId}`, {
      method: 'DELETE',
    });
    setBusy(false);
    setUndoing(null);
    setToast(
      res.ok
        ? { tone: 'success', text: t('checkins.revoked') }
        : { tone: 'error', text: t('common.genericError') },
    );
    if (res.ok) await load();
  };

  const activeSessions = sessions?.filter((s) => !s.revokedAt).length ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('scanners.title')}
        subtitle={t('scanners.body')}
        actions={
          <LinkButton href={`/scan/${eventId}`} target="_blank" rel="noreferrer noopener" size="sm">
            {t('scanners.openScanner')}
          </LinkButton>
        }
      />

      {/*
        The numbers first, then one table at a time.
        Two stacked tables made the reader scroll past the whole session list to
        reach the arrivals they actually came for, and gave neither a heading
        that stayed in view. A tab strip puts them at the same level — which is
        what they are — and the door's four figures answer the common question
        without opening either.
      */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label={t('scanners.statSeats')} value={n(stats.seatsAdmitted)} accent />
          <Stat label={t('scanners.statExpected')} value={n(stats.expectedSeats)} />
          <Stat label={t('scanners.statScans')} value={n(stats.scans)} />
          <Stat label={t('scanners.statAlerts')} value={n(stats.alerts)} warn={stats.alerts > 0} />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(['sessions', 'log'] as const).map((key) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-chip border px-4 py-2 text-[13.5px] transition-colors ${
              tab === key
                ? 'border-emerald-700 bg-emerald-700 font-medium text-[#F7F5EF]'
                : 'border-line-strong bg-surface text-ink-muted hover:border-ink-light'
            }`}
          >
            {key === 'sessions' ? t('scanners.tabSessions') : t('scanners.tabLog')}
            <span className="ms-2 ltr-nums opacity-70">
              {key === 'sessions' ? n(sessions?.length ?? 0) : n(entries?.length ?? 0)}
            </span>
          </button>
        ))}
        {activeSessions > 0 && (
          <span className="ms-auto inline-flex items-center gap-2 self-center text-[13px] text-ink-light">
            <span className="h-[7px] w-[7px] rounded-full bg-status-confirmed" />
            {t('scanners.activeCount', { count: n(activeSessions) })}
          </span>
        )}
      </div>

      {tab === 'sessions' && (
      <Card>
        {!sessions ? (
          <Spinner label={t('common.loading')} />
        ) : sessions.length === 0 ? (
          <EmptyState title={t('scanners.empty')} body={t('scanners.emptyBody')} />
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <Th>{t('scanners.name')}</Th>
                <Th>{t('scanners.opened')}</Th>
                <Th>{t('scanners.lastSeen')}</Th>
                <Th>{t('scanners.checkins')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className={session.revokedAt ? 'opacity-55' : undefined}>
                  <Td className="font-medium">{session.displayName}</Td>
                  <Td className="text-ink-muted">{time(session.createdAt)}</Td>
                  <Td className="text-ink-muted">{time(session.lastSeenAt)}</Td>
                  <Td className="ltr-nums">{n(session._count.checkIns)}</Td>
                  <Td className="text-end">
                    {session.revokedAt ? (
                      <span className="text-[12.5px] text-ink-light">
                        {t('scanners.revokedTag')}
                      </span>
                    ) : (
                      <Button size="sm" variant="danger" onClick={() => setRevoking(session)}>
                        {t('scanners.revoke')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Card>
      )}

      {tab === 'log' && (
      <Card>
        {!entries ? (
          <Spinner label={t('common.loading')} />
        ) : entries.length === 0 ? (
          <EmptyState title={t('checkins.empty')} body={t('checkins.emptyBody')} />
        ) : (
          <TableFrame>
            <thead>
              <tr>
                <Th>{t('checkins.guest')}</Th>
                <Th>{t('checkins.seats')}</Th>
                <Th>{t('checkins.at')}</Th>
                <Th>{t('checkins.by')}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry, index) => (
                <tr key={`${entry.at}-${index}`}>
                  <Td>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{entry.guestName ?? t('common.none')}</span>
                      {entry.kind === 'OVERRIDE' && (
                        <span className="rounded-chip bg-status-pendingBg px-2.5 py-1 text-[11.5px] text-status-pendingFg">
                          {t('checkins.override')}
                        </span>
                      )}
                      {entry.kind === 'REJECTED' && (
                        <span className="rounded-chip bg-status-declinedBg px-2.5 py-1 text-[11.5px] text-status-declinedFg">
                          {entry.detail ?? ''}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="ltr-nums">
                    {entry.seats === null ? t('common.none') : n(entry.seats)}
                  </Td>
                  <Td className="text-ink-muted">{time(entry.at)}</Td>
                  <Td className="text-ink-muted">{entry.scannedByName ?? t('common.none')}</Td>
                  <Td className="text-end">
                    {entry.checkInId && (
                      <Button size="sm" variant="ghost" onClick={() => setUndoing(entry)}>
                        {t('checkins.revoke')}
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Card>
      )}

      {revoking && (
        <Modal
          title={t('scanners.revokeTitle', { name: revoking.displayName })}
          onClose={() => setRevoking(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setRevoking(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void revoke()}>
                {t('scanners.revoke')}
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-muted">{t('scanners.revokeBody')}</p>
        </Modal>
      )}

      {undoing && (
        <Modal
          title={t('checkins.revokeTitle', { name: undoing.guestName ?? '' })}
          onClose={() => setUndoing(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setUndoing(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void undo()}>
                {t('checkins.revoke')}
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-muted">{t('checkins.revokeBody')}</p>
        </Modal>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

/**
 * One figure from the door.
 *
 * `accent` marks the number the host actually watches — seats admitted — and
 * `warn` colours the alert count only when there is something to look at, so a
 * quiet night stays visually quiet.
 */
function Stat({
  label,
  value,
  accent,
  warn,
}: {
  label: string;
  value: string;
  accent?: boolean;
  warn?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-card border p-5 ${
        accent ? 'border-emerald-700 bg-emerald-700' : 'border-line-soft bg-surface'
      }`}
    >
      <span className={`text-[13px] ${accent ? 'text-[#A9C6BA]' : 'text-ink-muted'}`}>{label}</span>
      <span
        className={`text-[28px] font-semibold leading-none ltr-nums ${
          accent ? 'text-[#FFFDF7]' : warn ? 'text-status-declined' : 'text-ink'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
