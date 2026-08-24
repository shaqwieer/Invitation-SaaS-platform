import { z } from 'zod';

/**
 * Environment contract.
 *
 * Validated once at boot and never read via bare `process.env` elsewhere, so a
 * missing secret fails immediately with a readable message instead of surfacing
 * as `undefined` inside a signing call three requests later.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

    JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
    JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

    QR_HMAC_SECRET: z.string().min(16, 'QR_HMAC_SECRET must be at least 16 characters'),

    WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
    PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),

    SMS_PROVIDER: z.enum(['console']).default('console'),
    PAYMENT_PROVIDER: z.enum(['stub', 'moyasar']).default('stub'),
    /**
     * The shared secret a gateway proves itself with.
     *
     * For the stub it keys an HMAC over the raw body. For Moyasar it is the
     * «Secret Token» set on the webhook in their dashboard, which they echo
     * inside the delivery. Either way it is the only thing standing between a
     * stranger and a POST that marks orders paid — see the refinement below,
     * which refuses to boot on Moyasar while it is still the placeholder.
     */
    PAYMENT_WEBHOOK_SECRET: z.string().default('dev_webhook_secret'),

    /** Moyasar's secret API key — `sk_test_…` or `sk_live_…`. Server-side only. */
    MOYASAR_SECRET_KEY: z.string().optional(),
    /**
     * The publishable key (`pk_…`). Unused by the hosted-invoice flow this wires
     * — Moyasar's own page collects the card — and kept so the pair lives in one
     * place for the day the card form is embedded in our checkout instead.
     */
    MOYASAR_PUBLISHABLE_KEY: z.string().optional(),

    VAT_RATE: z.coerce.number().min(0).max(1).default(0.15),
    CURRENCY: z.string().length(3).default('SAR'),

    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),

    /**
     * Number of reverse proxies in front of the API.
     *
     * Must be set behind nginx: without it Express reports the proxy's IP for
     * every request, so all callers share one rate-limit bucket and one attacker
     * can lock out the entire user base. Set too high, a client can spoof
     * X-Forwarded-For and evade limiting entirely — so it is an explicit count,
     * not a boolean.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  })
  .superRefine((env, ctx) => {
    // Sharing one secret between the two token types would let an access token be
    // replayed as a refresh token — a full account takeover from a leaked
    // Authorization header. Cheap to check, catastrophic to miss.
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['JWT_REFRESH_SECRET'],
        message: 'JWT_REFRESH_SECRET must differ from JWT_ACCESS_SECRET',
      });
    }

    /*
     * Moyasar's two hard requirements, checked at boot in every environment.
     *
     * Deliberately not gated on NODE_ENV. The webhook secret is what tells a
     * real delivery from a stranger posting `{"type":"payment_paid"}` at
     * `/api/webhooks/moyasar`, and the placeholder is published in this repo —
     * a box that starts with `PAYMENT_PROVIDER=moyasar` and the default secret
     * is one curl away from marking every order paid. Failing to boot is the
     * only honest response to that, and it must not depend on someone having
     * set NODE_ENV the way we assumed.
     */
    if (env.PAYMENT_PROVIDER === 'moyasar') {
      if (!env.MOYASAR_SECRET_KEY?.startsWith('sk_')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['MOYASAR_SECRET_KEY'],
          message: 'MOYASAR_SECRET_KEY is required and must start with sk_ when PAYMENT_PROVIDER=moyasar',
        });
      }

      if (/dev|change_me|secret_here/i.test(env.PAYMENT_WEBHOOK_SECRET)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENT_WEBHOOK_SECRET'],
          message:
            'PAYMENT_WEBHOOK_SECRET is still the placeholder — set it to the Secret Token on the Moyasar webhook',
        });
      }
    }

    if (env.NODE_ENV === 'production') {
      const weak = Object.entries({
        JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRET,
        JWT_REFRESH_SECRET: env.JWT_REFRESH_SECRET,
        QR_HMAC_SECRET: env.QR_HMAC_SECRET,
      }).filter(([, value]) => /dev|change_me|secret_here/i.test(value));

      for (const [key] of weak) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still looks like a development placeholder`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }

  return parsed.data;
}

/** Lazily validated so importing a module in a test doesn't require a full env. */
export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper — forces the next `env()` call to re-read process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = () => env().NODE_ENV === 'production';
export const isTest = () => env().NODE_ENV === 'test';
