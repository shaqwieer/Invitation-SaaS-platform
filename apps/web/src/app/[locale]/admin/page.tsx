'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { formatMoney, type PlatformStats, type PublicBranding } from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';
import { AdminShell } from '@/components/AdminShell';
import { apiUrl } from '@/lib/api';

type Tab = 'users' | 'events' | 'packages' | 'templates' | 'orders' | 'branding';
const TABS: Tab[] = ['users', 'events', 'packages', 'templates', 'orders', 'branding'];

interface AdminTemplate {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  category: string;
  priceHalalas: number;
  sortOrder: number;
  isActive: boolean;
  _count?: { events: number };
}

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
  scannerSeats: number;
  featuresAr: string[];
  featuresEn: string[];
  isHighlighted: boolean;
  sortOrder: number;
  isActive: boolean;
  _count: { events: number; orders: number };
}

/**
 * `PUT /admin/packages` upserts the whole row, so a partial payload would reset
 * everything it omits back to schema defaults — silently emptying a package's
 * feature list because someone nudged its price.
 */
function packagePayload(row: AdminPackage) {
  return {
    key: row.key,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    guestCap: row.guestCap,
    priceHalalas: row.priceHalalas,
    scannerSeats: row.scannerSeats,
    featuresAr: row.featuresAr,
    featuresEn: row.featuresEn,
    isHighlighted: row.isHighlighted,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
  };
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
    // Branding is a single record with its own editor, not a searchable table.
    if (tab === 'branding') return;
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

  /**
   * Support actions on an event.
   *
   * Deliberately narrow: status, package and a cap override. Admins can grant a
   * host headroom or close out an event, but nothing here reaches the guest list.
   */
  const patchEvent = useCallback(
    async (id: string, body: Record<string, unknown>) => {
      setError(null);
      const res = await authFetch(`/api/admin/events/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      if (!res.ok) return setError(t('admin.updateFailed'));
      await load();
    },
    [authFetch, load, t],
  );

  /** Catalogue upsert — packages and templates share one shape of call. */
  const upsertCatalogue = useCallback(
    async (kind: 'packages' | 'templates', body: Record<string, unknown>) => {
      setError(null);
      const res = await authFetch(`/api/admin/${kind}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(payload?.error?.details?.messageAr ?? t('admin.updateFailed'));
        return false;
      }
      await load();
      return true;
    },
    [authFetch, load, t],
  );

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
    <AdminShell
      locale={locale}
      sections={TABS.map((key) => ({ key, label: t(`admin.${key}`) }))}
      active={tab}
      onSelect={(next) => {
        setTab(next);
        // Each section has its own shape; carrying a search term or the previous
        // section's rows across would show stale data under the new heading.
        setQuery('');
        setRows([]);
      }}
    >
      <div className="flex flex-col gap-5">
        <h1 className="text-h2">{t(`admin.${tab}`)}</h1>

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

        {/* Navigation lives in the sidebar now; this row is only the search. */}
        {(tab === 'users' || tab === 'events') && (
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('admin.search')}
            className="w-full max-w-xs rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm outline-none focus:border-emerald-700"
          />
        )}

        {error && (
          <p className="rounded-card bg-status-declinedBg px-5 py-4 text-sm text-status-declinedFg">
            {error}
          </p>
        )}

        {tab === 'branding' ? (
          <BrandingPanel t={t} locale={locale} authFetch={authFetch} onError={setError} />
        ) : (
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
                '',
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
                    {/* Editable in place: granting headroom is the single most
                        common support action and does not deserve a dialog. */}
                    <input
                      type="number"
                      min={0}
                      defaultValue={row.guestCapOverride ?? ''}
                      placeholder={row.package ? String(row.package.guestCap) : '—'}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === '' ? null : Number(raw);
                        if (next !== row.guestCapOverride) {
                          void patchEvent(row.id, { guestCapOverride: next });
                        }
                      }}
                      className="w-20 rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] ltr-nums outline-none focus:border-emerald-700"
                    />
                  </Cell>
                  <Cell>
                    <select
                      value={row.status}
                      onChange={(e) => void patchEvent(row.id, { status: e.target.value })}
                      className="rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px]"
                    >
                      {['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'].map((status) => (
                        <option key={status} value={status}>
                          {t(`settings.status.${status}`)}
                        </option>
                      ))}
                    </select>
                  </Cell>
                  <Cell>{null}</Cell>
                </tr>
              ))}
            </Table>
          )}

          {tab === 'templates' && (
            <Table
              headers={[t('admin.templates'), t('admin.price'), t('admin.events'), t('admin.status'), '']}
            >
              {(rows as AdminTemplate[]).map((row) => (
                <tr key={row.id} className="border-t border-[#F2F0EA]">
                  <Cell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">
                        {locale === 'ar' ? row.nameAr : row.nameEn}
                      </span>
                      <span className="font-latin text-xs text-ink-light">{row.key}</span>
                    </div>
                  </Cell>
                  <Cell>{formatMoney(row.priceHalalas, { digits })}</Cell>
                  <Cell>{n(row._count?.events ?? 0)}</Cell>
                  <Cell>{row.isActive ? t('admin.active') : t('admin.disabled')}</Cell>
                  <Cell>
                    <Action
                      onClick={() =>
                        void upsertCatalogue('templates', {
                          key: row.key,
                          nameAr: row.nameAr,
                          nameEn: row.nameEn,
                          category: row.category,
                          priceHalalas: row.priceHalalas,
                          sortOrder: row.sortOrder,
                          isActive: !row.isActive,
                        })
                      }
                    >
                      {row.isActive ? t('admin.disable') : t('admin.enable')}
                    </Action>
                  </Cell>
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
                '',
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
                  <Cell>
                    <input
                      type="number"
                      min={1}
                      defaultValue={row.guestCap}
                      onBlur={(e) => {
                        const next = Number(e.target.value);
                        if (next && next !== row.guestCap) {
                          void upsertCatalogue('packages', { ...packagePayload(row), guestCap: next });
                        }
                      }}
                      className="w-20 rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] ltr-nums outline-none focus:border-emerald-700"
                    />
                  </Cell>
                  <Cell>
                    {/* Priced in halalas everywhere, but nobody types halalas —
                        the field takes riyals and converts. */}
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      defaultValue={(row.priceHalalas / 100).toFixed(2)}
                      onBlur={(e) => {
                        const next = Math.round(Number(e.target.value) * 100);
                        if (Number.isFinite(next) && next !== row.priceHalalas) {
                          void upsertCatalogue('packages', {
                            ...packagePayload(row),
                            priceHalalas: next,
                          });
                        }
                      }}
                      className="w-24 rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] ltr-nums outline-none focus:border-emerald-700"
                    />
                  </Cell>
                  <Cell>{n(row._count.events)}</Cell>
                  <Cell>
                    <Badge ok={row.isActive}>
                      {row.isActive ? t('admin.active') : t('admin.disabled')}
                    </Badge>
                  </Cell>
                  <Cell>
                    <Action
                      onClick={() =>
                        void upsertCatalogue('packages', {
                          ...packagePayload(row),
                          isActive: !row.isActive,
                        })
                      }
                    >
                      {row.isActive ? t('admin.disable') : t('admin.enable')}
                    </Action>
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
        )}
      </div>
    </AdminShell>
  );
}

/**
 * Platform branding.
 *
 * The one screen in the product that changes the product itself, so it shows a
 * live preview of the lockup beside the fields — an operator should see what
 * they are shipping before they ship it, not after reloading the landing page.
 */
function BrandingPanel({
  t,
  locale,
  authFetch,
  onError,
}: {
  t: ReturnType<typeof translator>;
  locale: AppLocale;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onError: (message: string | null) => void;
}) {
  const [form, setForm] = useState<PublicBranding | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void authFetch('/api/admin/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setForm(body.branding))
      .catch(() => undefined);
  }, [authFetch]);

  if (!form) {
    return (
      <div className="rounded-card border border-line-soft bg-surface p-8 text-body text-ink-muted">
        {t('auth.loading')}
      </div>
    );
  }

  const set = <K extends keyof PublicBranding>(key: K, value: PublicBranding[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const save = async () => {
    setBusy(true);
    onError(null);
    const res = await authFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify({
        brandNameAr: form.brandNameAr,
        brandNameEn: form.brandNameEn,
        taglineAr: form.taglineAr,
        taglineEn: form.taglineEn,
        logoMark: form.logoMark,
      }),
    });
    setBusy(false);

    if (!res.ok) return onError(t('admin.updateFailed'));
    setForm((await res.json()).branding);
    setSaved(true);
    // The tab title and every logo are server-rendered from a cached read, so a
    // reload is what actually shows the change everywhere.
    setTimeout(() => window.location.reload(), 900);
  };

  const uploadLogo = async (chosen: File) => {
    setBusy(true);
    onError(null);
    const body = new FormData();
    body.append('file', chosen);

    const res = await authFetch('/api/admin/settings/logo', { method: 'POST', body });
    setBusy(false);

    if (!res.ok) return onError(t('branding.logoFailed'));
    setForm((await res.json()).branding);
    setSaved(true);
    setTimeout(() => window.location.reload(), 900);
  };

  const removeLogo = async () => {
    setBusy(true);
    const res = await authFetch('/api/admin/settings/logo', { method: 'DELETE' });
    setBusy(false);
    if (!res.ok) return onError(t('admin.updateFailed'));
    setForm((await res.json()).branding);
    setTimeout(() => window.location.reload(), 900);
  };

  const field = 'w-full rounded-control border border-line-strong bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-emerald-700';

  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_300px]">
      <div className="flex flex-col gap-5 rounded-card border border-line-soft bg-surface p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-h3">{t('branding.title')}</h2>
          <p className="text-body text-ink-muted">{t('branding.body')}</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-[13.5px] font-medium text-[#3D4741]">{t('branding.nameAr')}</span>
            <input
              className={field}
              value={form.brandNameAr}
              onChange={(e) => set('brandNameAr', e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[13.5px] font-medium text-[#3D4741]">{t('branding.nameEn')}</span>
            <input
              dir="ltr"
              className={field}
              value={form.brandNameEn}
              onChange={(e) => set('brandNameEn', e.target.value)}
            />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium text-[#3D4741]">{t('branding.taglineAr')}</span>
          <input
            className={field}
            value={form.taglineAr}
            onChange={(e) => set('taglineAr', e.target.value)}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-[13.5px] font-medium text-[#3D4741]">{t('branding.taglineEn')}</span>
          <input
            dir="ltr"
            className={field}
            value={form.taglineEn}
            onChange={(e) => set('taglineEn', e.target.value)}
          />
        </label>

        <label className="flex max-w-[180px] flex-col gap-2">
          <span className="text-[13.5px] font-medium text-[#3D4741]">{t('branding.mark')}</span>
          <input
            maxLength={2}
            className={`${field} text-center text-[20px]`}
            value={form.logoMark}
            onChange={(e) => set('logoMark', e.target.value)}
          />
          <span className="text-[12.5px] text-ink-light">{t('branding.markHint')}</span>
        </label>

        <div className="flex flex-col gap-2 border-t border-line-soft pt-5">
          <span className="text-[13.5px] font-medium text-[#3D4741]">{t('branding.logo')}</span>
          <span className="text-[12.5px] text-ink-light">{t('branding.logoHint')}</span>

          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/svg+xml,image/webp"
            className="hidden"
            onChange={(e) => {
              const chosen = e.target.files?.[0];
              if (chosen) void uploadLogo(chosen);
            }}
          />

          <div className="mt-1 flex flex-wrap gap-2.5">
            <button
              disabled={busy}
              onClick={() => file.current?.click()}
              className="rounded-control border border-line-strong bg-surface px-4 py-2.5 text-sm font-medium disabled:opacity-60"
            >
              {t('branding.upload')}
            </button>
            {form.logoUrl && (
              <button
                disabled={busy}
                onClick={() => void removeLogo()}
                className="rounded-control border border-[#E4CBC9] bg-surface px-4 py-2.5 text-sm font-medium text-status-declinedFg disabled:opacity-60"
              >
                {t('branding.remove')}
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3">
          {saved && <span className="text-[13px] text-status-confirmedFg">{t('branding.saved')}</span>}
          <button
            disabled={busy}
            onClick={() => void save()}
            className="rounded-control bg-emerald-700 px-5 py-3 text-sm font-semibold text-[#F7F5EF] disabled:opacity-60"
          >
            {t('common.save')}
          </button>
        </div>
      </div>

      {/* Preview built from the form state, not from context — it has to show
          what is about to be saved, not what is currently live. */}
      <div className="flex flex-col gap-3 rounded-card border border-line-soft bg-surface p-6">
        <span className="text-[12.5px] font-medium text-ink-light">{t('branding.preview')}</span>

        <div className="flex items-center gap-2.5 rounded-control bg-surface-muted p-4">
          {form.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- same-origin upload
            <img src={apiUrl(form.logoUrl)!} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
          ) : (
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-700 text-base font-semibold text-surface-sand">
              {form.logoMark}
            </span>
          )}
          <span className="text-lg font-semibold">
            {locale === 'ar' ? form.brandNameAr : form.brandNameEn}
          </span>
        </div>

        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          {locale === 'ar' ? form.taglineAr : form.taglineEn}
        </p>

        <p className="rounded-control bg-surface-muted px-3.5 py-2.5 font-latin text-[12px] text-ink-light">
          {form.brandNameAr} · {form.brandNameEn}
        </p>
      </div>
    </div>
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
