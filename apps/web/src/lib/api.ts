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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
