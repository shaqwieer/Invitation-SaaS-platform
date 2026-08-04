'use client';

import Link from 'next/link';
import { useBrand } from './BrandContext';
import { apiUrl } from '@/lib/api';
import type { AppLocale } from '@/lib/i18n';

/**
 * The brand mark, defined once and set by the operator.
 *
 * It used to be copy-pasted into seven screens; then it was one constant; now it
 * reads whatever an admin saved in the Branding tab. Nothing about the identity
 * lives in code any more — swapping the logo is a form submission, not a deploy.
 *
 * A client component, because the branding arrives through context. That costs
 * the landing page the zero-JavaScript property it briefly had, which was worth
 * trading: a logo nobody can change without a developer is the worse problem.
 */

/**
 * `box` shapes the drawn fallback square; `img` shapes an uploaded logo.
 *
 * They are the same square up to `lg`, but `xl` — for a header that shows the
 * mark alone — caps the height and lets the width follow. An operator's logo is
 * usually a wordmark, and a wide wordmark inside a square renders at a fraction
 * of the box's height, so a bigger square would barely look bigger at all.
 */
const SIZES = {
  sm: {
    box: 'h-[30px] w-[30px] rounded-[9px]',
    img: 'h-[30px] w-[30px] rounded-[9px]',
    text: 'text-[15px]',
    px: 30,
  },
  md: { box: 'h-8 w-8 rounded-[10px]', img: 'h-8 w-8 rounded-[10px]', text: 'text-base', px: 32 },
  lg: {
    box: 'h-11 w-11 rounded-[13px]',
    img: 'h-11 w-11 rounded-[13px]',
    text: 'text-[21px]',
    px: 44,
  },
  xl: {
    box: 'h-14 w-14 rounded-[16px]',
    img: 'h-14 w-auto max-w-[180px]',
    text: 'text-[24px]',
    px: 56,
  },
} as const;

export type LogoSize = keyof typeof SIZES;

export function Logo({
  locale,
  size = 'md',
  href,
  showName = true,
  nameClassName = 'text-lg font-semibold',
  className = '',
}: {
  locale: AppLocale;
  size?: LogoSize;
  /** Renders the mark as a link. Omit for a decorative lockup. */
  href?: string;
  showName?: boolean;
  /** Screens on dark backgrounds pass their own colour here. */
  nameClassName?: string;
  className?: string;
}) {
  const brand = useBrand();
  const { box, img, text, px } = SIZES[size];
  const name = locale === 'ar' ? brand.brandNameAr : brand.brandNameEn;
  const logoSrc = apiUrl(brand.logoUrl);

  // An uploaded image replaces the drawn square entirely. Without one we fall
  // back to the letter, so the product is never unbranded mid-setup.
  const mark = logoSrc ? (
    // eslint-disable-next-line @next/next/no-img-element -- operator-uploaded and
    // served from our own API origin; next/image would demand a configured
    // remote pattern for no benefit here.
    <img src={logoSrc} alt="" width={px} height={px} className={`shrink-0 object-contain ${img}`} />
  ) : (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center bg-emerald-700 font-semibold text-surface-sand ${box} ${text}`}
    >
      {brand.logoMark}
    </span>
  );

  const content = (
    <>
      {mark}
      {showName && <span className={nameClassName}>{name}</span>}
    </>
  );

  // The mark carries no text of its own, so a link needs the brand name as its
  // accessible label even when the wordmark is hidden.
  if (href) {
    return (
      <Link href={href} aria-label={name} className={`flex items-center gap-2.5 ${className}`}>
        {content}
      </Link>
    );
  }

  return (
    <span className={`flex items-center gap-2.5 ${className}`} role="img" aria-label={name}>
      {content}
    </span>
  );
}
