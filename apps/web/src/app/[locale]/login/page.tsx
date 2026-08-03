'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthError, useAuth } from '@/lib/auth';
import { browserApiBase } from '@/lib/api';
import { Button, Field, Input, PhoneInput } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useBrand } from '@/components/BrandContext';
import { DEFAULT_LOCALE, isLocale, translator } from '@/lib/i18n';
import { displayNumber } from '@/lib/format';

/**
 * Host sign-in (§02).
 *
 * The phone field stays LTR inside the RTL page and the +966 prefix sits beside
 * it, because digits are written left-to-right even in Arabic — the design calls
 * this out explicitly. The API normalizes whatever is typed, so 05…, 9665… and
 * ٠٥… all resolve to the same account.
 *
 * Two ways in, as the design specifies: a password, or a six-digit code by SMS.
 * The code path exists for hosts who set the account up months before the
 * wedding and no longer remember a password they used once.
 */
export default function LoginPage() {
  const params = useParams<{ locale: string }>();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { login, loginWithCode } = useAuth();
  const brand = useBrand();

  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // The design shows a countdown rather than a permanently live resend link, so
  // a host who taps twice does not burn the OTP rate limit in five seconds.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  /**
   * Admins go to the operator panel, hosts to their dashboard.
   *
   * An admin account configures the platform; it does not run weddings. Landing
   * one on the host dashboard offered them a «مناسبة جديدة» button and an empty
   * event list, which invited exactly the wrong mental model.
   */
  const done = (role: string) =>
    router.replace(role === 'ADMIN' ? `/${locale}/admin` : `/${locale}/dashboard`);

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const user = await login(phone, password);
      done(user.role);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : 'تعذّر الاتصال بالخادم');
    } finally {
      setPending(false);
    }
  }

  async function requestCode() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${browserApiBase()}/api/auth/otp/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      });
      // 202 whatever the number is: the response must not reveal who has an
      // account here.
      if (!res.ok && res.status !== 202) {
        setError(t('common.genericError'));
        return;
      }
      setCodeSent(true);
      setCooldown(30);
    } catch {
      setError(t('common.genericError'));
    } finally {
      setPending(false);
    }
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const user = await loginWithCode(phone, code);
      done(user.role);
    } catch {
      setError(t('otp.wrong'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center gap-5 px-8 py-12 lg:px-16">
        <Logo locale={locale} nameClassName="text-xl font-semibold" className="mb-1" />

        <div className="flex max-w-md gap-1 rounded-control bg-surface-sand p-1">
          <span className="flex-1 rounded-[9px] bg-surface py-2.5 text-center text-[13.5px] font-medium shadow-sh-1">
            {t('register.tabLogin')}
          </span>
          <Link
            href={`/${locale}/register`}
            className="flex-1 rounded-[9px] py-2.5 text-center text-[13.5px] text-ink-muted"
          >
            {t('register.tabRegister')}
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-h2">{codeSent ? t('otp.title') : t('auth.loginTitle')}</h1>
          <p className="text-body text-ink-muted">
            {codeSent ? t('otp.sentTo', { phone }) : t('auth.loginSubtitle')}
          </p>
        </div>

        {mode === 'password' ? (
          <form onSubmit={submitPassword} className="flex max-w-md flex-col gap-4">
            <Field label={t('auth.phone')} required>
              <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </Field>

            <Field label={t('auth.password')} required>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && (
              <p className="rounded-xl bg-status-declinedBg px-4 py-3 text-[13.5px] text-status-declinedFg">
                {error}
              </p>
            )}

            <Button type="submit" size="lg" disabled={pending} className="mt-1">
              {pending ? t('auth.submitting') : t('auth.submit')}
            </Button>

            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-line" />
              <span className="text-[12.5px] text-ink-light">أو</span>
              <span className="h-px flex-1 bg-line" />
            </div>

            <button
              type="button"
              onClick={() => {
                setMode('code');
                setError(null);
              }}
              className="text-[13.5px] text-emerald-700 hover:underline"
            >
              {t('otp.link')}
            </button>
          </form>
        ) : (
          <form onSubmit={submitCode} className="flex max-w-md flex-col gap-4">
            <Field label={t('auth.phone')} required>
              <PhoneInput
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                disabled={codeSent}
              />
            </Field>

            {codeSent && (
              <Field label={t('otp.title')} required>
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  className="text-center font-latin text-[22px] tracking-[0.5em]"
                  autoFocus
                />
              </Field>
            )}

            {error && (
              <p className="rounded-xl bg-status-declinedBg px-4 py-3 text-[13.5px] text-status-declinedFg">
                {error}
              </p>
            )}

            {codeSent ? (
              <>
                <Button type="submit" size="lg" disabled={pending || code.length < 4}>
                  {pending ? t('auth.submitting') : t('otp.verify')}
                </Button>
                <button
                  type="button"
                  disabled={cooldown > 0 || pending}
                  onClick={() => void requestCode()}
                  className="text-[13px] text-ink-muted disabled:opacity-60"
                >
                  {cooldown > 0
                    ? t('otp.resendIn', { seconds: displayNumber(cooldown, locale) })
                    : t('otp.resend')}
                </button>
                <p className="text-[12.5px] leading-relaxed text-ink-light">
                  {t('otp.notArrived')}
                </p>
              </>
            ) : (
              <Button
                type="button"
                size="lg"
                disabled={pending || phone.trim().length < 9}
                onClick={() => void requestCode()}
              >
                {t('otp.request')}
              </Button>
            )}

            <button
              type="button"
              onClick={() => {
                setMode('password');
                setCodeSent(false);
                setCode('');
                setError(null);
              }}
              className="text-[13.5px] text-emerald-700 hover:underline"
            >
              {t('otp.usePassword')}
            </button>
          </form>
        )}
      </div>

      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-emerald-700 to-emerald-900 p-11 lg:flex">
        <div className="absolute -bottom-32 -start-20 h-[340px] w-[340px] rounded-full bg-gold/15" />
        <span className="relative text-body text-[#A9C6BA]">{locale === 'ar' ? brand.taglineAr : brand.taglineEn}</span>
        <div className="relative flex flex-col gap-5">
          <span className="font-serif text-[27px] leading-relaxed text-[#FFFDF7]">
            «الكريمُ من أكرم ضيفه
            <br />
            قبل أن يصل الباب»
          </span>
          <div className="flex items-center gap-2.5">
            <span className="h-px w-6 bg-gold" />
            <span className="text-[13.5px] text-[#8FA69B]">{brand.brandNameAr} · {brand.brandNameEn}</span>
          </div>
        </div>
      </div>
    </main>
  );
}
