import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD } from './setup';
import { signJwt } from '../src/utils/jwt';
import {
  BASE,
  uniqueEmail,
  loginAsAdmin,
  extractAllCookies,
  getRawSetCookieHeaders,
  seedInvite,
  registerViaInvite,
  markVerifiedDirectly,
  seedVerificationCode,
  registerVerifyAndLoginApplicant,
} from './helpers';

// ── Applicant registration (invite-only) ─────────────────────────────────────

describe('POST /api/auth/applicant/register', () => {
  it('creates an unverified account from a valid invitation, with no tokens and no onboarding session', async () => {
    const email = uniqueEmail('register');
    const rawToken = await seedInvite(email);
    const res = await registerViaInvite(rawToken);
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.email).toBe(email);
    // No tokens issued at registration — verification comes first.
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();

    const row = await env.DB.prepare('SELECT email_verified_at FROM users WHERE email = ?').bind(email).first<{ email_verified_at: string | null }>();
    expect(row?.email_verified_at).toBeNull();

    const sessionRow = await env.DB.prepare('SELECT * FROM onboarding_sessions WHERE email = ?').bind(email).first();
    expect(sessionRow).toBeNull();
  });

  it('rejects registration without any invitation token', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/applicant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'Test-Passw0rd!' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects an invalid/garbage invitation token', async () => {
    const res = await registerViaInvite('totally-made-up-invite-token');
    expect(res.status).toBe(401);
  });

  it('rejects an expired invitation', async () => {
    const email = uniqueEmail('expired-invite');
    const rawToken = await seedInvite(email);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(`UPDATE onboarding_invites SET expires_at = ? WHERE token_hash = ?`)
      .bind(
        oneDayAgo,
        await (async () => {
          const { hashOpaqueToken } = await import('../src/services/opaqueTokens');
          return hashOpaqueToken(rawToken);
        })(),
      )
      .run();
    const res = await registerViaInvite(rawToken);
    expect(res.status).toBe(401);
  });

  it('rejects a revoked invitation', async () => {
    const email = uniqueEmail('revoked-invite');
    const rawToken = await seedInvite(email);
    await env.DB.prepare(`UPDATE onboarding_invites SET revoked_at = datetime('now') WHERE email = ?`).bind(email).run();
    const res = await registerViaInvite(rawToken);
    expect(res.status).toBe(401);
  });

  it('rejects an already-used invitation and cannot be reused', async () => {
    const email = uniqueEmail('used-invite');
    const rawToken = await seedInvite(email);
    const first = await registerViaInvite(rawToken);
    expect(first.status).toBe(201);

    const second = await registerViaInvite(rawToken);
    expect(second.status).toBe(401);
  });

  it('derives the account email from the invitation, not from client-supplied input', async () => {
    const invitedEmail = uniqueEmail('invited');
    const rawToken = await seedInvite(invitedEmail);
    // Even if a client tries to smuggle a different email into the body, the
    // schema has no such field for register — only inviteToken and password.
    const res = await SELF.fetch(`${BASE}/api/auth/applicant/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteToken: rawToken, password: 'Test-Passw0rd!', email: 'attacker-chosen@example.com' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { email: string };
    expect(body.email).toBe(invitedEmail);

    const attackerRow = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('attacker-chosen@example.com').first();
    expect(attackerRow).toBeNull();
  });

  it('rejects registering a second time for an email that already has an account', async () => {
    const email = uniqueEmail('dup-account');
    const firstToken = await seedInvite(email);
    await registerViaInvite(firstToken);

    // A second, independent invite for the same email (simulating an admin
    // accidentally issuing another one).
    const secondToken = await seedInvite(email);
    const res = await registerViaInvite(secondToken);
    expect(res.status).toBe(409);
  });

  it('rejects a too-short password', async () => {
    const rawToken = await seedInvite(uniqueEmail('shortpw'));
    const res = await registerViaInvite(rawToken, 'short');
    expect(res.status).toBe(422);
  });

  it('two simultaneous registration attempts with the same invitation result in exactly one account, one rejection', async () => {
    const email = uniqueEmail('race-http');
    const rawToken = await seedInvite(email);

    const [r1, r2] = await Promise.all([
      registerViaInvite(rawToken, 'Test-Passw0rd!'),
      registerViaInvite(rawToken, 'Different-Passw0rd!'),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([201, 401]);

    const userCount = await env.DB.prepare('SELECT COUNT(*) AS c FROM users WHERE email = ?').bind(email).first<{ c: number }>();
    expect(userCount?.c).toBe(1);

    // The invitation is consumed exactly once, in step with the one account
    // that exists — not left "used" with no corresponding account.
    const invite = await env.DB.prepare('SELECT used_at FROM onboarding_invites WHERE email = ?').bind(email).first<{ used_at: string | null }>();
    expect(invite?.used_at).not.toBeNull();
  });
});

// ── Email verification ───────────────────────────────────────────────────────

describe('Email verification', () => {
  async function registerUnverified(label: string): Promise<string> {
    const email = uniqueEmail(label);
    const rawToken = await seedInvite(email);
    const res = await registerViaInvite(rawToken);
    expect(res.status).toBe(201);
    return email;
  }

  it('verifies the account with the correct code', async () => {
    const email = await registerUnverified('verify-ok');
    await seedVerificationCode(email, '123456');

    const res = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456' }),
    });
    expect(res.status).toBe(200);

    const row = await env.DB.prepare('SELECT email_verified_at FROM users WHERE email = ?').bind(email).first<{ email_verified_at: string | null }>();
    expect(row?.email_verified_at).not.toBeNull();
  });

  it('rejects an incorrect code', async () => {
    const email = await registerUnverified('verify-wrong');
    await seedVerificationCode(email, '123456');

    const res = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '000000' }),
    });
    expect(res.status).toBe(401);

    const row = await env.DB.prepare('SELECT email_verified_at FROM users WHERE email = ?').bind(email).first<{ email_verified_at: string | null }>();
    expect(row?.email_verified_at).toBeNull();
  });

  it('rejects an expired code', async () => {
    const email = await registerUnverified('verify-expired');
    await seedVerificationCode(email, '123456', -10); // already expired

    const res = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456' }),
    });
    expect(res.status).toBe(401);
  });

  it('locks out further attempts after too many incorrect codes', async () => {
    const email = await registerUnverified('verify-lockout');
    await seedVerificationCode(email, '123456');

    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: '000000' }),
      });
      expect(res.status).toBe(401);
    }

    // Even the CORRECT code is now rejected — attempts are exhausted.
    const finalTry = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456' }),
    });
    expect(finalTry.status).toBe(401);
  });

  it('a code cannot be reused after successful verification', async () => {
    const email = await registerUnverified('verify-onetime');
    await seedVerificationCode(email, '123456');

    const first = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456' }),
    });
    expect(first.status).toBe(200);

    const second = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '123456' }),
    });
    expect(second.status).toBe(401);
  });

  it('a verified account remains verified (cannot be un-verified)', async () => {
    const email = await registerUnverified('verify-stays');
    await markVerifiedDirectly(email);
    const row = await env.DB.prepare('SELECT email_verified_at FROM users WHERE email = ?').bind(email).first<{ email_verified_at: string }>();
    const verifiedAt = row!.email_verified_at;
    expect(verifiedAt).not.toBeNull();

    // Attempting to verify again (e.g. a stale client retry) does not alter it.
    await seedVerificationCode(email, '999999');
    await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '999999' }),
    });
    const rowAfter = await env.DB.prepare('SELECT email_verified_at FROM users WHERE email = ?').bind(email).first<{ email_verified_at: string }>();
    expect(rowAfter!.email_verified_at).toBe(verifiedAt);
  });

  it('resend issues a new code that invalidates the previous one', async () => {
    const email = await registerUnverified('verify-resend');
    await seedVerificationCode(email, '111111');

    // Age the existing code's created_at past the cooldown so resend proceeds.
    // A JS-generated ISO timestamp, bound as a parameter — not a SQL
    // datetime('now', ...) literal, which the resend handler's cooldown
    // check (a JS `new Date(...)` comparison) cannot reliably cross-parse
    // against — see worker/src/utils/time.ts.
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await env.DB.prepare(`UPDATE email_verification_codes SET created_at = ? WHERE user_id = (SELECT id FROM users WHERE email = ?)`).bind(twoMinutesAgo, email).run();

    const resendRes = await SELF.fetch(`${BASE}/api/auth/applicant/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(resendRes.status).toBe(200);

    // The OLD code must no longer work.
    const oldCodeRes = await SELF.fetch(`${BASE}/api/auth/applicant/verify-email`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: '111111' }),
    });
    expect(oldCodeRes.status).toBe(401);
  });

  it('gives a generic response for an unknown email (no account enumeration)', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/applicant/resend-verification`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail('nobody-resend') }),
    });
    expect(res.status).toBe(200);
  });

  // ── Storage hardening (HMAC, not plain SHA-256) ─────────────────────────────

  it('never persists the raw code — only a keyed-hash verifier', async () => {
    const email = await registerUnverified('verify-raw-not-stored');
    await seedVerificationCode(email, '654321');

    const row = await env.DB
      .prepare('SELECT code_hash FROM email_verification_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .bind(email)
      .first<{ code_hash: string }>();

    expect(row?.code_hash).toBeDefined();
    expect(row!.code_hash).not.toBe('654321');
    // A 64-hex-char digest, not a 6-digit string.
    expect(row!.code_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the stored verifier is not reproducible with plain, unkeyed SHA-256(code) — proves it is a keyed HMAC', async () => {
    const email = await registerUnverified('verify-keyed-hmac');
    const code = '246810';
    await seedVerificationCode(email, code);

    const row = await env.DB
      .prepare('SELECT code_hash FROM email_verification_codes WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .bind(email)
      .first<{ code_hash: string }>();

    const { hashOpaqueToken } = await import('../src/services/opaqueTokens');
    const plainSha256 = await hashOpaqueToken(code); // plain SHA-256(code), no key

    // If storage were plain SHA-256(code), anyone who read this column out of
    // a D1 leak could hash all 1,000,000 six-digit codes offline in well
    // under a second and recover every outstanding code. It must not match —
    // and, since HMAC-SHA256 with an unknown key is what's actually stored,
    // no unkeyed guess (correct code included) can ever reproduce it.
    expect(row!.code_hash).not.toBe(plainSha256);
  });
});

// ── Applicant login ────────────────────────────────────────────────────────────

describe('POST /api/auth/applicant/login', () => {
  it('rejects an unverified account with a machine-readable error, even with the correct password', async () => {
    const email = uniqueEmail('login-unverified');
    const password = 'Correct-Passw0rd!';
    const rawToken = await seedInvite(email);
    await registerViaInvite(rawToken, password);

    const res = await SELF.fetch(`${BASE}/api/auth/applicant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('EMAIL_NOT_VERIFIED');
  });

  it('logs in a verified account with correct credentials', async () => {
    const email = uniqueEmail('login-ok');
    const { accessToken, refreshToken } = await registerVerifyAndLoginApplicant(email, 'Correct-Passw0rd!');
    expect(typeof accessToken).toBe('string');
    expect(typeof refreshToken).toBe('string');
  });

  it('rejects the wrong password regardless of verification status', async () => {
    const email = uniqueEmail('login-wrong');
    const rawToken = await seedInvite(email);
    await registerViaInvite(rawToken, 'Correct-Passw0rd!');
    await markVerifiedDirectly(email);

    const res = await SELF.fetch(`${BASE}/api/auth/applicant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Wrong-Password!' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/applicant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail('nobody'), password: 'whatever123' }),
    });
    expect(res.status).toBe(401);
  });
});

// ── Access token validation ───────────────────────────────────────────────────

describe('Access token validation (GET /api/auth/me)', () => {
  it('accepts a valid applicant Bearer token', async () => {
    const email = uniqueEmail('me-ok');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);
    const res = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    const me = await res.json() as { email: string; role: string };
    expect(me.email).toBe(email);
    expect(me.role).toBe('applicant');
  });

  it('rejects a malformed token', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    // Signed with the real test-environment secret so the signature itself
    // is valid — this isolates the expiry check from the signature check
    // (already covered by the malformed-token case above).
    const expired = await signJwt(
      { sub: 'x@example.com', uid: 1, role: 'applicant', userType: 'applicant' },
      env.ADMIN_JWT_SECRET,
      -10, // already expired 10 seconds ago
    );
    const res = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${expired}` },
    });
    expect(res.status).toBe(401);
  });

  it('rejects no token at all', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/me`);
    expect(res.status).toBe(401);
  });
});

// ── Refresh, rotation, reuse detection ────────────────────────────────────────

describe('POST /api/auth/refresh (applicant/mobile)', () => {
  it('rotates: issues a new pair and invalidates the old refresh token', async () => {
    const body = await registerVerifyAndLoginApplicant(uniqueEmail('rotate'));

    const refreshRes = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(refreshRes.status).toBe(200);
    const rotated = await refreshRes.json() as { accessToken: string; refreshToken: string };
    expect(rotated.refreshToken).not.toBe(body.refreshToken);
    expect(rotated.accessToken).not.toBe(body.accessToken);

    // New access token works.
    const meRes = await SELF.fetch(`${BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${rotated.accessToken}` },
    });
    expect(meRes.status).toBe(200);
  });

  it('detects reuse of an already-rotated refresh token and revokes the whole chain', async () => {
    const body = await registerVerifyAndLoginApplicant(uniqueEmail('reuse'));

    const firstRefresh = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(firstRefresh.status).toBe(200);
    const rotated = await firstRefresh.json() as { refreshToken: string };

    // Present the ORIGINAL (now-dead) token again — this is replay.
    const replayRes = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(replayRes.status).toBe(401);

    // The legitimately-rotated token must ALSO now be dead — reuse detection
    // burns the entire family, not just the replayed token.
    const secondRefresh = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rotated.refreshToken }),
    });
    expect(secondRefresh.status).toBe(401);
  });

  it('rejects an unknown/garbage refresh token', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'totally-made-up-value' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a refresh token after logout revokes it', async () => {
    const body = await registerVerifyAndLoginApplicant(uniqueEmail('logout-then-refresh'));

    const logoutRes = await SELF.fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(logoutRes.status).toBe(200);

    const refreshRes = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(refreshRes.status).toBe(401);
  });
});

describe('Admin refresh (cookie-based)', () => {
  it('admin login also issues a working refresh cookie', async () => {
    const loginRes = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    expect(loginRes.status).toBe(200);
    const cookies = extractAllCookies(loginRes);
    expect(cookies).toMatch(/admin_token=/);
    expect(cookies).toMatch(/admin_refresh_token=/);

    const refreshRes = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie: cookies },
    });
    expect(refreshRes.status).toBe(200);
    const refreshCookies = extractAllCookies(refreshRes);
    expect(refreshCookies).toMatch(/admin_token=/);
    expect(refreshCookies).toMatch(/admin_refresh_token=/);
  });
});

// ── Logout-all ─────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout-all', () => {
  it('revokes every refresh token for the identity, across devices', async () => {
    const email = uniqueEmail('logout-all');
    const password = 'Test-Passw0rd!';
    const device1 = await registerVerifyAndLoginApplicant(email, password);

    const loginRes2 = await SELF.fetch(`${BASE}/api/auth/applicant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, deviceLabel: 'device-2' }),
    });
    const device2 = await loginRes2.json() as { accessToken: string; refreshToken: string };

    const logoutAllRes = await SELF.fetch(`${BASE}/api/auth/logout-all`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${device1.accessToken}` },
    });
    expect(logoutAllRes.status).toBe(200);

    const refresh1 = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: device1.refreshToken }),
    });
    expect(refresh1.status).toBe(401);

    const refresh2 = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: device2.refreshToken }),
    });
    expect(refresh2.status).toBe(401);
  });

  it('per-device sessions are independent until logout-all: revoking one device does not affect another', async () => {
    const email = uniqueEmail('per-device');
    const password = 'Test-Passw0rd!';
    const device1 = await registerVerifyAndLoginApplicant(email, password);
    const loginRes2 = await SELF.fetch(`${BASE}/api/auth/applicant/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const device2 = await loginRes2.json() as { accessToken: string; refreshToken: string };

    // Log out device 1 only (single-session logout, not logout-all).
    await SELF.fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: device1.refreshToken }),
    });

    const refresh1 = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: device1.refreshToken }),
    });
    expect(refresh1.status).toBe(401);

    // Device 2's session must be untouched.
    const refresh2 = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: device2.refreshToken }),
    });
    expect(refresh2.status).toBe(200);
  });
});

// ── Role enforcement ───────────────────────────────────────────────────────────

describe('Role enforcement', () => {
  it('rejects an applicant token used against admin routes', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('privesc'));
    const res = await SELF.fetch(`${BASE}/api/admin/applications`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(403);
  });

  it('still accepts a valid admin cookie against admin routes', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/applications`, { headers: { cookie } });
    expect(res.status).toBe(200);
  });

  it('rejects an admin token used against an applicant-only route', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/sessions/mine`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });
});

// ── Unauthorized access ────────────────────────────────────────────────────────

describe('Unauthorized access', () => {
  it('rejects protected routes with no credentials at all', async () => {
    const res = await SELF.fetch(`${BASE}/api/auth/logout-all`, { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

// ── Additional edge cases (explicit final-review requirements) ──────────────

describe('Cookie security attributes', () => {
  it('admin login sets both cookies with Secure, HttpOnly, and SameSite=Strict', async () => {
    const loginRes = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD }),
    });
    const rawCookies = getRawSetCookieHeaders(loginRes);
    expect(rawCookies.length).toBe(2);

    const accessCookie = rawCookies.find((c) => c.startsWith('admin_token='));
    const refreshCookie = rawCookies.find((c) => c.startsWith('admin_refresh_token='));
    expect(accessCookie).toBeTruthy();
    expect(refreshCookie).toBeTruthy();

    for (const cookie of [accessCookie!, refreshCookie!]) {
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/Secure/i);
      expect(cookie).toMatch(/SameSite=Strict/i);
    }
    // The refresh cookie is additionally scoped to reduce which requests carry it.
    expect(refreshCookie).toMatch(/Path=\/api\/auth/);
  });
});

describe('Reuse detection is scoped to the affected identity only', () => {
  it('revoking one user\'s family on reuse detection does not affect a different user\'s session', async () => {
    const victimA = await registerVerifyAndLoginApplicant(uniqueEmail('reuse-scope-a'));
    const userB = await registerVerifyAndLoginApplicant(uniqueEmail('reuse-scope-b'));

    // Trigger reuse detection on A's chain: rotate once, then replay the dead token.
    const rotateA = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: victimA.refreshToken }),
    });
    expect(rotateA.status).toBe(200);
    const replayA = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: victimA.refreshToken }), // already-rotated — replay
    });
    expect(replayA.status).toBe(401);

    // User B's completely independent session must be entirely unaffected.
    const refreshB = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: userB.refreshToken }),
    });
    expect(refreshB.status).toBe(200);
  });
});

describe('Expired refresh tokens are rejected', () => {
  it('rejects a refresh token whose expires_at is in the past', async () => {
    // Register/verify/login normally, then directly age the stored
    // refresh_tokens row's expires_at into the past — exercising the expiry
    // branch of rotateRefreshToken without waiting 30 real days.
    const body = await registerVerifyAndLoginApplicant(uniqueEmail('expired-refresh'));
    const hashHex = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.refreshToken))),
    ).map((b) => b.toString(16).padStart(2, '0')).join('');

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(
      `UPDATE refresh_tokens SET expires_at = ? WHERE token_hash = ?`,
    ).bind(oneDayAgo, hashHex).run();

    const res = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: body.refreshToken }),
    });
    expect(res.status).toBe(401);
  });
});

describe('Role changes are honored on refresh', () => {
  it('reflects a role change made after login on the very next refresh', async () => {
    // Seed a second admin as 'admin', log in, then promote to 'super_admin'
    // directly in the DB (simulating an out-of-band role change) and confirm
    // the next refresh issues a token with the NEW role, not a stale one.
    const email = uniqueEmail('role-change-admin');
    const { hashPassword } = await import('../src/services/auth');
    const passwordHash = await hashPassword('Test-Passw0rd!');
    await env.DB.prepare(`INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, 'admin')`)
      .bind(email, passwordHash)
      .run();

    const loginRes = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Test-Passw0rd!' }),
    });
    expect(loginRes.status).toBe(200);
    const initial = await loginRes.json() as { role: string };
    expect(initial.role).toBe('admin');

    const cookies = extractAllCookies(loginRes);
    await env.DB.prepare(`UPDATE admin_users SET role = 'super_admin' WHERE email = ?`).bind(email).run();

    const refreshRes = await SELF.fetch(`${BASE}/api/auth/refresh`, {
      method: 'POST',
      headers: { cookie: cookies },
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = await refreshRes.json() as { role: string };
    expect(refreshed.role).toBe('super_admin');
  });
});
