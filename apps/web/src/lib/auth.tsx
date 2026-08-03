'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AuthUser } from '@da3wa/shared';
import { browserApiBase } from './api';

/**
 * Host authentication.
 *
 * The access token is held in memory only — never localStorage. The durable
 * half of the session is the httpOnly refresh cookie, which JavaScript cannot
 * read, so an XSS bug cannot walk away with a long-lived credential. A page
 * reload silently re-mints an access token from that cookie.
 */
interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  /** Resolves with the signed-in user, so callers can route on role. */
  login: (phone: string, password: string) => Promise<AuthUser>;
  /** Same session, minted from an SMS code instead of a password. */
  loginWithCode: (phone: string, code: string) => Promise<AuthUser>;
  logout: () => Promise<void>;
  authFetch: (path: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthState | null>(null);

export class AuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const accessToken = useRef<string | null>(null);

  const base = browserApiBase();

  const refresh = useCallback(async (): Promise<boolean> => {
    const res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });

    if (!res.ok) {
      accessToken.current = null;
      setUser(null);
      return false;
    }

    const body = await res.json();
    accessToken.current = body.accessToken;
    setUser(body.user);
    return true;
  }, [base]);

  // Restore the session on first paint. Without this a reload looks like a
  // logout even though the refresh cookie is still perfectly good.
  useEffect(() => {
    void refresh().finally(() => setReady(true));
  }, [refresh]);

  const login = useCallback(
    async (phone: string, password: string) => {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new AuthError(
          body?.error?.code ?? 'UNKNOWN',
          body?.error?.code === 'INVALID_CREDENTIALS'
            ? 'رقم الجوال أو كلمة المرور غير صحيحة'
            : (body?.error?.message ?? 'تعذّر تسجيل الدخول'),
        );
      }

      accessToken.current = body.accessToken;
      setUser(body.user);
      return body.user as AuthUser;
    },
    [base],
  );

  const loginWithCode = useCallback(
    async (phone: string, code: string) => {
      const res = await fetch(`${base}/api/auth/otp/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      const body = await res.json().catch(() => null);
      if (!res.ok) {
        throw new AuthError(
          body?.error?.code ?? 'UNKNOWN',
          body?.error?.message ?? 'الرمز غير صحيح أو انتهت صلاحيته',
        );
      }

      accessToken.current = body.accessToken;
      setUser(body.user);
      return body.user as AuthUser;
    },
    [base],
  );

  const logout = useCallback(async () => {
    await fetch(`${base}/api/auth/logout`, { method: 'POST', credentials: 'include' }).catch(
      () => undefined,
    );
    accessToken.current = null;
    setUser(null);
  }, [base]);

  /**
   * Fetch with the bearer token, retrying once through a refresh.
   *
   * Access tokens live 15 minutes and a host leaves the dashboard open for an
   * evening, so an expiry mid-poll is the normal case, not an edge one.
   */
  const authFetch = useCallback(
    async (path: string, init: RequestInit = {}): Promise<Response> => {
      // FormData must NOT get an explicit content-type: the browser has to set
      // it itself so the multipart boundary is included. Setting it by hand
      // makes the guest-list import upload unparseable on the server.
      const isMultipart = typeof FormData !== 'undefined' && init.body instanceof FormData;

      const send = () =>
        fetch(`${base}${path}`, {
          ...init,
          credentials: 'include',
          headers: {
            ...(init.body && !isMultipart ? { 'content-type': 'application/json' } : {}),
            ...(accessToken.current ? { authorization: `Bearer ${accessToken.current}` } : {}),
            ...init.headers,
          },
        });

      const first = await send();
      if (first.status !== 401) return first;

      if (!(await refresh())) return first;
      return send();
    },
    [base, refresh],
  );

  const value = useMemo(
    () => ({ user, ready, login, loginWithCode, logout, authFetch }),
    [user, ready, login, loginWithCode, logout, authFetch],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
