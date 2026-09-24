import { SELF, env } from 'cloudflare:test';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, TEST_ADMIN_ID } from './setup';
import { generateInviteCode, normalizeInviteCode, hashInviteCode } from '../src/services/inviteCode';
import { hashVerificationCode } from '../src/services/emailVerification';
import { hashPassword } from '../src/services/auth';

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
 * Test seam for observing invite raw values without weakening the
 * production implementation: hashed with the SAME exported production hash
 * function (hashInviteCode, keyed with the same test-environment
 * INVITE_CODE_SECRET every route handler reads from env — see
 * vitest.config.mts), so a test can construct a known raw code, compute its
 * hash itself, and seed the row directly via env.DB — exactly equivalent to
 * "an admin created this invite and the applicant received the real email"
 * without needing the real Resend call (which the production code path
 * still exercises independently and non-fatally, exactly as it does today
 * for other emails). Production route handlers are completely unaware of
 * and unaffected by this — there is no test-only branch anywhere in
 * routes/invites.ts or routes/auth.ts.
 */
export async function seedInvite(email: string, createdBy: number = TEST_ADMIN_ID): Promise<string> {
  const rawCode = generateInviteCode();
  const tokenHash = await hashInviteCode(normalizeInviteCode(rawCode), env.INVITE_CODE_SECRET);
  await env.DB.prepare(
    `INSERT INTO onboarding_invites (email, token_hash, expires_at, created_by) VALUES (?, ?, datetime('now', '+7 days'), ?)`,
  ).bind(email, tokenHash, createdBy).run();
  return rawCode;
}

export async function registerViaInvite(inviteCode: string, password = 'Test-Passw0rd!'): Promise<Response> {
  return SELF.fetch(`${BASE}/api/auth/applicant/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inviteCode, password }),
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

/**
 * Seed an invite and register through the real endpoint. Since the
 * invitation-code redesign, POST /api/auth/applicant/register itself
 * atomically claims the invite, creates the account, marks it verified, and
 * issues a real token pair — so this no longer needs the separate
 * mark-verified-then-login round trip the old two-step flow required. Kept
 * as its own helper (rather than inlining registerViaInvite everywhere)
 * purely so ~100 call sites across the suite didn't need to change when the
 * registration contract did.
 */
export async function registerVerifyAndLoginApplicant(
  email: string,
  password = 'Test-Passw0rd!',
): Promise<{ accessToken: string; refreshToken: string; email: string; role: string }> {
  const rawCode = await seedInvite(email);
  const registerRes = await registerViaInvite(rawCode, password);
  if (registerRes.status !== 201) {
    throw new Error(`registerVerifyAndLoginApplicant: register failed (${registerRes.status}): ${await registerRes.text()}`);
  }
  return registerRes.json();
}

/**
 * Directly inserts an unverified `users` row (real PBKDF2 password hash),
 * bypassing invite/registration entirely. Needed because, post-redesign,
 * EVERY invite-based registration auto-verifies — there is no longer any
 * real code path that produces an unverified account, so the legacy
 * verify-email/resend-verification infrastructure (kept fully functional
 * for other/future flows — see the invitation-code-flow design notes) has
 * no other way to be exercised in isolation.
 */
export async function seedUnverifiedUser(email: string, password = 'Test-Passw0rd!'): Promise<{ id: number }> {
  const passwordHash = await hashPassword(password);
  const row = await env.DB
    .prepare(`INSERT INTO users (email, password_hash) VALUES (?, ?) RETURNING id`)
    .bind(email, passwordHash)
    .first<{ id: number }>();
  if (!row) throw new Error('seedUnverifiedUser: insert returned no row');
  return row;
}
