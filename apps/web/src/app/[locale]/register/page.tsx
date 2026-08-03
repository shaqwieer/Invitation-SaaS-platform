'use client';

/**
 * Sign-up (§02 of the design doc).
 *
 * Registration existed only as an API route, which meant a new customer had no
 * way into the product at all. The layout mirrors the login screen deliberately:
 * the two are one decision with a tab between them, not two different places.
 */

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { browserApiBase } from '@/lib/api';
import { Button, Field, Input, PhoneInput } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { useBrand } from '@/components/BrandContext';
import { DEFAULT_LOCALE, isLocale, translator } from '@/lib/i18n';

export default function RegisterPage() {
  const params = useParams<{ locale: string }>();
  const locale = isLocale(params.locale) ? params.locale : DEFAULT_LOCALE;
  const t = translator(locale);
  const router = useRouter();
  const { login } = useAuth();
  const brand = useBrand();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    try {
      const res = await fetch(`${browserApiBase()}/api/auth/register`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, phone, password, locale }),
      });

      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setError(
          body?.error?.code === 'PHONE_TAKEN'
            ? t('register.taken')
            : (body?.error?.details?.messageAr ??
              body?.error?.message ??
              t('common.genericError')),
        );
        return;
      }

      // Registering signs you in — asking someone to type the same password
      // again immediately is friction with no security value.
      await login(phone, password);
      router.replace(`/${locale}/events/new`);
    } catch {
      setError(t('common.genericError'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center gap-5 px-8 py-12 lg:px-16">
        <Logo locale={locale} nameClassName="text-xl font-semibold" className="mb-1" />

        <div className="flex max-w-md gap-1 rounded-control bg-surface-sand p-1">
          <Link
            href={`/${locale}/login`}
            className="flex-1 rounded-[9px] py-2.5 text-center text-[13.5px] text-ink-muted"
          >
            {t('register.tabLogin')}
          </Link>
          <span className="flex-1 rounded-[9px] bg-surface py-2.5 text-center text-[13.5px] font-medium shadow-sh-1">
            {t('register.tabRegister')}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-h2">{t('register.title')}</h1>
          <p className="text-body text-ink-muted">{t('register.subtitle')}</p>
        </div>

        <form onSubmit={submit} className="flex max-w-md flex-col gap-4">
          <Field label={t('register.name')} required>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>

          <Field label={t('guests.phone')} required>
            <PhoneInput value={phone} onChange={(e) => setPhone(e.target.value)} required />
          </Field>

          <Field label={t('register.password')} hint={t('register.passwordHint')} required>
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
            {pending ? t('auth.submitting') : t('register.submit')}
          </Button>

          <p className="text-[13px] text-ink-light">
            {t('register.haveAccount')}{' '}
            <Link href={`/${locale}/login`} className="text-emerald-700 hover:underline">
              {t('register.signIn')}
            </Link>
          </p>
        </form>
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
