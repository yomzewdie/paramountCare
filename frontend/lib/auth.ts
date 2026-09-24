// Auth helpers for Server Actions and Server Components.

import { getWorkerBaseUrl } from './server-config';
import { ADMIN_COOKIE_NAME } from './admin-token';
import { readSetCookie } from './set-cookie';

export interface LoginResult {
  ok: true;
  email: string;
  role: string;
  /** The Worker-issued access JWT, for the portal to re-issue as ITS OWN HttpOnly cookie. Never sent to client JS. */
  adminToken: string;
  /** The Worker's Max-Age for that token, if it sent one. */
  adminTokenMaxAgeSeconds: number | null;
}

export interface LoginError {
  ok: false;
  message: string;
}

export async function loginAdmin(
  email: string,
  password: string,
): Promise<LoginResult | LoginError> {
  let base: string;
  try {
    base = getWorkerBaseUrl();
  } catch {
    console.error('[admin-login] Worker API base URL is not configured (set WORKER_API_BASE_URL).');
    return { ok: false, message: 'The admin portal is not configured correctly. Contact the administrator.' };
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch (err) {
    // Diagnostic only — no credentials, no URL query, no response data.
    console.error('[admin-login] Worker request failed:', err instanceof Error ? err.name : 'unknown');
    return { ok: false, message: 'Unable to reach the server. Please try again.' };
  }

  if (!res.ok) {
    let msg = 'Invalid email or password.';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    return { ok: false, message: msg };
  }

  const body = (await res.json().catch(() => null)) as { email?: string; role?: string } | null;
  const token = readSetCookie(res.headers, ADMIN_COOKIE_NAME);

  // A 200 without the session cookie is a failed login, not a success: never
  // redirect into the portal without a session (that just loops back here).
  if (!token || !body?.email || !body.role) {
    console.error('[admin-login] Worker returned 200 but no usable session cookie/body (status 200, cookie present:', !!token, ')');
    return { ok: false, message: 'Sign-in succeeded but the session could not be established. Please try again.' };
  }

  return { ok: true, email: body.email, role: body.role, adminToken: token.value, adminTokenMaxAgeSeconds: token.maxAgeSeconds };
}
