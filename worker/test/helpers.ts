import { SELF, env } from 'cloudflare:test';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_ADMIN_ID } from './setup';
import { generateOpaqueToken, hashOpaqueToken } from '../src/services/opaqueTokens';
import { hashVerificationCode } from '../src/services/emailVerification';

export const BASE = 'http://example.com';

export function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

export async function loginAsAdmin(): Promise<string> {
  const res = await SELF.fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie') ?? '';
  const match = setCookie.match(/admin_token=[^;]+/);
  if (!match) throw new Error(`loginAsAdmin(): no admin_token cookie in response (status ${res.status})`);
  return match[0];
}

export function extractAllCookies(res: Response): string {
  // Undici/Workers may fold multiple Set-Cookie headers into one header
  // value joined by ", " in some environments, or expose getSetCookie().
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') {
    return getSetCookie.call(res.headers).map((c) => c.split(';')[0]).join('; ');
  }
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(/,(?=\s*\w+=)/).map((c) => c.trim().split(';')[0]).join('; ');
}

/** Full Set-Cookie header strings, attributes included — for verifying
 * Secure/HttpOnly/SameSite flags, unlike extractAllCookies above which
 * intentionally strips attributes down to reusable name=value pairs. */
export function getRawSetCookieHeaders(res: Response): string[] {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === 'function') return getSetCookie.call(res.headers);
  const raw = res.headers.get('set-cookie') ?? '';
  return raw.split(/,(?=\s*\w+=)/).map((c) => c.trim());
}

/**
 * Test seam for observing invite/verification-code raw values without
 * weakening the production implementation: these are hashed with the SAME
 * exported production hash function (hashOpaqueToken), so a test can
 * construct a known raw value, compute its hash itself, and seed the row
 * directly via env.DB — exactly equivalent to "an admin created this invite
 * and the applicant received the real email" without needing the real
 * Resend call (which the production code path still exercises independently
 * and non-fatally, exactly as it does today for other emails). Production
 * route handlers are completely unaware of and unaffected by this — there is
 * no test-only branch anywhere in routes/invites.ts or routes/auth.ts.
 */
export async function seedInvite(email: string, createdBy: number = TEST_ADMIN_ID): Promise<string> {
  const rawToken = generateOpaqueToken();
  const tokenHash = await hashOpaqueToken(rawToken);
  await env.DB.prepare(
    `INSERT INTO onboarding_invites (email, token_hash, expires_at, created_by) VALUES (?, ?, datetime('now', '+7 days'), ?)`,
  ).bind(email, tokenHash, createdBy).run();
  return rawToken;
}

export async function registerViaInvite(inviteToken: string, password = 'Test-Passw0rd!'): Promise<Response> {
  return SELF.fetch(`${BASE}/api/auth/applicant/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteToken, password }),
  });
}

/** Bypasses the real verify-email endpoint for test setup unrelated to
 * verification itself — tests that specifically exercise verify-email use
 * the real endpoint with a known seeded code instead (see seedVerificationCode). */
export async function markVerifiedDirectly(email: string): Promise<void> {
  await env.DB.prepare(`UPDATE users SET email_verified_at = datetime('now') WHERE email = ?`).bind(email).run();
}

export async function seedVerificationCode(email: string, code: string, expiresInSeconds = 600): Promise<void> {
  const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: number }>();
  if (!user) throw new Error(`seedVerificationCode: no user found for ${email}`);
  const codeHash = await hashVerificationCode(code, env.EMAIL_VERIFICATION_SECRET);
  // A JS-generated ISO timestamp, not a SQL datetime('now', '+N seconds')
  // string — that SQL modifier syntax breaks for a negative N (used by the
  // "expired code" test case: '+-10 seconds' is not valid SQLite syntax and
  // silently evaluates to NULL), and mixing SQL's own datetime format with
  // JS-parsed ISO timestamps elsewhere is its own correctness bug — see
  // worker/src/utils/time.ts.
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO email_verification_codes (user_id, code_hash, expires_at, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempt_count = 0, created_at = excluded.created_at`,
  ).bind(user.id, codeHash, expiresAt, createdAt).run();
}

/** Full chain: seed an invite, register through the real endpoint, mark
 * verified directly (bypassing the code-verification step, which is tested
 * separately), and log in through the real endpoint. Returns usable tokens —
 * the drop-in replacement for the old anonymous-registration test helper. */
export async function registerVerifyAndLoginApplicant(
  email: string,
  password = 'Test-Passw0rd!',
  deviceLabel?: string,
): Promise<{ accessToken: string; refreshToken: string; email: string; role: string }> {
  const rawToken = await seedInvite(email);
  const registerRes = await registerViaInvite(rawToken, password);
  if (registerRes.status !== 201) {
    throw new Error(`registerVerifyAndLoginApplicant: register failed (${registerRes.status}): ${await registerRes.text()}`);
  }
  await markVerifiedDirectly(email);

  const loginRes = await SELF.fetch(`${BASE}/api/auth/applicant/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceLabel }),
  });
  if (loginRes.status !== 200) {
    throw new Error(`registerVerifyAndLoginApplicant: login failed (${loginRes.status}): ${await loginRes.text()}`);
  }
  return loginRes.json();
}
