'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScanResult, ScanSession, ScanStats } from '@da3wa/shared';
import { displayNumber } from '@/lib/format';
import {
  ScanApiError,
  clearSession,
  fetchLog,
  loadSession,
  openGate,
  saveSession,
  searchGuests,
  submitCheckIn,
  submitOverride,
} from '@/lib/scanner';

type View = 'gate' | 'camera' | 'result' | 'manual' | 'log';
type CameraState = 'starting' | 'live' | 'denied' | 'unavailable';

interface SearchHit {
  guestId: string;
  name: string;
  group: string | null;
  seats: number;
  displayCode: string;
  alreadyCheckedIn: boolean;
}

/**
 * The reception scanner (§10).
 *
 * The design's governing constraint: every result is read from arm's length, in
 * a dim hall, by someone with a queue behind them. So the verdict colour fills
 * half the screen, the name is large, and the seat count is the biggest number
 * on it — that is what the staff member actually acts on.
 */
export function ScannerClient({ eventId }: { eventId: string }) {
  const [session, setSession] = useState<ScanSession | null>(null);
  const [view, setView] = useState<View>('gate');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const stored = loadSession(eventId);
    if (stored) {
      setSession(stored);
      setView('camera');
    }
  }, [eventId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const handleExpired = useCallback(() => {
    clearSession(eventId);
    setSession(null);
    setView('gate');
    setError('انتهت جلسة الماسح — أدخل كلمة المرور من جديد');
  }, [eventId]);

  async function guard<T>(work: () => Promise<T>): Promise<T | null> {
    try {
      setError(null);
      return await work();
    } catch (err) {
      if (err instanceof ScanApiError && err.status === 401) {
        handleExpired();
        return null;
      }
      setError(err instanceof Error ? err.message : 'تعذّر الاتصال بالخادم');
      return null;
    }
  }

  if (!session || view === 'gate') {
    return (
      <Gate
        eventId={eventId}
        error={error}
        onOpened={(opened) => {
          saveSession(eventId, opened);
          setSession(opened);
          setError(null);
          setView('camera');
        }}
        onError={setError}
      />
    );
  }

  const token = session.sessionToken;

  return (
    <main dir="rtl" className="flex min-h-screen flex-col bg-emerald-ink text-surface-sand">
      {!online && (
        <div className="flex items-center justify-between bg-status-pending px-5 py-3 text-[13.5px] font-medium text-[#FFFDF7]">
          <span className="inline-flex items-center gap-2">
            <span className="h-[7px] w-[7px] rounded-full bg-[#FFFDF7]" />
            بلا شبكة — أعد الاتصال للمتابعة
          </span>
        </div>
      )}

      {view === 'camera' && (
        <CameraView
          session={session}
          onResult={(next) => {
            setResult(next);
            setView('result');
          }}
          onManual={() => setView('manual')}
          onLog={() => setView('log')}
          onScan={(qrToken) => guard(() => submitCheckIn(token, { qrToken }))}
          error={error}
        />
      )}

      {view === 'result' && result && (
        <ResultView
          result={result}
          onNext={() => {
            setResult(null);
            setView('camera');
          }}
          onManual={() => setView('manual')}
          onOverride={async (seats) => {
            const next = await guard(() =>
              submitOverride(token, {
                guestId: result.guest!.guestId,
                seats,
                reason: 'سُمح بالدخول عند الباب',
              }),
            );
            if (next) setResult(next);
          }}
        />
      )}

      {view === 'manual' && (
        <ManualView
          onBack={() => setView('camera')}
          onSearch={(q) => guard(() => searchGuests(token, q))}
          onPick={async (guestId) => {
            const next = await guard(() => submitCheckIn(token, { guestId }));
            if (next) {
              setResult(next);
              setView('result');
            }
          }}
          onCode={async (displayCode) => {
            const next = await guard(() => submitCheckIn(token, { displayCode }));
            if (next) {
              setResult(next);
              setView('result');
            }
          }}
          error={error}
        />
      )}

      {view === 'log' && (
        <LogView
          session={session}
          onBack={() => setView('camera')}
          onLoad={() => guard(() => fetchLog(token))}
        />
      )}
    </main>
  );
}

// ─── Gate ────────────────────────────────────────────────────────────────────

function Gate({
  eventId,
  error,
  onOpened,
  onError,
}: {
  eventId: string;
  error: string | null;
  onOpened: (session: ScanSession) => void;
  onError: (message: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    try {
      onOpened(await openGate(eventId, password, displayName));
    } catch (err) {
      onError(err instanceof ScanApiError ? 'كلمة المرور غير صحيحة' : 'تعذّر الاتصال بالخادم');
    } finally {
      setPending(false);
    }
  }

  return (
    <main
      dir="rtl"
      className="flex min-h-screen flex-col justify-center gap-6 bg-emerald-ink px-7 py-9 text-surface-sand"
    >
      <div className="flex flex-col items-center gap-2.5">
        <div className="flex h-11 w-11 items-center justify-center rounded-[13px] bg-emerald-700 text-[21px] font-semibold">
          د
        </div>
        <span className="text-[21px] font-semibold">ماسح الاستقبال</span>
        <span className="text-center text-[13.5px] leading-relaxed text-[#8FA69B]">
          أدخل كلمة مرور المناسبة للبدء
        </span>
      </div>

      <form onSubmit={submit} className="mt-2 flex flex-col gap-3.5">
        <label className="flex flex-col gap-2.5">
          <span className="text-[13.5px] font-medium text-[#A9C6BA]">كلمة مرور المناسبة</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="off"
            required
            className="rounded-[13px] border border-[#1B3A30] bg-[#122E25] p-4 text-base text-surface-sand outline-none focus:border-emerald-500"
          />
        </label>

        <label className="flex flex-col gap-2.5">
          <span className="text-[13.5px] font-medium text-[#A9C6BA]">
            اسمك <span className="font-normal text-[#6C857B]">(يظهر في السجل)</span>
          </span>
          {/* Optional, but strongly wanted: it is what makes every check-in —
              and every override — attributable to a person on shift. */}
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="سعود · بوابة الرجال"
            className="rounded-[13px] border border-[#1B3A30] bg-[#122E25] p-4 text-base text-surface-sand outline-none placeholder:text-[#4E5F57] focus:border-emerald-500"
          />
        </label>

        {error && (
          <p className="rounded-xl bg-[#3A1F1F] px-4 py-3 text-center text-[13.5px] text-[#F3D8D8]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 h-14 rounded-[14px] bg-surface-sand text-[16.5px] font-semibold text-emerald-800 disabled:opacity-60"
        >
          {pending ? 'جارٍ الفتح…' : 'فتح الكاميرا'}
        </button>
      </form>

      <p className="mt-2 rounded-[14px] bg-[#122E25] p-4 text-[13px] leading-loose text-[#8FA69B]">
        الماسح يحتاج اتصالًا بالإنترنت. تأكد من التغطية داخل القاعة قبل بدء الاستقبال.
      </p>
    </main>
  );
}

// ─── Camera ──────────────────────────────────────────────────────────────────

const READER_ID = 'da3wa-reader';

function CameraView({
  session,
  onResult,
  onManual,
  onLog,
  onScan,
  error,
}: {
  session: ScanSession;
  onResult: (result: ScanResult) => void;
  onManual: () => void;
  onLog: () => void;
  onScan: (qrToken: string) => Promise<ScanResult | null>;
  error: string | null;
}) {
  const [state, setState] = useState<CameraState>('starting');
  /** Guards against the decoder firing repeatedly while a request is in flight. */
  const busy = useRef(false);

  useEffect(() => {
    let scanner: { stop: () => Promise<void>; clear: () => void } | null = null;
    let cancelled = false;

    (async () => {
      try {
        // Imported here, not at module scope: html5-qrcode touches `document`
        // on load, which breaks the server build.
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        const instance = new Html5Qrcode(READER_ID, { verbose: false });
        scanner = instance as unknown as typeof scanner;

        await instance.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          async (decoded) => {
            if (busy.current) return;
            busy.current = true;
            const result = await onScan(decoded);
            if (result) onResult(result);
            // Released when the view unmounts; a result screen always follows.
            setTimeout(() => (busy.current = false), 1500);
          },
          () => {
            // Per-frame decode misses are the normal case, not an error.
          },
        );

        if (!cancelled) setState('live');
      } catch (err) {
        if (cancelled) return;
        const message = String(err);
        setState(/NotAllowed|Permission|denied/i.test(message) ? 'denied' : 'unavailable');
      }
    })();

    return () => {
      cancelled = true;
      void scanner?.stop().catch(() => undefined);
    };
  }, [onScan, onResult]);

  if (state === 'denied' || state === 'unavailable') {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-4.5 px-9 text-center">
          <div className="flex h-[72px] w-[72px] items-center justify-center rounded-[22px] bg-[#122E25] text-[34px] font-light text-[#C77B7B]">
            ✕
          </div>
          <span className="text-[22px] font-semibold">
            {state === 'denied' ? 'الكاميرا غير مسموح لها' : 'تعذّر تشغيل الكاميرا'}
          </span>
          <p className="max-w-[290px] text-body text-[#8FA69B]">
            {state === 'denied'
              ? 'رفض المتصفح الوصول للكاميرا. افتح إعدادات الموقع واسمح بالكاميرا، ثم أعد المحاولة — أو أدخل اسم الضيف يدويًا.'
              : 'لم نعثر على كاميرا متاحة على هذا الجهاز. يمكنك إدخال اسم الضيف يدويًا.'}
          </p>
          {state === 'denied' && (
            <div className="flex w-full flex-col gap-2 rounded-[14px] bg-[#122E25] p-4">
              <span className="text-[13.5px] font-medium">الإعدادات ← الخصوصية ← الكاميرا</span>
              <span className="text-xs text-[#6C857B]">اسمح دائمًا لهذا الموقع</span>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-2.5 p-5">
          <button
            onClick={() => window.location.reload()}
            className="h-14 rounded-[15px] bg-surface-sand text-[16.5px] font-semibold text-emerald-800"
          >
            أعد المحاولة
          </button>
          <button
            onClick={onManual}
            className="h-[50px] rounded-[14px] border border-[#1B3A30] text-[15px] font-medium text-[#A9C6BA]"
          >
            إدخال يدوي بالاسم
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between bg-emerald-ink px-5 py-4">
        <span className="text-[14.5px] font-medium">امسح رمز الضيف</span>
        <span className="inline-flex items-center gap-2 text-xs text-[#8FA69B]">
          <span className="h-[7px] w-[7px] rounded-full bg-[#4ED08F]" />
          {session.displayName}
        </span>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#1A2622]">
        <div id={READER_ID} className="absolute inset-0 [&_video]:h-full [&_video]:object-cover" />

        {state === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#1A2622]">
            <span className="h-9 w-9 animate-spin rounded-full border-[2.5px] border-[rgba(243,239,228,.2)] border-t-surface-sand" />
            <span className="text-[15px] font-medium text-[#A9C6BA]">جارٍ تشغيل الكاميرا…</span>
            <span className="max-w-[250px] text-center text-[13px] text-[#6C857B]">
              إذا ظهر طلب الإذن، اختر «السماح» ليعمل الماسح.
            </span>
          </div>
        )}

        {/* Corner brackets and the sweep line — the design's framing cue. */}
        <div className="pointer-events-none relative h-[250px] w-[250px]">
          {(
            [
              'top-0 right-0 border-t-[3px] border-r-[3px] rounded-tr-[14px]',
              'top-0 left-0 border-t-[3px] border-l-[3px] rounded-tl-[14px]',
              'bottom-0 right-0 border-b-[3px] border-r-[3px] rounded-br-[14px]',
              'bottom-0 left-0 border-b-[3px] border-l-[3px] rounded-bl-[14px]',
            ] as const
          ).map((corner) => (
            <div key={corner} className={`absolute h-11 w-11 border-surface-sand ${corner}`} />
          ))}
        </div>
      </div>

      {error && (
        <p className="bg-[#3A1F1F] px-5 py-3 text-center text-[13.5px] text-[#F3D8D8]">{error}</p>
      )}

      <div className="flex flex-col gap-3.5 bg-emerald-ink px-5 pb-6 pt-4">
        <div className="flex gap-2.5">
          <button
            onClick={onManual}
            className="h-12 flex-1 rounded-xl border border-[#1B3A30] bg-[#122E25] text-sm font-medium text-[#A9C6BA]"
          >
            إدخال يدوي بالاسم
          </button>
          <button
            onClick={onLog}
            className="h-12 w-12 rounded-xl border border-[#1B3A30] bg-[#122E25] text-[17px] text-[#A9C6BA]"
            aria-label="سجل المسح"
          >
            ☰
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Result ──────────────────────────────────────────────────────────────────

/** Colour carries the verdict before any word is read. */
const VERDICT_STYLE: Record<string, { bg: string; accent: string; icon: string }> = {
  VALID: { bg: 'bg-emerald-700', accent: 'text-[#A9E3C9]', icon: '✓' },
  USED: { bg: 'bg-status-pending', accent: 'text-[#F6E3BC]', icon: '!' },
  INVALID: { bg: 'bg-status-declinedFg', accent: 'text-[#F3D8D8]', icon: '✕' },
  WRONG_EVENT: { bg: 'bg-status-declinedFg', accent: 'text-[#F3D8D8]', icon: '✕' },
  NOT_CONFIRMED: { bg: 'bg-status-declinedFg', accent: 'text-[#F3D8D8]', icon: '✕' },
  REVOKED: { bg: 'bg-status-declinedFg', accent: 'text-[#F3D8D8]', icon: '✕' },
};

function ResultView({
  result,
  onNext,
  onManual,
  onOverride,
}: {
  result: ScanResult;
  onNext: () => void;
  onManual: () => void;
  onOverride: (seats: number) => Promise<void>;
}) {
  const style = VERDICT_STYLE[result.verdict] ?? VERDICT_STYLE.INVALID!;
  const [overriding, setOverriding] = useState(false);

  return (
    <div className={`flex flex-1 flex-col ${style.bg} text-[#FFFDF7]`}>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-9 text-center">
        <div className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-[rgba(255,253,247,.16)] text-[40px] font-light">
          {style.icon}
        </div>

        <span className={`text-[19px] font-semibold ${style.accent}`}>{result.messageAr}</span>

        {result.guest && (
          <span className="text-center text-[28px] font-semibold leading-snug">
            {result.guest.name}
          </span>
        )}

        {result.verdict === 'VALID' && result.guest && (
          <div className="flex items-baseline gap-2.5 rounded-2xl bg-[rgba(255,253,247,.14)] px-7 py-4">
            {/* The biggest number on the screen, because it is the one the
                staff member acts on. */}
            <span className="text-[44px] font-semibold leading-none">
              {displayNumber(result.guest.seats, 'ar')}
            </span>
            <span className="text-[15px] text-[#CFE7DB]">
              {result.guest.seats > 1
                ? `مقاعد (هو و${displayNumber(result.guest.seats - 1, 'ar')} مرافقين)`
                : 'مقعد واحد'}
            </span>
          </div>
        )}

        {result.verdict === 'USED' && result.priorCheckIn && (
          <div className="flex flex-col items-center gap-1.5 rounded-2xl bg-[rgba(255,253,247,.14)] px-6 py-4">
            <span className="text-[15px] font-medium">
              دخل الساعة{' '}
              {new Date(result.priorCheckIn.scannedAt).toLocaleTimeString('ar-SA', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
            <span className="text-[13.5px] text-[#F6E3BC]">
              بواسطة: {result.priorCheckIn.scannedByName}
            </span>
          </div>
        )}

        {result.guest && result.verdict === 'VALID' && (
          <span className="text-[13.5px] leading-relaxed text-[#A9C6BA]">
            {result.guest.group ? `${result.guest.group} · ` : ''}رمز {result.guest.displayCode}
          </span>
        )}

        {result.verdict === 'USED' && (
          <p className="max-w-[270px] text-[13.5px] leading-loose text-[#F6E3BC]">
            قد يكون أحد المرافقين يحمل نفس الرمز. راجع العدد قبل السماح بالدخول.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2.5 p-5">
        {result.verdict === 'USED' && result.guest && (
          // Not a rejection being bypassed: companions arrive separately and a
          // hard block jams the door. The decision is recorded against a name.
          <button
            disabled={overriding}
            onClick={async () => {
              setOverriding(true);
              await onOverride(1);
              setOverriding(false);
            }}
            className="h-14 rounded-[15px] bg-[#FFFDF7] text-[16.5px] font-semibold text-[#6E4A11] disabled:opacity-60"
          >
            {overriding ? 'جارٍ التسجيل…' : 'اسمح بالدخول على أي حال'}
          </button>
        )}

        {(result.verdict === 'INVALID' || result.verdict === 'WRONG_EVENT') && (
          <button
            onClick={onManual}
            className="h-14 rounded-[15px] bg-[#FFFDF7] text-[16.5px] font-semibold text-[#7A3434]"
          >
            ابحث بالاسم يدويًا
          </button>
        )}

        <button
          onClick={onNext}
          className={
            result.verdict === 'VALID'
              ? 'h-[58px] rounded-[15px] bg-[#FFFDF7] text-[17px] font-semibold text-emerald-800'
              : 'h-[50px] rounded-[14px] border border-[rgba(255,253,247,.35)] text-[15px] font-medium'
          }
        >
          {result.verdict === 'VALID' ? 'مسح الضيف التالي' : 'رجوع للمسح'}
        </button>
      </div>
    </div>
  );
}

// ─── Manual entry ────────────────────────────────────────────────────────────

function ManualView({
  onBack,
  onSearch,
  onPick,
  onCode,
  error,
}: {
  onBack: () => void;
  onSearch: (q: string) => Promise<{ guests: Array<Record<string, unknown>> } | null>;
  onPick: (guestId: string) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  error: string | null;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits([]);
      return;
    }

    // Debounced: the door types fast and the list is only a hint.
    const timer = setTimeout(async () => {
      setSearching(true);
      const response = await onSearch(query.trim());
      setHits((response?.guests ?? []) as unknown as SearchHit[]);
      setSearching(false);
    }, 250);

    return () => clearTimeout(timer);
  }, [query, onSearch]);

  const looksLikeCode = /^[\d٠-٩]{4}-?[\d٠-٩]{2}$/.test(query.trim());

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-emerald-ink">
      <div className="flex items-center justify-between px-5 py-4">
        <span className="text-[16px] font-semibold">إدخال يدوي</span>
        <button onClick={onBack} className="text-sm text-[#A9C6BA] underline">
          رجوع للمسح
        </button>
      </div>

      <div className="px-5 pb-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="اسم الضيف أو رمز الدخول"
          autoFocus
          className="w-full rounded-[13px] border border-[#1B3A30] bg-[#122E25] p-4 text-base text-surface-sand outline-none placeholder:text-[#4E5F57] focus:border-emerald-500"
        />
        {looksLikeCode && (
          <button
            onClick={() => onCode(query.trim())}
            className="mt-2.5 h-12 w-full rounded-xl bg-surface-sand text-[15px] font-semibold text-emerald-800"
          >
            ابحث برمز {query.trim()}
          </button>
        )}
      </div>

      {error && (
        <p className="mx-5 mb-2 rounded-xl bg-[#3A1F1F] px-4 py-3 text-center text-[13.5px] text-[#F3D8D8]">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        {searching && <p className="px-5 py-3 text-[13.5px] text-[#6C857B]">جارٍ البحث…</p>}

        {!searching && query.trim().length >= 2 && hits.length === 0 && (
          <p className="px-5 py-6 text-center text-[13.5px] leading-loose text-[#6C857B]">
            لا يوجد ضيف بهذا الاسم في هذه المناسبة.
          </p>
        )}

        {hits.map((hit) => (
          <button
            key={hit.guestId}
            onClick={() => onPick(hit.guestId)}
            className="flex w-full items-center justify-between gap-3 border-b border-[#122E25] px-5 py-4 text-right"
          >
            <span className="flex flex-col gap-1">
              <span className="text-[15px] font-medium">{hit.name}</span>
              <span className="text-xs text-[#6C857B]">
                {hit.group ? `${hit.group} · ` : ''}
                {displayNumber(hit.seats, 'ar')} مقاعد · {hit.displayCode}
              </span>
            </span>
            {hit.alreadyCheckedIn && (
              <span className="shrink-0 rounded-full bg-status-pending px-3 py-1.5 text-[12px] font-medium text-[#FFFDF7]">
                دخل
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Log ─────────────────────────────────────────────────────────────────────

function LogView({
  session,
  onBack,
  onLoad,
}: {
  session: ScanSession;
  onBack: () => void;
  onLoad: () => Promise<{ stats: ScanStats; entries: unknown[] } | null>;
}) {
  const [data, setData] = useState<{ stats: ScanStats; entries: LogRow[] } | null>(null);

  useEffect(() => {
    void onLoad().then((loaded) => {
      if (loaded) setData(loaded as unknown as { stats: ScanStats; entries: LogRow[] });
    });
  }, [onLoad]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-4 bg-emerald-ink p-5">
        <div className="flex items-center justify-between">
          <span className="text-[17px] font-semibold">سجل المسح</span>
          <button onClick={onBack} className="text-[13px] text-[#8FA69B] underline">
            رجوع للمسح
          </button>
        </div>
        <span className="text-[13px] text-[#8FA69B]">{session.displayName}</span>

        <div className="flex gap-2.5">
          <Stat value={data?.stats.seatsAdmitted} label="مقعدًا دخل" />
          <Stat value={data?.stats.scans} label="عملية مسح" />
          <Stat value={data?.stats.alerts} label="تنبيه" highlight />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-[#FAF8F3] text-ink">
        {data?.entries.length === 0 && (
          <div className="flex flex-col items-center gap-3 px-9 py-14 text-center">
            <span className="text-[19px] font-semibold">لم يدخل أحد بعد</span>
            <p className="max-w-[280px] text-body text-ink-muted">
              سيظهر أول ضيف هنا فور مسح رمزه.
            </p>
          </div>
        )}

        {data?.entries.map((entry, index) => (
          <div
            key={`${entry.at}-${index}`}
            className="flex items-center gap-3 border-b border-[#F2F0EA] px-5 py-4"
          >
            <span
              className={`h-[9px] w-[9px] shrink-0 rounded-full ${
                entry.kind === 'CHECK_IN'
                  ? 'bg-status-confirmed'
                  : entry.kind === 'OVERRIDE'
                    ? 'bg-status-pending'
                    : 'bg-status-declined'
              }`}
            />
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[14.5px] font-medium">
                {entry.guestName ?? 'رمز غير معروف'}
              </span>
              <span className="text-xs text-ink-faint">
                {entry.kind === 'CHECK_IN' &&
                  `${displayNumber(entry.seats ?? 0, 'ar')} مقاعد · دخول`}
                {entry.kind === 'OVERRIDE' && (entry.detail ?? 'رمز مكرر — سُمح بالدخول')}
                {entry.kind === 'REJECTED' && (entry.detail ?? entry.verdict)}
              </span>
            </div>
            <span className="font-latin text-[13px] text-ink-light">
              {new Date(entry.at).toLocaleTimeString('ar-SA', {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

interface LogRow {
  kind: 'CHECK_IN' | 'OVERRIDE' | 'REJECTED';
  at: string;
  guestName: string | null;
  seats: number | null;
  detail: string | null;
  verdict: string | null;
}

function Stat({
  value,
  label,
  highlight,
}: {
  value: number | undefined;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex flex-1 flex-col gap-1.5 rounded-[13px] bg-[#122E25] p-3.5">
      <span className={`text-[23px] font-semibold ${highlight ? 'text-[#EBD7A8]' : ''}`}>
        {value === undefined ? '—' : displayNumber(value, 'ar')}
      </span>
      <span className="text-xs text-[#8FA69B]">{label}</span>
    </div>
  );
}
