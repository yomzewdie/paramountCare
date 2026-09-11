import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { restoreSession, setAuthExpiredListener } from '../../services/apiClient';
import { setAccessToken } from '../../services/tokenStore';
import { getStoredRefreshToken, setStoredRefreshToken, clearStoredRefreshToken } from '../../services/secureStore';
import * as authApi from '../../services/authApi';
import type { ApiResult } from '../../services/authApi';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

export interface AuthUser {
  email: string;
  role: string;
}

interface AuthContextValue {
  status: AuthStatus;
  user: AuthUser | null;
  register: typeof authApi.register;
  verifyEmail: typeof authApi.verifyEmail;
  resendVerification: typeof authApi.resendVerification;
  signIn: (email: string, password: string, deviceLabel?: string) => Promise<ApiResult<authApi.LoginResponse>>;
  signOut: () => Promise<void>;
  signOutEverywhere: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  // A refresh that fails definitively (dead/reused/revoked refresh token) can
  // happen at any time, not just at launch — e.g. an authenticated request
  // fires while the app is backgrounded and the refresh token was revoked
  // server-side in the meantime. Registered once; apiClient.ts only ever
  // holds a single listener (see its own doc comment).
  useEffect(() => {
    setAuthExpiredListener(() => {
      setUser(null);
      setStatus('signedOut');
    });
    return () => setAuthExpiredListener(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    restoreSession().then((outcome) => {
      if (cancelled) return;
      if (outcome.status === 'signedIn') {
        setUser({ email: outcome.email, role: outcome.role });
        setStatus('signedIn');
      } else {
        setStatus('signedOut');
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string, deviceLabel?: string) => {
    const result = await authApi.login(email, password, deviceLabel);
    if (result.ok) {
      setAccessToken(result.data.accessToken);
      await setStoredRefreshToken(result.data.refreshToken);
      setUser({ email: result.data.email, role: result.data.role });
      setStatus('signedIn');
    }
    return result;
  }, []);

  const signOut = useCallback(async () => {
    // Best-effort server-side revocation — sign-out proceeds locally
    // regardless of whether the network call succeeds, since the whole point
    // is the device should no longer be usable as this applicant either way.
    try {
      const refreshToken = await getStoredRefreshToken();
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // Ignored — see comment above.
    }
    setAccessToken(null);
    await clearStoredRefreshToken();
    setUser(null);
    setStatus('signedOut');
  }, []);

  const signOutEverywhere = useCallback(async () => {
    try {
      await authApi.logoutAll();
    } catch {
      // Ignored — same reasoning as signOut: proceed locally regardless.
    }
    setAccessToken(null);
    await clearStoredRefreshToken();
    setUser(null);
    setStatus('signedOut');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      register: authApi.register,
      verifyEmail: authApi.verifyEmail,
      resendVerification: authApi.resendVerification,
      signIn,
      signOut,
      signOutEverywhere,
    }),
    [status, user, signIn, signOut, signOutEverywhere],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used within an AuthProvider');
  return ctx;
}
