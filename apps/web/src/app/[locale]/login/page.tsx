'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AuthError, useAuth } from '@/lib/auth';
import { DEFAULT_LOCALE, isLocale, translator } from '@/lib/i18n';

/**
 * Host sign-in (§02).
 *
 * The phone field stays LTR inside the RTL page and the +966 prefix sits beside
 * it, because digits are written left-to-right even in Arabic — the design calls
 * this out explicitly. The API normalizes whatever is typed, so 05…, 9665… and
 * ٠٥… all resolve to the same account.
 */
export default function LoginPage() {
  const params = useParams<{ locale: string }>();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { login } = useAuth();

  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    try {
      await login(phone, password);
      router.replace(`/${locale}/dashboard`);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'تعذّر الاتصال بالخادم');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center gap-5 px-8 py-12 lg:px-16">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-emerald-700 text-base font-semibold text-surface-sand">
            د
          </span>
          <span className="text-xl font-semibold">{t('brand.name')}</span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-h2">{t('auth.loginTitle')}</h1>
          <p className="text-body text-ink-muted">{t('auth.loginSubtitle')}</p>
        </div>

        <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
          <label className="flex flex-col gap-2.5">
            <span className="text-[13.5px] font-medium text-[#3D4741]">{t('auth.phone')}</span>
            <div className="flex items-center overflow-hidden rounded-control border border-line-strong bg-surface focus-within:border-emerald-700 focus-within:ring-4 focus-within:ring-emerald-700/10">
              <span className="border-e border-line bg-[#F7F6F2] px-3.5 py-3.5 font-latin text-[15px] font-medium text-ink-muted">
                +966
              </span>
              <input
                dir="ltr"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="5X XXX XXXX"
                required
                className="flex-1 bg-transparent px-3.5 py-3.5 font-latin text-[15.5px] tracking-wide outline-none"
              />
            </div>
          </label>

          <label className="flex flex-col gap-2.5">
            <span className="text-[13.5px] font-medium text-[#3D4741]">{t('auth.password')}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="rounded-control border border-line-strong bg-surface px-4 py-3.5 text-[15px] outline-none focus:border-emerald-700 focus:ring-4 focus:ring-emerald-700/10"
            />
          </label>

          {error && (
            <p className="rounded-xl bg-status-declinedBg px-4 py-3 text-[13.5px] text-status-declinedFg">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 rounded-control bg-emerald-700 py-4 text-base font-semibold text-[#F7F5EF] disabled:opacity-60"
          >
            {pending ? t('auth.submitting') : t('auth.submit')}
          </button>
        </form>
      </div>

      {/* The design's emerald panel. Decorative, so hidden rather than stacked
          on small screens where it would just push the form below the fold. */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-700 to-emerald-900 p-11 lg:flex">
        <div className="absolute -bottom-32 -start-20 h-[340px] w-[340px] rounded-full bg-gold/15" />
        <span className="relative text-body text-[#A9C6BA]">{t('brand.tagline')}</span>
        <div className="relative flex flex-col gap-5">
          <span className="font-serif text-[27px] leading-relaxed text-[#FFFDF7]">
            «الكريمُ من أكرم ضيفه
            <br />
            قبل أن يصل الباب»
          </span>
          <div className="flex items-center gap-2.5">
            <span className="h-px w-6 bg-gold" />
            <span className="text-[13.5px] text-[#8FA69B]">دعوة · Da3wa</span>
          </div>
        </div>
      </div>
    </main>
  );
}
