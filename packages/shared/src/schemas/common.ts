import { z } from 'zod';
import { normalizePhone, type CountryCode } from '../phone.js';
import { toWesternDigits } from '../digits.js';

/**
 * A phone field that accepts anything a human types and yields E.164.
 *
 * Validation and normalization are the same step on purpose — if they were
 * separate, some code path would eventually validate a raw string and then store
 * it unnormalized, and the `@@unique([eventId, phone])` duplicate check would
 * stop catching duplicates.
 */
export function phoneField(defaultCountry: CountryCode = 'SA') {
  return z
    .string({ required_error: 'الرقم مطلوب' })
    .trim()
    .min(1, 'الرقم مطلوب')
    .transform((value, ctx) => {
      const result = normalizePhone(value, defaultCountry);
      if (!result.ok) {
        const messages: Record<string, string> = {
          EMPTY: 'الرقم مطلوب',
          INVALID_CHARACTERS: 'الرقم يحتوي على رموز غير مسموحة',
          TOO_SHORT: 'الرقم ناقص — يحتاج ١٠ أرقام',
          TOO_LONG: 'الرقم أطول من المسموح',
          NOT_A_MOBILE: 'الرقم يجب أن يبدأ بـ 05 ويتكوّن من ١٠ أرقام',
          UNSUPPORTED_COUNTRY: 'الدولة غير مدعومة حاليًا',
        };
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: messages[result.reason] ?? 'رقم غير صالح',
        });
        return z.NEVER;
      }
      return result.e164;
    });
}

/**
 * Passwords are not digit-normalized or trimmed — both would silently change
 * what the user typed. Only the length bound applies.
 */
export const passwordField = z
  .string({ required_error: 'كلمة المرور مطلوبة' })
  .min(8, 'كلمة المرور يجب أن تكون ٨ أحرف على الأقل')
  .max(128, 'كلمة المرور طويلة جدًا');

export const nameField = z
  .string({ required_error: 'الاسم مطلوب' })
  .trim()
  .min(2, 'الاسم قصير جدًا')
  .max(120, 'الاسم طويل جدًا');

/** Six-digit OTP. Accepts Arabic-Indic input since that is what an Arabic keyboard emits. */
export const otpCodeField = z
  .string()
  .trim()
  .transform(toWesternDigits)
  .pipe(z.string().regex(/^\d{6}$/, 'الرمز يتكوّن من ٦ أرقام'));

export const localeField = z.enum(['ar', 'en']).default('ar');

export const cuidField = z.string().cuid2().or(z.string().cuid());

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type Pagination = z.infer<typeof paginationSchema>;
