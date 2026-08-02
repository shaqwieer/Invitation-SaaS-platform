'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatMoney, type PlatformStats } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';

type Tab = 'users' | 'events' | 'packages' | 'orders';
const TABS: Tab[] = ['users', 'events', 'packages', 'orders'];

interface AdminUser {
  id: string;
  name: string;
  phone: string;
  role: 'HOST' | 'ADMIN';
  isActive: boolean;
  _count: { events: number; orders: number };
}

interface AdminEvent {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  guestCapOverride: number | null;
  host: { id: string; name: string; phone: string };
  package: { nameAr: string; guestCap: number } | null;
  _count: { guests: number };
}

interface AdminPackage {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  guestCap: number;
  priceHalalas: number;
  isActive: boolean;
  _count: { events: number; orders: number };
}

interface AdminOrder {
  id: string;
  orderNumber: string;
  status: string;
  method: string | null;
  totalHalalas: number;
  paidAt: string | null;
  user: { name: string; phone: string };
  event: { title: string } | null;
}

/**
 * The operator panel.
 *
 * Mirrors the API's boundary rather than working around it: there is no guest
 * list here and no way to answer for a guest. Support can grant headroom,
 * disable an account and read the catalogue — a host's personal data stays with
 * the host.
 */
export default function AdminPage() {
  const params = useParams<{ locale: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { user, ready, authFetch } = useAuth();

  const [tab, setTab] = useState<Tab>('users');
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [rows, setRows] = useState<unknown[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const digits = locale === 'ar' ? 'arabic' : 'western';
  const n = (value: number) => displayNumber(value, locale);

  useEffect(() => {
    if (ready && !user) router.replace(`/${locale}/login`);
  }, [ready, user, router, locale]);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    void authFetch('/api/admin/stats')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setStats(body.stats));
  }, [user, authFetch]);

  const load = useCallback(async () => {
    if (user?.role !== 'ADMIN') return;
    const search = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    const res = await authFetch(`/api/admin/${tab}${search}`);
    if (!res.ok) return;
    const body = await res.json();
    setRows(body[tab] ?? []);
  }, [tab, query, authFetch, user]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 200);
    return () => clearTimeout(timer);
  }, [load]);

  const patchUser = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setError(null);
      const res = await authFetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(
          payload?.error?.code === 'ADMIN_SELF_LOCKOUT'
            ? t('admin.selfLockout')
            : t('admin.updateFailed'),
        );
        return;
      }
      await load();
    },
    [authFetch, load, t],
  );

  if (!ready || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('auth.loading')}
      </main>
    );
  }

  // The API refuses regardless; this only spares an admin-less host a wall of
  // failed requests.
  if (user.role !== 'ADMIN') {
    return (
      <main className="flex min-h-screen items-center justify-center text-body text-ink-muted">
        {t('admin.noAccess')}
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#F6F4EE]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line bg-surface px-6 py-5 lg:px-8">
        <h1 className="text-h3">{t('admin.title')}</h1>
        <a
          href={`/${locale}/dashboard`}
          className="rounded-[11px] border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium"
        >
          {t('dash.viewReport')} ←
        </a>
      </header>

      <div className="flex flex-col gap-5 p-6 lg:p-8">
        {stats && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat value={n(stats.users)} label={t('admin.stats.users')} />
            <Stat value={n(stats.events)} label={t('admin.stats.events')} />
            <Stat value={n(stats.guests)} label={t('admin.stats.guests')} />
            <Stat value={n(stats.paidOrders)} label={t('admin.stats.paidOrders')} />
            <Stat
              value={formatMoney(stats.revenueHalalas, { digits })}
              label={t('admin.stats.revenue')}
              highlight
            />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2.5">
          {TABS.map((option) => (
            <button
              key={option}
              onClick={() => {
                setTab(option);
                setQuery('');
                setRows([]);
              }}
              className={`rounded-chip px-4 py-2 text-sm font-medium ${
                tab === option
                  ? 'bg-emerald-700 text-[#F7F5EF]'
                  : 'border border-line-strong bg-surface text-ink-muted'
              }`}
            >
              {t(`admin.${option}`)}
            </button>
          ))}

          {(tab === 'users' || tab === 'events') && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('admin.search')}
              className="ms-auto w-full max-w-xs rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm outline-none focus:border-emerald-700"
            />
          )}
        </div>

        {error && (
          <p className="rounded-card bg-status-declinedBg px-5 py-4 text-sm text-status-declinedFg">
            {error}
          </p>
        )}

        <div className="overflow-x-auto rounded-card border border-line-soft bg-surface">
          {tab === 'users' && (
            <Table
              headers={[t('auth.phone'), t('admin.role'), t('admin.events'), t('admin.status'), '']}
            >
              {(rows as AdminUser[]).map((row) => (
                <tr key={row.id} className="border-t border-[#F2F0EA]">
                  <Cell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{row.name}</span>
                      <span className="ltr-nums text-xs text-ink-light">{row.phone}</span>
                    </div>
                  </Cell>
                  <Cell>{row.role}</Cell>
                  <Cell>{n(row._count.events)}</Cell>
                  <Cell>
                    <Badge ok={row.isActive}>
                      {row.isActive ? t('admin.active') : t('admin.disabled')}
                    </Badge>
                  </Cell>
                  <Cell>
                    <div className="flex flex-wrap gap-2">
                      <Action
                        onClick={() =>
                          patchUser(row.id, { role: row.role === 'ADMIN' ? 'HOST' : 'ADMIN' })
                        }
                      >
                        {row.role === 'ADMIN' ? t('admin.demote') : t('admin.promote')}
                      </Action>
                      <Action danger onClick={() => patchUser(row.id, { isActive: !row.isActive })}>
                        {row.isActive ? t('admin.disable') : t('admin.enable')}
                      </Action>
                    </div>
                  </Cell>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'events' && (
            <Table
              headers={[
                t('admin.events'),
                t('admin.host'),
                t('admin.guests'),
                t('admin.cap'),
                t('admin.status'),
              ]}
            >
              {(rows as AdminEvent[]).map((row) => (
                <tr key={row.id} className="border-t border-[#F2F0EA]">
                  <Cell>
                    <span className="font-medium">{row.title}</span>
                  </Cell>
                  <Cell>
                    <div className="flex flex-col gap-1">
                      <span>{row.host.name}</span>
                      <span className="ltr-nums text-xs text-ink-light">{row.host.phone}</span>
                    </div>
                  </Cell>
                  <Cell>{n(row._count.guests)}</Cell>
                  <Cell>
                    {row.guestCapOverride !== null
                      ? n(row.guestCapOverride)
                      : row.package
                        ? n(row.package.guestCap)
                        : '—'}
                  </Cell>
                  <Cell>{row.status}</Cell>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'packages' && (
            <Table
              headers={[
                t('admin.packages'),
                t('admin.cap'),
                t('admin.price'),
                t('admin.events'),
                t('admin.status'),
              ]}
            >
              {(rows as AdminPackage[]).map((row) => (
                <tr key={row.id} className="border-t border-[#F2F0EA]">
                  <Cell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">
                        {locale === 'ar' ? row.nameAr : row.nameEn}
                      </span>
                      <span className="font-latin text-xs text-ink-light">{row.key}</span>
                    </div>
                  </Cell>
                  <Cell>{n(row.guestCap)}</Cell>
                  <Cell>{formatMoney(row.priceHalalas, { digits, withCurrency: true })}</Cell>
                  <Cell>{n(row._count.events)}</Cell>
                  <Cell>
                    <Badge ok={row.isActive}>
                      {row.isActive ? t('admin.active') : t('admin.disabled')}
                    </Badge>
                  </Cell>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'orders' && (
            <Table
              headers={[
                t('checkout.orderNumber'),
                t('admin.host'),
                t('checkout.amount'),
                t('admin.status'),
                '',
              ]}
            >
              {(rows as AdminOrder[]).map((row) => (
                <tr key={row.id} className="border-t border-[#F2F0EA]">
                  <Cell>
                    <span className="font-latin" dir="ltr">
                      {row.orderNumber}
                    </span>
                  </Cell>
                  <Cell>{row.user.name}</Cell>
                  <Cell>{formatMoney(row.totalHalalas, { digits, withCurrency: true })}</Cell>
                  <Cell>
                    <Badge ok={row.status === 'PAID'}>{row.status}</Badge>
                  </Cell>
                  <Cell>{row.event?.title ?? '—'}</Cell>
                </tr>
              ))}
            </Table>
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({ value, label, highlight }: { value: string; label: string; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line-soft bg-surface p-5">
      <span className={`text-[26px] font-semibold ${highlight ? 'text-emerald-700' : ''}`}>
        {value}
      </span>
      <span className="text-[13px] text-ink-muted">{label}</span>
    </div>
  );
}

function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <table className="w-full min-w-[640px] text-start text-sm">
      <thead>
        <tr className="bg-surface-muted">
          {headers.map((header, index) => (
            <th
              key={index}
              className="px-5 py-3.5 text-start text-[12.5px] font-medium text-ink-light"
            >
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="px-5 py-4 align-middle">{children}</td>;
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-chip px-3 py-1.5 text-[12.5px] font-medium ${
        ok
          ? 'bg-status-confirmedBg text-status-confirmedFg'
          : 'bg-status-notSentBg text-status-notSentFg'
      }`}
    >
      <span
        className={`h-[6px] w-[6px] rounded-full ${ok ? 'bg-status-confirmed' : 'bg-status-notSent'}`}
      />
      {children}
    </span>
  );
}

function Action({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-[9px] border px-3 py-1.5 text-[12.5px] font-medium ${
        danger ? 'border-[#E4C9C6] text-status-declined' : 'border-line-strong text-ink'
      }`}
    >
      {children}
    </button>
  );
}
