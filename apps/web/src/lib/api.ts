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

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
