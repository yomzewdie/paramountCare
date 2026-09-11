import { env } from '../config/env';
import { publicFetch, authenticatedFetch } from './apiClient';
import { toAppError, networkFailureToAppError, type AppError } from '../utils/errors';

// Hand-typed request/response contracts, not hc<AppType>() — see
// apiClient.ts's top-of-file comment for why, and
// docs/ARCHITECTURE_DECISION_RECORDS.md ADR-017. Each shape below was
// verified directly against the Worker's actual route source
// (worker/src/routes/auth.ts) during this milestone's pre-flight, not
// guessed.

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: AppError };

async function postJson(fetchFn: typeof fetch, path: string, body: unknown): Promise<Response> {
  return fetchFn(`${env.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

interface RegisterResponse {
  email: string;
  message: string;
}

export async function register(inviteToken: string, password: string): Promise<ApiResult<RegisterResponse>> {
  try {
    const res = await postJson(publicFetch, '/api/auth/applicant/register', { inviteToken, password });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'register') };
    }
    return { ok: true, data: (await res.json()) as RegisterResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

interface VerifyEmailResponse {
  email: string;
  verified: true;
}

export async function verifyEmail(email: string, code: string): Promise<ApiResult<VerifyEmailResponse>> {
  try {
    const res = await postJson(publicFetch, '/api/auth/applicant/verify-email', { email, code });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'verifyEmail') };
    }
    return { ok: true, data: (await res.json()) as VerifyEmailResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

interface ResendVerificationResponse {
  message: string;
}

export async function resendVerification(email: string): Promise<ApiResult<ResendVerificationResponse>> {
  try {
    const res = await postJson(publicFetch, '/api/auth/applicant/resend-verification', { email });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'resendVerification') };
    }
    return { ok: true, data: (await res.json()) as ResendVerificationResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

export interface LoginResponse {
  email: string;
  role: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function login(email: string, password: string, deviceLabel?: string): Promise<ApiResult<LoginResponse>> {
  try {
    const res = await postJson(publicFetch, '/api/auth/applicant/login', { email, password, deviceLabel });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'login') };
    }
    return { ok: true, data: (await res.json()) as LoginResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

// /api/auth/logout takes no Authorization header at all (see
// worker/src/routes/auth.ts) — the refresh token in the body is what's being
// revoked, so this goes through publicFetch like login/register, not the
// authenticated one.
export async function logout(refreshToken: string): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await postJson(publicFetch, '/api/auth/logout', { refreshToken });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'generic') };
    }
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

export async function logoutAll(): Promise<ApiResult<{ ok: true }>> {
  try {
    const res = await authenticatedFetch(`${env.apiBaseUrl}/api/auth/logout-all`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'authenticatedRequest') };
    }
    return { ok: true, data: { ok: true } };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}

interface MeResponse {
  email: string;
  role: string;
}

export async function me(): Promise<ApiResult<MeResponse>> {
  try {
    const res = await authenticatedFetch(`${env.apiBaseUrl}/api/auth/me`, { method: 'GET' });
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, body, 'authenticatedRequest') };
    }
    return { ok: true, data: (await res.json()) as MeResponse };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}
