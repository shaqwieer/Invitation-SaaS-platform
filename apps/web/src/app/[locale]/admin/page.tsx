'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  formatMoney,
  type AdminDesignRequestView,
  type PlatformStats,
  type PublicBranding,
} from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';
import { AdminShell } from '@/components/AdminShell';
import { EVENT_TYPES } from '@/lib/eventForm';
import { apiUrl } from '@/lib/api';

type T = ReturnType<typeof translator>;

type Tab = 'users' | 'events' | 'designs' | 'packages' | 'templates' | 'orders' | 'branding';
const TABS: Tab[] = [
  'users',
  'events',
  'designs',
  'packages',
  'templates',
  'orders',
  'branding',
];

/**
 * The design queue reads a differently-named endpoint and key.
 *
 * `load` derives both from the tab name, which is why every other section is
 * one line of config — «design-requests» is the one that does not match its tab.
 */
const ENDPOINTS: Partial<Record<Tab, { path: string; key: string }>> = {
  designs: { path: 'design-requests', key: 'requests' },
};

interface AdminTemplate {
  id: string;
  key: string;
  nameAr: string;
  nameEn: string;
  category: string;
  /** Already resolved by the API — an upload if there is one, else the URL. */
  previewImageUrl: string | null;
  hasPreviewImage: boolean;
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
 * The whole template row, because `PUT /admin/templates` upserts it.
 *
 * A partial payload would reset everything it omits back to schema defaults —
 * a nudged price silently retiring the template, because `isActive` defaults to
 * true but `category`, `priceHalalas` and `sortOrder` default too.
 *
 * One field is deliberately left out: `previewImageUrl`. The listing route
 * rewrites that column into `/api/templates/:id/preview?v=N` whenever an upload
 * exists, so what arrives here is a resolved path, not the external URL that
 * was stored — sending it back would fail `z.string().url()` and 422 every
 * save. Omitted, it stays `undefined` through Zod and Prisma leaves the column
 * alone, which also means the artwork is edited by uploading, never by typing.
 */
function templatePayload(row: AdminTemplate) {
  return {
    key: row.key,
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    category: row.category,
    priceHalalas: row.priceHalalas,
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
    const route = ENDPOINTS[tab] ?? { path: tab, key: tab };
    const res = await authFetch(`/api/admin/${route.path}${search}`);
    if (!res.ok) return;
    const body = await res.json();
    setRows(body[route.key] ?? []);
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

  /**
   * Retire a catalogue row.
   *
   * The API refuses to delete a package anything points at, because both
   * relations are `SetNull` — the delete would succeed and quietly uncap every
   * event on it. That refusal arrives as a code, so it gets its own message
   * rather than the generic one, which would leave the operator with no idea a
   * paid order was in the way.
   */
  const deletePackage = useCallback(
    async (id: string) => {
      setError(null);
      const res = await authFetch(`/api/admin/packages/${id}`, { method: 'DELETE' });

      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        setError(
          payload?.error?.code === 'PACKAGE_IN_USE'
            ? t('admin.packageInUse')
            : t('admin.updateFailed'),
        );
        return;
      }
      await load();
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
        ) : tab === 'designs' ? (
          <DesignQueue
            requests={rows as AdminDesignRequestView[]}
            t={t}
            locale={locale}
            authFetch={authFetch}
            onError={setError}
            onChanged={load}
          />
        ) : tab === 'packages' ? (
          /* Not a table. A package carries two names, two feature lists, a cap,
             a seat count, a price and two flags — the same reason the design
             queue is cards, applied to the row that has the most fields in the
             catalogue. */
          <PackagesPanel
            packages={rows as AdminPackage[]}
            t={t}
            locale={locale}
            onSave={(body) => upsertCatalogue('packages', body)}
            onDelete={deletePackage}
          />
        ) : (
        <div className="flex flex-col gap-5">
        {tab === 'templates' && (
          <AddTemplateForm
            t={t}
            existing={(rows as AdminTemplate[]).map((row) => row.key)}
            onCreate={(body) => upsertCatalogue('templates', body)}
          />
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
              headers={[
                t('admin.templates'),
                t('admin.category'),
                t('admin.preview'),
                t('admin.price'),
                t('admin.sortOrder'),
                t('admin.events'),
                t('admin.status'),
                '',
              ]}
            >
              {(rows as AdminTemplate[]).map((row) => (
                <tr key={row.id} className="border-t border-[#F2F0EA]">
                  {/* Both names are edited in place. The key is shown but never
                      editable: every write upserts on it, so "renaming" a key
                      would leave the old row behind and create a second one. */}
                  <Cell>
                    <div className="flex flex-col gap-1.5">
                      <CellInput
                        defaultValue={row.nameAr}
                        aria-label={t('admin.nameAr')}
                        className="w-40"
                        onBlur={(e) => {
                          // `catalogueName` is min(2); a one-character name
                          // would 422 and leave the cell showing text that was
                          // never saved.
                          const nameAr = e.target.value.trim();
                          if (nameAr.length >= 2 && nameAr !== row.nameAr) {
                            void upsertCatalogue('templates', { ...templatePayload(row), nameAr });
                          }
                        }}
                      />
                      <CellInput
                        dir="ltr"
                        defaultValue={row.nameEn}
                        aria-label={t('admin.nameEn')}
                        className="w-40 font-latin"
                        onBlur={(e) => {
                          const nameEn = e.target.value.trim();
                          if (nameEn.length >= 2 && nameEn !== row.nameEn) {
                            void upsertCatalogue('templates', { ...templatePayload(row), nameEn });
                          }
                        }}
                      />
                      <span className="font-latin text-xs text-ink-light">{row.key}</span>
                    </div>
                  </Cell>
                  <Cell>
                    <CellSelect
                      value={row.category}
                      aria-label={t('admin.category')}
                      onChange={(e) =>
                        void upsertCatalogue('templates', {
                          ...templatePayload(row),
                          category: e.target.value,
                        })
                      }
                    >
                      {EVENT_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`event.type.${type}`)}
                        </option>
                      ))}
                    </CellSelect>
                  </Cell>
                  {/* The artwork is the template. Showing the row without it
                      would be a catalogue of filenames. */}
                  <Cell>
                    <TemplatePreviewCell
                      template={row}
                      t={t}
                      authFetch={authFetch}
                      onError={setError}
                      onChanged={load}
                    />
                  </Cell>
                  <Cell>
                    <RiyalInput
                      halalas={row.priceHalalas}
                      label={t('admin.price')}
                      onCommit={(priceHalalas) =>
                        void upsertCatalogue('templates', { ...templatePayload(row), priceHalalas })
                      }
                    />
                  </Cell>
                  <Cell>
                    <CellInput
                      type="number"
                      min={0}
                      max={999}
                      defaultValue={row.sortOrder}
                      aria-label={t('admin.sortOrder')}
                      className="w-16 ltr-nums"
                      onBlur={(e) => {
                        const sortOrder = Number(e.target.value);
                        if (Number.isFinite(sortOrder) && sortOrder !== row.sortOrder) {
                          void upsertCatalogue('templates', { ...templatePayload(row), sortOrder });
                        }
                      }}
                    />
                  </Cell>
                  <Cell>{n(row._count?.events ?? 0)}</Cell>
                  <Cell>
                    <Badge ok={row.isActive}>
                      {row.isActive ? t('admin.active') : t('admin.disabled')}
                    </Badge>
                  </Cell>
                  <Cell>
                    <Action
                      onClick={() =>
                        void upsertCatalogue('templates', {
                          ...templatePayload(row),
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
        </div>
        )}
      </div>
    </AdminShell>
  );
}

/* ── Catalogue editing ────────────────────────────────────────────────────── */

/** The inline control every editable catalogue cell is built from. */
function CellInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-emerald-700 ${className}`}
    />
  );
}

function CellSelect({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px] ${className}`}
    />
  );
}

/**
 * Money is stored in halalas and typed in riyals.
 *
 * Every price field in the catalogue needs the same conversion in both
 * directions, and getting it wrong in one place prices a package at 1/100th of
 * what the operator meant — so it is written once.
 */
function RiyalInput({
  halalas,
  label,
  onCommit,
}: {
  halalas: number;
  label: string;
  onCommit: (halalas: number) => void;
}) {
  return (
    <CellInput
      type="number"
      min={0}
      step="0.01"
      // Keyed on the stored value so a save elsewhere in the row (every edit
      // PUTs the whole record) leaves this field showing what is actually saved.
      key={halalas}
      defaultValue={(halalas / 100).toFixed(2)}
      aria-label={label}
      className="w-24 ltr-nums"
      onBlur={(e) => {
        const next = Math.round(Number(e.target.value) * 100);
        if (Number.isFinite(next) && next >= 0 && next !== halalas) onCommit(next);
      }}
    />
  );
}

/** `اسم الباقة` → `asm-albaqa` is useless; an English name is what slugs well. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/**
 * Add a template.
 *
 * Created disabled, always. The public catalogue lists active templates, and a
 * template has no artwork until someone uploads it into the row that does not
 * exist yet — publishing it at creation would put an empty frame in the host's
 * gallery for however long it takes the operator to attach the design.
 */
function AddTemplateForm({
  t,
  existing,
  onCreate,
}: {
  t: T;
  existing: string[];
  onCreate: (body: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [category, setCategory] = useState<string>('WEDDING');
  const [price, setPrice] = useState('0');
  const [duplicate, setDuplicate] = useState(false);

  const effectiveKey = keyTouched ? key : slugify(nameEn);
  const ready = nameAr.trim().length >= 2 && nameEn.trim().length >= 2 && effectiveKey.length >= 2;

  const submit = async () => {
    if (!ready) return;
    // Both catalogue writes are upserts on the key — the server would happily
    // overwrite an existing row here instead of creating one. Neither listing
    // paginates, so `existing` is the whole catalogue and this check is exact.
    if (existing.includes(effectiveKey)) return setDuplicate(true);
    setDuplicate(false);

    const created = await onCreate({
      key: effectiveKey,
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      category,
      priceHalalas: Math.max(0, Math.round(Number(price) * 100)) || 0,
      sortOrder: 0,
      isActive: false,
    });

    if (created === false) return;
    setNameAr('');
    setNameEn('');
    setKey('');
    setKeyTouched(false);
    setPrice('0');
    setOpen(false);
  };

  const close = () => {
    setDuplicate(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <div>
        <Action onClick={() => setOpen(true)}>{t('admin.addTemplate')}</Action>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-soft bg-surface p-6">
      <h2 className="text-h3">{t('admin.addTemplate')}</h2>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <FormField label={t('admin.nameAr')}>
          <PanelInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </FormField>
        <FormField label={t('admin.nameEn')}>
          <PanelInput dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </FormField>
        <FormField label={t('admin.key')} hint={t('admin.keyHint')}>
          <PanelInput
            dir="ltr"
            value={effectiveKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(slugify(e.target.value));
            }}
          />
        </FormField>
        <FormField label={t('admin.category')}>
          <PanelSelect value={category} onChange={(e) => setCategory(e.target.value)}>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`event.type.${type}`)}
              </option>
            ))}
          </PanelSelect>
        </FormField>
        <FormField label={t('admin.priceRiyals')}>
          <PanelInput
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </FormField>
      </div>

      {duplicate && <p className="text-[12.5px] text-status-declinedFg">{t('admin.keyTaken')}</p>}

      <p className="text-[12.5px] text-ink-muted">{t('admin.addTemplateNote')}</p>

      <div className="flex items-center gap-2.5">
        <Action disabled={!ready} onClick={() => void submit()}>
          {t('admin.create')}
        </Action>
        <Action onClick={close}>{t('common.cancel')}</Action>
      </div>
    </div>
  );
}

/**
 * The packages section.
 *
 * A card per package, each an editable form with one save. The alternative —
 * the table this replaced — could only ever expose the two fields that fit in a
 * cell, which is why the names and the feature lists that hosts actually read on
 * the pricing page had no editor at all.
 */
function PackagesPanel({
  packages,
  t,
  locale,
  onSave,
  onDelete,
}: {
  packages: AdminPackage[];
  t: T;
  locale: AppLocale;
  onSave: (body: Record<string, unknown>) => Promise<boolean | undefined>;
  onDelete: (id: string) => Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <AddPackageForm t={t} existing={packages.map((row) => row.key)} onCreate={onSave} />

      {packages.map((row) => (
        <PackageCard key={row.id} row={row} t={t} locale={locale} onSave={onSave} onDelete={onDelete} />
      ))}

      {packages.length === 0 && (
        <div className="rounded-card border border-line-soft bg-surface p-8 text-body text-ink-muted">
          {t('admin.packagesEmpty')}
        </div>
      )}
    </div>
  );
}

/** Features are stored as an array and edited as lines — one per line, as read. */
const toLines = (features: string[]) => features.join('\n');
const fromLines = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);

function PackageCard({
  row,
  t,
  locale,
  onSave,
  onDelete,
}: {
  row: AdminPackage;
  t: T;
  locale: AppLocale;
  onSave: (body: Record<string, unknown>) => Promise<boolean | undefined>;
  onDelete: (id: string) => Promise<void>;
}) {
  // Seeded once, then owned by the operator: the reload that follows a save
  // must not overwrite what they are still typing in the card below it.
  const [draft, setDraft] = useState({
    nameAr: row.nameAr,
    nameEn: row.nameEn,
    guestCap: String(row.guestCap),
    priceRiyals: (row.priceHalalas / 100).toFixed(2),
    scannerSeats: String(row.scannerSeats),
    sortOrder: String(row.sortOrder),
    featuresAr: toLines(row.featuresAr),
    featuresEn: toLines(row.featuresEn),
    isHighlighted: row.isHighlighted,
    isActive: row.isActive,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const inUse = row._count.events > 0 || row._count.orders > 0;

  const set = <K extends keyof typeof draft>(field: K, value: (typeof draft)[K]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  const save = async () => {
    setBusy(true);
    const ok = await onSave({
      key: row.key,
      nameAr: draft.nameAr.trim(),
      nameEn: draft.nameEn.trim(),
      guestCap: Math.max(1, Number(draft.guestCap) || 1),
      priceHalalas: Math.max(0, Math.round(Number(draft.priceRiyals) * 100)) || 0,
      scannerSeats: Math.max(1, Number(draft.scannerSeats) || 1),
      sortOrder: Math.max(0, Number(draft.sortOrder) || 0),
      featuresAr: fromLines(draft.featuresAr),
      featuresEn: fromLines(draft.featuresEn),
      isHighlighted: draft.isHighlighted,
      isActive: draft.isActive,
    });
    setBusy(false);
    if (ok !== false) setSaved(true);
  };

  return (
    <div className="flex flex-col gap-5 rounded-card border border-line-soft bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-h3">{locale === 'ar' ? row.nameAr : row.nameEn}</span>
          <span className="font-latin text-xs text-ink-light">{row.key}</span>
        </div>
        <div className="flex items-center gap-2.5">
          {row.isHighlighted && <Badge ok>{t('admin.highlighted')}</Badge>}
          <Badge ok={row.isActive}>{row.isActive ? t('admin.active') : t('admin.disabled')}</Badge>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <FormField label={t('admin.nameAr')}>
          <PanelInput value={draft.nameAr} onChange={(e) => set('nameAr', e.target.value)} />
        </FormField>
        <FormField label={t('admin.nameEn')}>
          <PanelInput dir="ltr" value={draft.nameEn} onChange={(e) => set('nameEn', e.target.value)} />
        </FormField>
        <FormField label={t('admin.cap')}>
          <PanelInput
            type="number"
            min={1}
            dir="ltr"
            value={draft.guestCap}
            onChange={(e) => set('guestCap', e.target.value)}
          />
        </FormField>
        <FormField label={t('admin.priceRiyals')}>
          <PanelInput
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={draft.priceRiyals}
            onChange={(e) => set('priceRiyals', e.target.value)}
          />
        </FormField>
        <FormField label={t('admin.scannerSeats')}>
          <PanelInput
            type="number"
            min={1}
            dir="ltr"
            value={draft.scannerSeats}
            onChange={(e) => set('scannerSeats', e.target.value)}
          />
        </FormField>
        <FormField label={t('admin.sortOrder')}>
          <PanelInput
            type="number"
            min={0}
            dir="ltr"
            value={draft.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
          />
        </FormField>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label={t('admin.featuresAr')} hint={t('admin.featuresHint')}>
          <PanelTextarea
            value={draft.featuresAr}
            onChange={(e) => set('featuresAr', e.target.value)}
          />
        </FormField>
        <FormField label={t('admin.featuresEn')} hint={t('admin.featuresHint')}>
          <PanelTextarea
            dir="ltr"
            value={draft.featuresEn}
            onChange={(e) => set('featuresEn', e.target.value)}
          />
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-5">
        <Check
          checked={draft.isActive}
          onChange={(next) => set('isActive', next)}
          label={t('admin.activeLabel')}
        />
        <Check
          checked={draft.isHighlighted}
          onChange={(next) => set('isHighlighted', next)}
          label={t('admin.highlightedLabel')}
        />
        <span className="text-[12.5px] text-ink-light">
          {t('admin.usedBy', {
            events: displayNumber(row._count.events, locale),
            orders: displayNumber(row._count.orders, locale),
          })}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {/* Two steps rather than a browser confirm: the dialog blocks the page
              and this is the only irreversible button in the panel. */}
          {inUse ? (
            <span className="text-[12.5px] text-ink-light">{t('admin.packageInUseShort')}</span>
          ) : confirming ? (
            <>
              <Action danger onClick={() => void onDelete(row.id)}>
                {t('admin.confirmDelete')}
              </Action>
              <Action onClick={() => setConfirming(false)}>{t('common.cancel')}</Action>
            </>
          ) : (
            <Action danger onClick={() => setConfirming(true)}>
              {t('common.delete')}
            </Action>
          )}
        </div>

        <div className="flex items-center gap-3">
          {saved && <span className="text-[13px] text-status-confirmedFg">{t('common.saved')}</span>}
          <button
            disabled={busy}
            onClick={() => void save()}
            className="rounded-control bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-[#F7F5EF] disabled:opacity-60"
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AddPackageForm({
  t,
  existing,
  onCreate,
}: {
  t: T;
  existing: string[];
  onCreate: (body: Record<string, unknown>) => Promise<boolean | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [guestCap, setGuestCap] = useState('100');
  const [price, setPrice] = useState('0');
  const [duplicate, setDuplicate] = useState(false);

  const effectiveKey = keyTouched ? key : slugify(nameEn);
  // Mirrors `catalogueName` — min(2) on both names — so an empty form is caught
  // here rather than coming back as a 422 the operator cannot read.
  const ready = nameAr.trim().length >= 2 && nameEn.trim().length >= 2 && effectiveKey.length >= 2;

  const submit = async () => {
    if (!ready) return;
    if (existing.includes(effectiveKey)) return setDuplicate(true);
    setDuplicate(false);

    const created = await onCreate({
      key: effectiveKey,
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      guestCap: Math.max(1, Number(guestCap) || 1),
      priceHalalas: Math.max(0, Math.round(Number(price) * 100)) || 0,
      scannerSeats: 1,
      featuresAr: [],
      featuresEn: [],
      isHighlighted: false,
      // Disabled until the operator has written its feature list — an empty
      // package on the pricing page sells nothing.
      isActive: false,
      sortOrder: 0,
    });

    if (created === false) return;
    setNameAr('');
    setNameEn('');
    setKey('');
    setKeyTouched(false);
    setGuestCap('100');
    setPrice('0');
    setOpen(false);
  };

  const close = () => {
    setDuplicate(false);
    setOpen(false);
  };

  if (!open) {
    return (
      <div>
        <Action onClick={() => setOpen(true)}>{t('admin.addPackage')}</Action>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-soft bg-surface p-6">
      <h2 className="text-h3">{t('admin.addPackage')}</h2>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <FormField label={t('admin.nameAr')}>
          <PanelInput value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
        </FormField>
        <FormField label={t('admin.nameEn')}>
          <PanelInput dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
        </FormField>
        <FormField label={t('admin.key')} hint={t('admin.keyHint')}>
          <PanelInput
            dir="ltr"
            value={effectiveKey}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(slugify(e.target.value));
            }}
          />
        </FormField>
        <FormField label={t('admin.cap')}>
          <PanelInput
            type="number"
            min={1}
            dir="ltr"
            value={guestCap}
            onChange={(e) => setGuestCap(e.target.value)}
          />
        </FormField>
        <FormField label={t('admin.priceRiyals')}>
          <PanelInput
            type="number"
            min={0}
            step="0.01"
            dir="ltr"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </FormField>
      </div>

      {duplicate && <p className="text-[12.5px] text-status-declinedFg">{t('admin.keyTaken')}</p>}

      <p className="text-[12.5px] text-ink-muted">{t('admin.addPackageNote')}</p>

      <div className="flex items-center gap-2.5">
        <Action disabled={!ready} onClick={() => void submit()}>
          {t('admin.create')}
        </Action>
        <Action onClick={close}>{t('common.cancel')}</Action>
      </div>
    </div>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-[12.5px] font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-[11.5px] text-ink-light">{hint}</span>}
    </label>
  );
}

const PANEL_CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3.5 py-2.5 text-[14px] outline-none focus:border-emerald-700';

function PanelInput({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${PANEL_CONTROL} ${className}`} />;
}

function PanelSelect({ className = '', ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${PANEL_CONTROL} ${className}`} />;
}

function PanelTextarea({
  className = '',
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} rows={5} className={`${PANEL_CONTROL} leading-relaxed ${className}`} />;
}

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-emerald-700"
      />
      {label}
    </label>
  );
}

/**
 * A template's artwork, uploaded from this row.
 *
 * The thumbnail doubles as the upload target: the operator's mental model is
 * "this template's picture", and a separate dialog to attach a file to a row
 * that already shows the file it needs would be one screen too many.
 */
function TemplatePreviewCell({
  template,
  t,
  authFetch,
  onError,
  onChanged,
}: {
  template: AdminTemplate;
  t: ReturnType<typeof translator>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onError: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const src = apiUrl(template.previewImageUrl);

  const upload = async (chosen: File) => {
    setBusy(true);
    onError(null);
    const body = new FormData();
    body.append('file', chosen);

    const res = await authFetch(`/api/admin/templates/${template.id}/preview`, {
      method: 'POST',
      body,
    });
    setBusy(false);

    if (!res.ok) return onError(t('card.uploadFailed'));
    await onChanged();
  };

  const remove = async () => {
    setBusy(true);
    const res = await authFetch(`/api/admin/templates/${template.id}/preview`, {
      method: 'DELETE',
    });
    setBusy(false);
    if (!res.ok) return onError(t('admin.updateFailed'));
    await onChanged();
  };

  return (
    <div className="flex items-center gap-2.5">
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const chosen = e.target.files?.[0];
          if (chosen) void upload(chosen);
        }}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => file.current?.click()}
        title={t('admin.uploadPreview')}
        className="flex h-16 w-12 shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-line-strong bg-surface-muted text-[10px] text-ink-faint disabled:opacity-60"
      >
        {src ? (
          /* eslint-disable-next-line @next/next/no-img-element -- operator artwork */
          <img src={src} alt="" className="h-full w-full object-cover" />
        ) : (
          t('admin.noPreview')
        )}
      </button>

      {template.hasPreviewImage && (
        <Action danger onClick={() => void remove()}>
          {t('admin.remove')}
        </Action>
      )}
    </div>
  );
}

/**
 * The design queue — «انا اتواصل معاه واصمم له الي يبغاه بعدين ارفعه ف الموقع».
 *
 * One card per job, because a job is not a table row: it carries a brief the
 * host wrote in prose, a number to call, a price to quote and a file to hand
 * back. Squeezing that into columns would mean opening a dialog for every one of
 * them, and this is a screen the operator works down in a sitting.
 *
 * Two kinds share the queue. A template tailoring is the adaptation of a design
 * the host picked from the gallery — included, so it has no price field. A
 * custom design is drawn from a brief and priced per job.
 *
 * Delivering the artwork is the terminal action: it writes the file into the
 * event's card slot, which is what every guest then sees.
 */
function DesignQueue({
  requests,
  t,
  locale,
  authFetch,
  onError,
  onChanged,
}: {
  requests: AdminDesignRequestView[];
  t: ReturnType<typeof translator>;
  locale: AppLocale;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
  onError: (message: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const digits = locale === 'ar' ? 'arabic' : 'western';

  const patch = async (id: string, body: Record<string, unknown>) => {
    setBusyId(id);
    onError(null);
    const res = await authFetch(`/api/admin/design-requests/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    setBusyId(null);

    if (!res.ok) return onError(t('admin.updateFailed'));
    await onChanged();
  };

  const deliver = async (id: string, file: File) => {
    setBusyId(id);
    onError(null);
    const body = new FormData();
    body.append('file', file);

    const res = await authFetch(`/api/admin/design-requests/${id}/artwork`, {
      method: 'POST',
      body,
    });
    setBusyId(null);

    if (!res.ok) return onError(t('card.uploadFailed'));
    await onChanged();
  };

  if (requests.length === 0) {
    return (
      <div className="rounded-card border border-line-soft bg-surface p-8 text-body text-ink-muted">
        {t('admin.designs.empty')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {requests.map((request) => (
        <DesignQueueCard
          key={request.id}
          request={request}
          busy={busyId === request.id}
          digits={digits}
          t={t}
          onPatch={(body) => void patch(request.id, body)}
          onDeliver={(file) => void deliver(request.id, file)}
        />
      ))}
    </div>
  );
}

function DesignQueueCard({
  request,
  busy,
  digits,
  t,
  onPatch,
  onDeliver,
}: {
  request: AdminDesignRequestView;
  busy: boolean;
  digits: 'arabic' | 'western';
  t: ReturnType<typeof translator>;
  onPatch: (body: Record<string, unknown>) => void;
  onDeliver: (file: File) => void;
}) {
  const file = useRef<HTMLInputElement>(null);
  const custom = request.kind === 'CUSTOM';

  const eventDate = new Date(request.event.startsAt).toLocaleDateString('ar-SA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <div className="flex flex-col gap-4 rounded-card border border-line-soft bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[15px] font-semibold">{request.event.title}</span>
          <span className="text-[12.5px] text-ink-light">
            {request.event.host.name} ·{' '}
            <span className="ltr-nums font-latin">{request.contactPhone}</span> · {eventDate}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-chip bg-surface-muted px-3 py-1.5 text-[12px] text-ink-muted">
            {t(`design.kind.${request.kind}`)}
          </span>
          <select
            value={request.status}
            disabled={busy}
            onChange={(e) => onPatch({ status: e.target.value })}
            className="rounded-[9px] border border-line-strong bg-surface px-2 py-1.5 text-[13px]"
          >
            {['REQUESTED', 'IN_PROGRESS', 'DELIVERED', 'CANCELLED'].map((status) => (
              <option key={status} value={status}>
                {t(`design.status.${status}`)}
              </option>
            ))}
          </select>
          {/* The number is here to be dialled, not read out. */}
          <a
            href={`https://wa.me/${request.contactPhone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noreferrer noopener"
            className="rounded-[9px] bg-emerald-700 px-3 py-1.5 text-[13px] font-semibold text-[#F7F5EF]"
          >
            {t('admin.designs.contact')}
          </a>
        </div>
      </div>

      {request.notes && (
        <div className="flex flex-col gap-1 rounded-control bg-surface-muted px-3.5 py-3">
          <span className="text-[12px] text-ink-light">{t('admin.designs.brief')}</span>
          <span className="whitespace-pre-wrap text-[13px] leading-relaxed">{request.notes}</span>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {/* Only a from-scratch design carries a price; tailoring a chosen
            template is part of the package. */}
        {custom && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] text-ink-light">
              {t('admin.designs.price')}
              {request.billedAt ? ` · ${t('design.priceBilled')}` : ''}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              disabled={busy || request.billedAt !== null}
              defaultValue={
                request.priceHalalas === null ? '' : Math.round(request.priceHalalas / 100)
              }
              placeholder={formatMoney(19_900, { digits })}
              onBlur={(e) => {
                const raw = e.target.value.trim();
                const next = raw === '' ? null : Math.round(Number(raw) * 100);
                if (next !== request.priceHalalas) onPatch({ priceHalalas: next });
              }}
              className="rounded-control border border-line-strong bg-surface px-3 py-2 text-[13.5px] ltr-nums outline-none focus:border-emerald-700 disabled:opacity-60"
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] text-ink-light">{t('admin.designs.reply')}</span>
          <textarea
            defaultValue={request.adminNotes ?? ''}
            disabled={busy}
            rows={2}
            onBlur={(e) => {
              const next = e.target.value.trim() || null;
              if (next !== request.adminNotes) onPatch({ adminNotes: next });
            }}
            className="rounded-control border border-line-strong bg-surface px-3 py-2 text-[13.5px] leading-relaxed outline-none focus:border-emerald-700"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-4">
        <span className="text-[12.5px] text-ink-light">
          {request.event.hasCardImage
            ? t('admin.designs.delivered')
            : t('admin.designs.notDelivered')}
        </span>

        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            const chosen = e.target.files?.[0];
            if (chosen) onDeliver(chosen);
          }}
        />
        <Action onClick={() => file.current?.click()}>{t('admin.designs.upload')}</Action>
      </div>
    </div>
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
        customDesignPriceHalalas: form.customDesignPriceHalalas,
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

        {/* The "from" price for a custom design. The figure actually charged is
            quoted per job on the design queue; this is what hosts are shown
            before they ask. */}
        <label className="flex max-w-[240px] flex-col gap-2">
          <span className="text-[13.5px] font-medium text-[#3D4741]">
            {t('branding.designPrice')}
          </span>
          <input
            type="number"
            min={0}
            dir="ltr"
            className={`${field} ltr-nums`}
            value={Math.round(form.customDesignPriceHalalas / 100)}
            onChange={(e) =>
              set('customDesignPriceHalalas', Math.max(0, Math.round(Number(e.target.value) * 100)))
            }
          />
          <span className="text-[12.5px] text-ink-light">{t('branding.designPriceHint')}</span>
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
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-[9px] border px-3 py-1.5 text-[12.5px] font-medium disabled:opacity-50 ${
        danger ? 'border-[#E4C9C6] text-status-declined' : 'border-line-strong text-ink'
      }`}
    >
      {children}
    </button>
  );
}
