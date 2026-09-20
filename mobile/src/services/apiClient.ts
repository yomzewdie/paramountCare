import { env } from '../config/env';
import { getAccessToken, setAccessToken } from './tokenStore';
import { getStoredRefreshToken, setStoredRefreshToken, clearStoredRefreshToken } from './secureStore';
import { createRefreshCoordinator, type RefreshOutcome } from '../features/auth/refreshCoordinator';

// Two fetch functions, differing only in which one attaches/refreshes a
// token — see docs/ARCHITECTURE_DECISION_RECORDS.md ADR-017 ("API-client
// integration") for why `@pcs/api-client`'s hc()-based RPC client is NOT
// used here despite being the ADR-012 direction: verifying it against this
// app's real endpoints surfaced that the Worker's route files register
// handlers as separate unchained statements (`auth.post(...)`, not
// `auth = auth.post(...).post(...)`), which loses Hono's type-accumulation
// across calls — `AppType` resolves each sub-route group to a blank schema,
// not the specific typed paths. That's a pre-existing gap in the Worker's
// route-file style (nothing to do with React Native), tracked as follow-up
// work rather than fixed here, since fixing it means touching every route
// file in a milestone that explicitly should not risk regressing already-
// shipped backend behavior.
//
// Hand-typed request/response interfaces in
// authApi.ts (verified directly against worker/src/routes/*.ts during this
// milestone's pre-flight) are the pragmatic, explicitly-permitted fallback
// ("extend it minimally... do not duplicate API contracts unless
// unavoidable" — M3 instructions §6).
//
// - publicFetch:  register / login / verify-email / resend-verification. A
//   401 here means "wrong password" or "invalid code", never "expired
//   token" — these endpoints don't take a token at all, so there is nothing
//   to refresh, and blindly refreshing on every failed login attempt would
//   be both wasteful and, worse, could succeed using a DIFFERENT already-
//   signed-in identity's stored refresh token if one happened to exist on
//   the device, which is not what a failed login should ever do.
// - authenticatedFetch: /api/auth/me, /api/auth/logout-all, /api/sessions/*.
//   A 401 here means the access token is missing/expired — refresh-and-
//   retry-once is exactly the right response.

const REQUEST_TIMEOUT_MS = 15_000;

// A plain JSON request (session PATCH, auth, etc.) that hasn't gotten a
// response within 15s is reasonably treated as unreachable. A multipart
// file upload (a multi-MB photo, especially a lossless PNG rather than a
// JPEG of the same picture) can legitimately still be in flight at 15s on
// a real, merely-slow connection — using the same short ceiling for both
// was misclassifying a genuinely-still-uploading request as a dead
// connection. Only uploadApi.ts's file POST opts into this longer timeout;
// every other request keeps the short one so a truly dead connection still
// fails fast.
export const UPLOAD_TIMEOUT_MS = 60_000;

async function timedFetch(input: RequestInfo | URL, init?: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

// Deliberately bypasses authenticatedFetch entirely — a failed refresh call
// must never itself trigger another refresh attempt (see refreshCoordinator.ts
// and __tests__/apiClient.test.ts "never loops").
async function performRefresh(refreshToken: string): Promise<RefreshOutcome> {
  const res = await timedFetch(`${env.apiBaseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return { ok: false };
  const data = (await res.json()) as { accessToken: string; refreshToken: string; expiresIn: number; email: string; role: string };
  return { ok: true, ...data };
}

const refreshCoordinator = createRefreshCoordinator(performRefresh);

type AuthExpiredListener = () => void | Promise<void>;
let authExpiredListener: AuthExpiredListener | null = null;

/** AuthContext registers exactly one listener on mount, to move app state to
 * signedOut when a refresh definitively fails. Not an event emitter with
 * multiple subscribers — there is only ever one thing that needs to know. */
export function setAuthExpiredListener(listener: AuthExpiredListener | null): void {
  authExpiredListener = listener;
}

async function handleAuthExpired(): Promise<void> {
  setAccessToken(null);
  await clearStoredRefreshToken();
  await authExpiredListener?.();
}

export const publicFetch: typeof fetch = (input, init) => timedFetch(input, init);

// Not typed as exactly `typeof fetch` (unlike publicFetch above) — the
// optional third param lets uploadApi.ts's file upload opt into
// UPLOAD_TIMEOUT_MS; every other existing call site (sessionApi.ts,
// authApi.ts) omits it and gets the same REQUEST_TIMEOUT_MS default as
// before, so this is purely additive.
export const authenticatedFetch = async (input: RequestInfo | URL, init?: RequestInit, timeoutMs: number = REQUEST_TIMEOUT_MS): Promise<Response> => {
  const attempt = (): Promise<Response> => {
    const headers = new Headers(init?.headers);
    const token = getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return timedFetch(input, { ...init, headers }, timeoutMs);
  };

  const first = await attempt();
  if (first.status !== 401) return first;

  const storedRefreshToken = await getStoredRefreshToken();
  if (!storedRefreshToken) {
    await handleAuthExpired();
    return first;
  }

  const outcome = await refreshCoordinator.refresh(storedRefreshToken);
  if (!outcome.ok) {
    await handleAuthExpired();
    return first;
  }

  setAccessToken(outcome.accessToken);
  await setStoredRefreshToken(outcome.refreshToken);
  return attempt(); // retry exactly once — never recurses into another 401 check
};

export type RestoreOutcome =
  | { status: 'signedIn'; email: string; role: string }
  | { status: 'signedOut' };

/**
 * App-launch auth-state restoration: the access token never survives an app
 * kill (tokenStore.ts is memory-only), so on cold start the only signal is
 * whatever refresh token secureStore still has. Reuses the same
 * refreshCoordinator/performRefresh as the 401 interceptor rather than a
 * separate code path, so there is exactly one way a refresh token is ever
 * redeemed in this app.
 */
export async function restoreSession(): Promise<RestoreOutcome> {
  const storedRefreshToken = await getStoredRefreshToken();
  if (!storedRefreshToken) return { status: 'signedOut' };

  const outcome = await refreshCoordinator.refresh(storedRefreshToken);
  if (!outcome.ok) {
    await clearStoredRefreshToken();
    return { status: 'signedOut' };
  }

  setAccessToken(outcome.accessToken);
  await setStoredRefreshToken(outcome.refreshToken);
  return { status: 'signedIn', email: outcome.email, role: outcome.role };
}

// Exposed for direct unit testing of the interceptor logic in isolation from
// the hc()-wrapped clients above.
export const __internal = { performRefresh, refreshCoordinator };
