'use client';

/**
 * Guest list (§05 of the design doc).
 *
 * The design's central decision, kept verbatim: «إرسال عبر واتساب» stays visible
 * in every row rather than hiding behind a «⋯» menu, because it is the action
 * repeated hundreds of times on this screen. Once sent it becomes a quiet
 * «أُرسلت · إعادة» instead of disappearing, so the host can see where they
 * stopped — and so re-sending to someone who says the message never arrived is
 * one tap, not an impossibility.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  GUEST_STATUSES,
  guestDisplayName,
  type GuestStatus,
  type GuestStatusCounts,
} from '@da3wa/shared';
import { useAuth } from '@/lib/auth';
import { useEvents } from '@/components/EventContext';
import { browserApiBase } from '@/lib/api';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LinkButton,
  Modal,
  PageHeader,
  PhoneInput,
  Select,
  Spinner,
  StatusChip,
  TableFrame,
  Td,
  Textarea,
  Th,
  Toast,
  type ToastMessage,
} from '@/components/ui';
import { SendQueue } from '@/components/SendQueue';
import { GuestBatches } from '@/components/GuestBatches';
import { DEFAULT_LOCALE, isLocale, translator, type AppLocale } from '@/lib/i18n';
import { displayNumber, formatEventDate } from '@/lib/format';

const PAGE_SIZE = 25;

/** Name and phone are null on a delegated slot nobody has claimed yet. */
interface GuestRow {
  id: string;
  name: string | null;
  phone: string | null;
  group: string | null;
  section: 'MEN' | 'WOMEN' | null;
  companionsAllowed: number;
  companionsConfirmed: number;
  status: GuestStatus;
  notes: string | null;
  updatedAt: string;
  invitation: {
    token: string;
    displayCode: string;
    sentAt: string | null;
    openedAt: string | null;
  } | null;
}

interface InviteLink {
  url: string;
  message: string;
  whatsappUrl: string;
}

/** The shape both the add and edit modals edit. */
interface GuestDraft {
  name: string;
  phone: string;
  group: string;
  section: '' | 'MEN' | 'WOMEN';
  companionsAllowed: number;
  notes: string;
}

const EMPTY_DRAFT: GuestDraft = {
  name: '',
  phone: '',
  group: '',
  section: '',
  companionsAllowed: 0,
  notes: '',
};

export default function GuestsPage() {
  const params = useParams<{ locale: string; eventId: string }>();
  const locale: AppLocale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const n = (value: number) => displayNumber(value, locale);
  const { authFetch } = useAuth();
  const { current } = useEvents();
  const eventId = params.eventId;

  const [rows, setRows] = useState<GuestRow[] | null>(null);
  const [counts, setCounts] = useState<GuestStatusCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<GuestStatus | ''>('');
  const [sort, setSort] = useState<'updatedAt' | 'createdAt' | 'name' | 'status'>('updatedAt');
  const [failed, setFailed] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<GuestRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<GuestRow | 'bulk' | null>(null);
  const [link, setLink] = useState<{ guest: GuestRow; link: InviteLink } | null>(null);
  const [bulkLinks, setBulkLinks] = useState<
    Array<{ guestId: string; guestName: string; whatsappUrl: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  // Typing shouldn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => setPage(1), [debounced, status, sort]);

  const load = useCallback(async () => {
    if (!eventId) return;
    setFailed(false);

    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sort,
      order: sort === 'name' ? 'asc' : 'desc',
    });
    if (debounced) query.set('search', debounced);
    if (status) query.set('status', status);

    try {
      const res = await authFetch(`/api/events/${eventId}/guests?${query}`);
      if (!res.ok) return setFailed(true);
      const body = await res.json();
      setRows(body.guests);
      setCounts(body.counts);
      setTotal(body.pagination.total);
    } catch {
      setFailed(true);
    }
  }, [eventId, page, debounced, status, sort, authFetch]);

  useEffect(() => {
    void load();
  }, [load]);

  /* ── Mutations ─────────────────────────────────────────────────────────── */

  const saveGuest = useCallback(
    async (draft: GuestDraft, guest: GuestRow | null) => {
      setBusy(true);
      const payload = {
        name: draft.name,
        phone: draft.phone,
        group: draft.group || null,
        section: draft.section || null,
        companionsAllowed: draft.companionsAllowed,
        notes: draft.notes || null,
      };

      try {
        const res = await authFetch(
          guest
            ? `/api/events/${eventId}/guests/${guest.id}`
            : `/api/events/${eventId}/guests`,
          { method: guest ? 'PATCH' : 'POST', body: JSON.stringify(payload) },
        );

        if (!res.ok) {
          const body = await res.json().catch(() => null);
          setToast({
            tone: 'error',
            text:
              body?.error?.code === 'GUEST_DUPLICATE'
                ? t('guests.duplicate')
                : (body?.error?.details?.messageAr ?? t('common.genericError')),
          });
          return false;
        }

        setToast({ tone: 'success', text: guest ? t('guests.updatedOk') : t('guests.added') });
        await load();
        return true;
      } finally {
        setBusy(false);
      }
    },
    [authFetch, eventId, load, t],
  );

  const removeGuests = useCallback(async () => {
    setBusy(true);
    try {
      const bulk = confirmDelete === 'bulk';
      const ids = bulk ? [...selected] : [(confirmDelete as GuestRow).id];

      const res = bulk
        ? await authFetch(`/api/events/${eventId}/guests/bulk-delete`, {
            method: 'POST',
            body: JSON.stringify({ guestIds: ids }),
          })
        : await authFetch(`/api/events/${eventId}/guests/${ids[0]}`, { method: 'DELETE' });

      if (!res.ok) {
        setToast({ tone: 'error', text: t('common.genericError') });
        return;
      }

      setToast({
        tone: 'success',
        text: bulk ? t('guests.deletedMany', { count: n(ids.length) }) : t('guests.deleted'),
      });
      setSelected(new Set());
      setConfirmDelete(null);
      await load();
    } finally {
      setBusy(false);
    }
  }, [authFetch, confirmDelete, eventId, load, selected, t, n]);

  /** One guest: mint the link, mark SENT, and hand the host the WhatsApp URL. */
  const sendOne = useCallback(
    async (guest: GuestRow) => {
      setBusy(true);
      try {
        const res = await authFetch(`/api/events/${eventId}/guests/${guest.id}/send`, {
          method: 'POST',
          body: JSON.stringify({ locale }),
        });

        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setToast({
            tone: 'error',
            text:
              body?.error?.code === 'GUEST_QUOTA_EXCEEDED'
                ? t('guests.quotaExceeded')
                : t('common.genericError'),
          });
          return;
        }

        setLink({ guest, link: body.link });
        await load();
      } finally {
        setBusy(false);
      }
    },
    [authFetch, eventId, load, locale, t],
  );

  const sendSelected = useCallback(async () => {
    setBusy(true);
    try {
      const res = await authFetch(`/api/events/${eventId}/guests/bulk-send`, {
        method: 'POST',
        body: JSON.stringify({ guestIds: [...selected], locale }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setToast({
          tone: 'error',
          text:
            body?.error?.code === 'GUEST_QUOTA_EXCEEDED'
              ? t('guests.quotaExceeded')
              : t('common.genericError'),
        });
        return;
      }

      // Browsers block every window.open after the first, so a burst would send
      // one invitation and silently drop the rest. The host taps through instead.
      setSelected(new Set());
      await load();
      setBulkLinks(body.links ?? []);

      // Ticking a delegated slot is easy to do by accident — it is a row in the
      // same table. Getting three links back for five ticks needs a sentence,
      // not silence.
      if (body.skipped > 0) {
        setToast({ tone: 'error', text: t('guests.skippedUnclaimed', { count: n(body.skipped) }) });
      }
    } finally {
      setBusy(false);
    }
  }, [authFetch, eventId, load, locale, selected, t, n]);

  const changeStatus = useCallback(
    async (next: GuestStatus) => {
      setBusy(true);
      try {
        const res = await authFetch(`/api/events/${eventId}/guests/bulk-status`, {
          method: 'POST',
          body: JSON.stringify({ guestIds: [...selected], status: next }),
        });
        if (!res.ok) {
          setToast({ tone: 'error', text: t('common.genericError') });
          return;
        }
        const body = await res.json();
        setToast({ tone: 'success', text: t('guests.statusChanged', { count: n(body.updated) }) });
        setSelected(new Set());
        await load();
      } finally {
        setBusy(false);
      }
    },
    [authFetch, eventId, load, selected, t, n],
  );

  /* ── Render ────────────────────────────────────────────────────────────── */

  const eventDate = current ? formatEventDate(current.startsAt, current.timezone, locale) : null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const allOnPageSelected = !!rows?.length && rows.every((row) => selected.has(row.id));

  const chips = useMemo(
    () =>
      [
        { key: '' as const, label: t('guests.filterAll'), count: counts?.total ?? 0 },
        ...GUEST_STATUSES.map((value) => ({
          key: value,
          label: t(`status.${value}`),
          count: counts?.[value] ?? 0,
        })),
      ],
    [counts, t],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={t('guests.title')}
        subtitle={
          current && eventDate ? `${current.title} · ${eventDate.gregorian}` : undefined
        }
        actions={
          <>
            <LinkButton
              href={`${browserApiBase()}/api/events/${eventId}/exports/guests.xlsx`}
              size="sm"
            >
              {t('guests.export')}
            </LinkButton>
            <LinkButton href={`/${locale}/events/${eventId}/guests/import`} size="sm">
              {t('guests.import')}
            </LinkButton>
            <Button size="sm" onClick={() => setAdding(true)}>
              {t('guests.add')}
            </Button>
          </>
        }
      />

      <GuestBatches
        eventId={eventId}
        locale={locale}
        t={t}
        onToast={setToast}
        onGuestsChanged={load}
      />

      <Card className="flex flex-col">
        <div className="flex flex-col gap-4 border-b border-line-soft p-5">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('guests.searchPlaceholder')}
              aria-label={t('guests.searchPlaceholder')}
              className="max-w-sm flex-1"
            />
            <label className="flex items-center gap-2 text-[13px] text-ink-light">
              {t('guests.sortBy')}
              <Select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="w-auto py-2 text-[13px]"
              >
                <option value="updatedAt">{t('guests.sort.updatedAt')}</option>
                <option value="createdAt">{t('guests.sort.createdAt')}</option>
                <option value="name">{t('guests.sort.name')}</option>
                <option value="status">{t('guests.sort.status')}</option>
              </Select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {chips.map((chip) => (
              <button
                key={chip.key || 'all'}
                onClick={() => setStatus(chip.key)}
                aria-pressed={status === chip.key}
                className={`rounded-chip border px-3.5 py-1.5 text-[13px] transition-colors ${
                  status === chip.key
                    ? 'border-emerald-700 bg-emerald-700 font-medium text-[#F7F5EF]'
                    : 'border-line-strong bg-surface text-ink-muted hover:border-ink-light'
                }`}
              >
                {chip.label} <span className="ms-1 ltr-nums">{n(chip.count)}</span>
              </button>
            ))}
          </div>
        </div>

        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line-soft bg-surface-sand px-5 py-3">
            <span className="text-[13.5px] font-medium">
              {t('guests.selected', { count: n(selected.size) })}
            </span>
            <Button size="sm" disabled={busy} onClick={() => void sendSelected()}>
              {t('guests.sendSelected')}
            </Button>
            <Select
              value=""
              disabled={busy}
              onChange={(e) => e.target.value && void changeStatus(e.target.value as GuestStatus)}
              className="w-auto py-2 text-[13px]"
              aria-label={t('guests.changeStatus')}
            >
              <option value="">{t('guests.changeStatus')}</option>
              <option value="NOT_SENT">{t('status.NOT_SENT')}</option>
              <option value="SENT">{t('status.SENT')}</option>
              <option value="CONFIRMED">{t('status.CONFIRMED')}</option>
              <option value="DECLINED">{t('status.DECLINED')}</option>
            </Select>
            <Button
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => setConfirmDelete('bulk')}
            >
              {t('common.delete')}
            </Button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-[13px] text-ink-light underline"
            >
              {t('guests.clearSelection')}
            </button>
          </div>
        )}

        {failed ? (
          <ErrorState
            title={t('guests.errorTitle')}
            body={t('guests.errorBody')}
            onRetry={() => void load()}
            retryLabel={t('common.retry')}
          />
        ) : !rows ? (
          <Spinner label={t('common.loading')} />
        ) : rows.length === 0 ? (
          debounced || status ? (
            <EmptyState title={t('guests.emptyFiltered')} body={t('guests.emptyFilteredBody')} />
          ) : (
            <EmptyState
              title={t('guests.empty')}
              body={t('guests.emptyBody')}
              action={
                <div className="flex flex-wrap justify-center gap-2.5">
                  <Button onClick={() => setAdding(true)}>{t('guests.add')}</Button>
                  <LinkButton href={`/${locale}/events/${eventId}/guests/import`}>
                    {t('guests.import')}
                  </LinkButton>
                </div>
              }
            />
          )
        ) : (
          <>
            <TableFrame>
              <thead>
                <tr>
                  <Th className="w-10">
                    <Checkbox
                      checked={allOnPageSelected}
                      aria-label={t('guests.selectAll')}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          for (const row of rows)
                            e.target.checked ? next.add(row.id) : next.delete(row.id);
                          return next;
                        })
                      }
                    />
                  </Th>
                  <Th>{t('guests.col.name')}</Th>
                  <Th>{t('guests.col.phone')}</Th>
                  <Th>{t('guests.col.companions')}</Th>
                  <Th>{t('guests.col.status')}</Th>
                  <Th>{t('guests.col.actions')}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-muted">
                    <Td>
                      <Checkbox
                        checked={selected.has(row.id)}
                        aria-label={guestDisplayName(row.name, locale)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            e.target.checked ? next.add(row.id) : next.delete(row.id);
                            return next;
                          })
                        }
                      />
                    </Td>
                    {/* A delegated slot has neither name nor number until
                        somebody claims it. Shown as what it is — «دعوة موزَّعة» —
                        rather than as two blank cells the host would read as
                        corrupted data. */}
                    <Td>
                      <div className="flex flex-col">
                        <span className={`font-medium ${row.name ? '' : 'text-ink-faint'}`}>
                          {row.name ?? t('guests.unclaimed')}
                        </span>
                        {row.group && (
                          <span className="text-[12.5px] text-ink-light">{row.group}</span>
                        )}
                      </div>
                    </Td>
                    <Td>
                      <span dir="ltr" className="font-latin text-[13.5px] text-ink-muted">
                        {row.phone ?? '—'}
                      </span>
                    </Td>
                    <Td className="ltr-nums">
                      {row.companionsAllowed > 0 ? n(row.companionsAllowed) : t('common.none')}
                    </Td>
                    <Td>
                      <StatusChip status={row.status} label={t(`status.${row.status}`)} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={row.invitation?.sentAt ? 'secondary' : 'primary'}
                          disabled={busy}
                          onClick={() => void sendOne(row)}
                        >
                          {row.invitation?.sentAt ? t('guests.resend') : t('guests.send')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditing(row)}>
                          {t('common.edit')}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>

            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <span className="text-[13px] text-ink-light">
                {t('guests.showing', {
                  from: n((page - 1) * PAGE_SIZE + 1),
                  to: n(Math.min(page * PAGE_SIZE, total)),
                  total: n(total),
                })}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page === 1}
                    onClick={() => setPage((p) => p - 1)}
                  >
                    {t('common.back')}
                  </Button>
                  <span className="text-[13px] text-ink-muted ltr-nums">
                    {n(page)} / {n(totalPages)}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={page === totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </Card>

      {(adding || editing) && (
        <GuestModal
          guest={editing}
          t={t}
          busy={busy}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
          onDelete={editing ? () => setConfirmDelete(editing) : undefined}
          onSave={async (draft) => {
            const ok = await saveGuest(draft, editing);
            if (ok) {
              setAdding(false);
              setEditing(null);
            }
          }}
        />
      )}

      {confirmDelete && (
        <Modal
          title={
            confirmDelete === 'bulk'
              ? t('guests.deleteManyTitle', { count: n(selected.size) })
              : t('guests.deleteTitle', {
                  name: guestDisplayName(confirmDelete.name, locale),
                })
          }
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                {t('common.cancel')}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void removeGuests()}>
                {t('common.delete')}
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-muted">{t('guests.deleteBody')}</p>
        </Modal>
      )}

      {link && (
        <Modal
          title={t('guests.linkTitle', { name: guestDisplayName(link.guest.name, locale) })}
          description={t('guests.linkBody')}
          onClose={() => setLink(null)}
          footer={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(link.link.url);
                  setToast({ tone: 'success', text: t('common.copied') });
                }}
              >
                {t('common.copy')}
              </Button>
              <LinkButton
                variant="primary"
                href={link.link.whatsappUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t('guests.openWhatsapp')}
              </LinkButton>
            </>
          }
        >
          <p
            dir="ltr"
            className="rounded-control bg-surface-muted px-4 py-3 font-latin text-[13px] text-ink-muted"
          >
            {link.link.url}
          </p>
        </Modal>
      )}

      {bulkLinks.length > 0 && (
        <Modal
          title={t('dash.sendTitle')}
          description={t('dash.sendBody')}
          onClose={() => setBulkLinks([])}
          footer={
            <Button variant="secondary" onClick={() => setBulkLinks([])}>
              {t('common.close')}
            </Button>
          }
        >
          <SendQueue links={bulkLinks} locale={locale} t={t} />
        </Modal>
      )}

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

/* ── Add / edit ───────────────────────────────────────────────────────────── */

function GuestModal({
  guest,
  t,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  guest: GuestRow | null;
  t: ReturnType<typeof translator>;
  busy: boolean;
  onClose: () => void;
  onSave: (draft: GuestDraft) => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = useState<GuestDraft>(
    guest
      ? {
          // Editing an unclaimed slot starts from blank fields, and saving
          // fills them in — the same form the host uses for any other guest.
          name: guest.name ?? '',
          phone: guest.phone ?? '',
          group: guest.group ?? '',
          section: guest.section ?? '',
          companionsAllowed: guest.companionsAllowed,
          notes: guest.notes ?? '',
        }
      : EMPTY_DRAFT,
  );

  const set = <K extends keyof GuestDraft>(key: K, value: GuestDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Modal
      title={guest ? t('guests.editTitle') : t('guests.addTitle')}
      onClose={onClose}
      footer={
        <>
          {onDelete && (
            <Button variant="danger" onClick={onDelete} className="me-auto">
              {t('common.delete')}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={busy || !draft.name.trim() || !draft.phone.trim()} onClick={() => onSave(draft)}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={t('guests.name')} required>
          <Input value={draft.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>

        <Field label={t('guests.phone')} required>
          <PhoneInput value={draft.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('guests.companionsAllowed')}>
            <Input
              type="number"
              min={0}
              max={20}
              value={draft.companionsAllowed}
              onChange={(e) => set('companionsAllowed', Number(e.target.value))}
            />
          </Field>

          <Field label={t('guests.section')}>
            <Select
              value={draft.section}
              onChange={(e) => set('section', e.target.value as GuestDraft['section'])}
            >
              <option value="">{t('guests.sectionNone')}</option>
              <option value="MEN">{t('guests.sectionMen')}</option>
              <option value="WOMEN">{t('guests.sectionWomen')}</option>
            </Select>
          </Field>
        </div>

        <Field label={t('guests.group')} hint={t('guests.groupHint')}>
          <Input value={draft.group} onChange={(e) => set('group', e.target.value)} />
        </Field>

        <Field label={t('guests.notes')}>
          <Textarea value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
