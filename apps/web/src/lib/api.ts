/**
 * Client-safe API helpers.
 *
 * Nothing here may import `next/headers` or anything else server-only — this
 * module is pulled into the client bundle by the invite screen, and a
 * server-only import poisons the whole build. Server-side fetching lives in
 * `api.server.ts`.
 */

/** Where the *browser* talks to the API. Inlined at build time by Next. */
export function browserApiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

/**
 * Turn an API-relative path into something a browser can actually fetch.
 *
 * The API hands back `/api/settings/logo?v=3` rather than an absolute URL,
 * because it does not reliably know the public origin it is being reached
 * through. Left relative, the browser resolves it against the *web* origin —
 * which works behind nginx, where /api is proxied, and 404s everywhere else
 * including local development. Prefixing here makes it correct in both.
 */
export function apiUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `${browserApiBase()}${path}`;
}

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: {
      messageAr?: string;
      formErrors?: string[];
      fieldErrors?: Record<string, string[] | undefined>;
    };
  };
}

/**
 * The one line to show a human for a failed API response.
 *
 * Errors arrive in three shapes: a service-authored `details.messageAr`, a Zod
 * `details.fieldErrors` map, or nothing but the top-level `message`. That last
 * one is written for the developer reading the log — a 422 says "Validation
 * failed" in English — so the field errors have to be preferred over it, or the
 * sign-up screen tells an Arabic-speaking host nothing at all about why their
 * password was refused.
 */
export function apiErrorMessage(body: unknown, fallback: string): string {
  const error = (body as ApiErrorBody | null | undefined)?.error;
  if (!error) return fallback;

  const details = error.details;
  if (details?.messageAr) return details.messageAr;

  const issues = [
    ...(details?.formErrors ?? []),
    ...Object.values(details?.fieldErrors ?? {}).flatMap((messages) => messages ?? []),
  ].filter(Boolean);

  // Several at once is normal — a short password and a bad number arrive in the
  // same response, and fixing one to be told about the other is a dead end.
  if (issues.length > 0) return [...new Set(issues)].join(' · ');

  return error.message ?? fallback;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
