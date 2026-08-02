import type {
  CheckInInput,
  ScanLogEntry,
  ScanOverrideInput,
  ScanResult,
  ScanSession,
  ScanStats,
} from '@da3wa/shared';
import { browserApiBase } from './api';

/**
 * The door session lives in localStorage, not a cookie.
 *
 * Staff reload the page, lose signal, and hand the phone to the next shift —
 * the session has to survive all of that without a round trip, and it is
 * scoped per event so one device can work two doors on different nights.
 */
const key = (eventId: string) => `da3wa.scan.${eventId}`;

export function loadSession(eventId: string): ScanSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key(eventId));
    return raw ? (JSON.parse(raw) as ScanSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(eventId: string, session: ScanSession): void {
  window.localStorage.setItem(key(eventId), JSON.stringify(session));
}

export function clearSession(eventId: string): void {
  window.localStorage.removeItem(key(eventId));
}

export class ScanApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit, sessionToken?: string): Promise<T> {
  const res = await fetch(`${browserApiBase()}/api/scan${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(sessionToken ? { 'x-scan-session': sessionToken } : {}),
      ...init.headers,
    },
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    throw new ScanApiError(
      res.status,
      body?.error?.code ?? 'UNKNOWN',
      body?.error?.message ?? 'تعذّر الاتصال بالخادم',
    );
  }

  return body as T;
}

export function openGate(
  eventId: string,
  password: string,
  displayName: string,
): Promise<ScanSession> {
  return call<ScanSession>(`/gate/${encodeURIComponent(eventId)}`, {
    method: 'POST',
    body: JSON.stringify({ password, displayName: displayName || undefined }),
  });
}

export function submitCheckIn(session: string, input: CheckInInput): Promise<ScanResult> {
  return call<ScanResult>('/check-in', { method: 'POST', body: JSON.stringify(input) }, session);
}

export function submitOverride(session: string, input: ScanOverrideInput): Promise<ScanResult> {
  return call<ScanResult>('/override', { method: 'POST', body: JSON.stringify(input) }, session);
}

export function searchGuests(session: string, q: string) {
  return call<{ guests: Array<Record<string, unknown>> }>(
    `/search?q=${encodeURIComponent(q)}`,
    { method: 'GET' },
    session,
  );
}

export function fetchLog(session: string) {
  return call<{ stats: ScanStats; entries: ScanLogEntry[] }>('/log', { method: 'GET' }, session);
}
