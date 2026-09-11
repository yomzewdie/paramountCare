import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { signJwt, DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS, type UserType } from '../utils/jwt';
import { verifyPassword, hashPassword } from '../services/auth';
import { generateRawRefreshToken, hashRefreshToken, generateFamilyId } from '../services/refreshTokens';
import { hashOpaqueToken, constantTimeEqual } from '../services/opaqueTokens';
import {
  generateVerificationCode,
  hashVerificationCode,
  VERIFICATION_CODE_EXPIRY_SECONDS,
  MAX_VERIFICATION_ATTEMPTS,
  VERIFICATION_RESEND_COOLDOWN_SECONDS,
} from '../services/emailVerification';
import { sendEmailVerificationCode } from '../services/email';
import { findAdminUserByEmail } from '../db/queries/adminUsers';
import { findUserByEmail, findUserById, markUserEmailVerified, type UserRow } from '../db/queries/users';
import {
  insertRefreshToken,
  findRefreshTokenByHash,
  markRefreshTokenRotated,
  revokeRefreshTokenByHash,
  revokeRefreshTokenFamily,
  revokeAllRefreshTokensForIdentity,
} from '../db/queries/refreshTokens';
import { findOnboardingInviteByTokenHash, claimInviteAndCreateUser } from '../db/queries/onboardingInvites';
import {
  upsertEmailVerificationCode,
  findEmailVerificationCodeForUser,
  incrementEmailVerificationAttempts,
  deleteEmailVerificationCode,
} from '../db/queries/emailVerificationCodes';
import { registerSchema, loginSchema, verifyEmailSchema, resendVerificationSchema } from '../schemas/auth';
import { requireAuth } from '../middleware/requireAuth';
import { isoInSeconds } from '../utils/time';

export const auth = new Hono<AppEnv>();

// ── Cookie configuration (admin web only — mobile/API clients never use
// cookies, they read tokens from the JSON response body) ────────────────────

const ACCESS_COOKIE_NAME  = 'admin_token';
const REFRESH_COOKIE_NAME = 'admin_refresh_token';

// Unchanged from before M2 — preserves the existing admin session length.
// Silent refresh is not wired into the admin web app in this milestone (see
// the M2 report), so shortening this would just log admins out mid-session.
const ADMIN_ACCESS_EXPIRY_SECONDS = 8 * 60 * 60;
const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days, both surfaces

function cookieOpts(maxAgeSeconds: number, path = '/'): string {
  return `HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=${maxAgeSeconds}`;
}

function expiredCookieOpts(path = '/'): string {
  return `HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=0`;
}

// ── Shared refresh-token issuance/rotation ───────────────────────────────────

interface IssuedTokens {
  accessToken: string;
  rawRefreshToken: string;
  role: string;
  email: string;
  uid: number;
}

async function issueTokenPair(
  c: { env: { ADMIN_JWT_SECRET: string; DB: D1Database } },
  params: {
    userType: UserType;
    uid: number;
    email: string;
    role: string;
    accessExpirySeconds: number;
    deviceLabel?: string;
    /** Pass the existing family_id when rotating so reuse-detection can
     * revoke the whole chain; omit for a fresh login/registration, which
     * starts a brand-new family. */
    familyId?: string;
  },
): Promise<IssuedTokens> {
  const accessToken = await signJwt(
    { sub: params.email, uid: params.uid, role: params.role, userType: params.userType },
    c.env.ADMIN_JWT_SECRET,
    params.accessExpirySeconds,
  );

  const rawRefreshToken = generateRawRefreshToken();
  const tokenHash = await hashRefreshToken(rawRefreshToken);
  await insertRefreshToken(c.env.DB, {
    tokenHash,
    userType: params.userType,
    userId: params.uid,
    familyId: params.familyId ?? generateFamilyId(),
    expiresAt: isoInSeconds(REFRESH_TOKEN_EXPIRY_SECONDS),
    deviceLabel: params.deviceLabel,
  });

  return { accessToken, rawRefreshToken, role: params.role, email: params.email, uid: params.uid };
}

type RotateResult =
  | { ok: true; tokens: IssuedTokens; userType: UserType }
  | { ok: false; reason: 'invalid' | 'revoked' | 'expired' | 'reused' | 'account_missing' };

/**
 * Refresh-token rotation with reuse detection (docs/ARCHITECTURE_DECISION_RECORDS.md
 * ADR-008). The current role is re-read from the identity table rather than
 * trusted from any prior claim, so a role change or account removal takes
 * effect on the very next refresh rather than waiting out an old token.
 */
async function rotateRefreshToken(
  c: { env: { ADMIN_JWT_SECRET: string; DB: D1Database } },
  rawToken: string,
): Promise<RotateResult> {
  const tokenHash = await hashRefreshToken(rawToken);
  const existing = await findRefreshTokenByHash(c.env.DB, tokenHash);
  if (!existing) return { ok: false, reason: 'invalid' };

  if (existing.revoked_at) return { ok: false, reason: 'revoked' };

  if (existing.replaced_by_id !== null) {
    // This exact token was already rotated once — presenting it again means
    // it was copied/stolen. Burn the whole chain, not just this token.
    await revokeRefreshTokenFamily(c.env.DB, existing.family_id);
    return { ok: false, reason: 'reused' };
  }

  if (new Date(existing.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  const userType = existing.user_type;
  let email: string;
  let role: string;

  if (userType === 'admin') {
    const row = await c.env.DB
      .prepare('SELECT email, role FROM admin_users WHERE id = ? LIMIT 1')
      .bind(existing.user_id)
      .first<{ email: string; role: string }>();
    if (!row) return { ok: false, reason: 'account_missing' };
    email = row.email;
    role = row.role;
  } else {
    const user = await findUserById(c.env.DB, existing.user_id);
    if (!user) return { ok: false, reason: 'account_missing' };
    email = user.email;
    role = 'applicant';
  }

  const accessExpirySeconds = userType === 'admin' ? ADMIN_ACCESS_EXPIRY_SECONDS : DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS;
  const tokens = await issueTokenPair(c, {
    userType,
    uid: existing.user_id,
    email,
    role,
    accessExpirySeconds,
    deviceLabel: existing.device_label ?? undefined,
    familyId: existing.family_id, // preserve the chain — required for reuse detection to work at all
  });

  // Mark the presented token as rotated (its replacement is the new row just
  // inserted by issueTokenPair). We look the new row up by its hash to get
  // its id without threading an extra id through issueTokenPair.
  const newHash = await hashRefreshToken(tokens.rawRefreshToken);
  const newRow = await findRefreshTokenByHash(c.env.DB, newHash);
  if (newRow) await markRefreshTokenRotated(c.env.DB, existing.id, newRow.id);

  return { ok: true, tokens, userType };
}

// ── Admin login (unchanged request/response shape; now also issues a
// server-tracked refresh token alongside the existing access-token cookie) ──

auth.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const user = await findAdminUserByEmail(c.env.DB, email.toLowerCase().trim());

  // Constant-time path: always call verifyPassword even on miss so timing
  // doesn't reveal whether the email exists.
  const sentinel = 'pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, sentinel).then(() => false);

  if (!ok || !user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const tokens = await issueTokenPair(c, {
    userType: 'admin',
    uid: user.id,
    email: user.email,
    role: user.role,
    accessExpirySeconds: ADMIN_ACCESS_EXPIRY_SECONDS,
  });

  c.header('Set-Cookie', `${ACCESS_COOKIE_NAME}=${tokens.accessToken}; ${cookieOpts(ADMIN_ACCESS_EXPIRY_SECONDS)}`, { append: true });
  c.header('Set-Cookie', `${REFRESH_COOKIE_NAME}=${tokens.rawRefreshToken}; ${cookieOpts(REFRESH_TOKEN_EXPIRY_SECONDS, '/api/auth')}`, { append: true });

  return c.json({ email: user.email, role: user.role });
});

// ── Applicant registration (invite-only) ─────────────────────────────────────
//
// Product decision: applicants cannot self-register. The email is always
// derived from the invitation record, never from client input. Registration
// does not issue tokens and does not create an onboarding session — the
// account is created UNVERIFIED, a verification code is sent, and the
// applicant must verify before they can sign in at all.

async function issueAndSendVerificationCode(
  c: { env: { DB: D1Database; RESEND_API_KEY: string; EMAIL_VERIFICATION_SECRET: string } },
  user: Pick<UserRow, 'id' | 'email'>,
): Promise<void> {
  const code = generateVerificationCode();
  const codeHash = await hashVerificationCode(code, c.env.EMAIL_VERIFICATION_SECRET);
  await upsertEmailVerificationCode(c.env.DB, {
    userId: user.id,
    codeHash,
    expiresAt: isoInSeconds(VERIFICATION_CODE_EXPIRY_SECONDS),
  });

  if (!c.env.RESEND_API_KEY) {
    console.warn('[auth] verification code email skipped: RESEND_API_KEY not configured');
    return;
  }
  try {
    await sendEmailVerificationCode(c.env.RESEND_API_KEY, { to: user.email, code });
  } catch (e) {
    // Non-fatal — the applicant can request a new code via resend-verification.
    console.error('[auth] failed to send verification code:', e);
  }
}

auth.post('/applicant/register', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = registerSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  // A single generic response for every invitation-invalidity reason (not
  // found, expired, revoked, already used) — deliberately not distinguished,
  // to avoid leaking anything about token validity structure to a caller
  // who doesn't already hold a real invitation.
  const invalidInvite = () => c.json({ error: 'Invalid or expired invitation' }, 401);

  const tokenHash = await hashOpaqueToken(result.data.inviteToken);
  const invite = await findOnboardingInviteByTokenHash(c.env.DB, tokenHash);
  if (!invite || invite.revoked_at || invite.used_at) return invalidInvite();
  if (new Date(invite.expires_at).getTime() < Date.now()) return invalidInvite();

  // Email always comes from the invitation record — never from the request body.
  const email = invite.email;

  const existingUser = await findUserByEmail(c.env.DB, email);
  if (existingUser) {
    return c.json({ error: 'An account with this email already exists' }, 409);
  }

  // Claiming the invite and creating the account happen as one atomic unit
  // (see claimInviteAndCreateUser's doc comment): either both persist, or
  // neither does. This is what makes two simultaneous registration attempts
  // against the same invite, and a user-creation failure after a would-be
  // claim, both safe — there is no window where the invite is burned but no
  // account exists.
  const passwordHash = await hashPassword(result.data.password);
  const claimResult = await claimInviteAndCreateUser(c.env.DB, invite, email, passwordHash);
  if (!claimResult.ok) {
    if (claimResult.reason === 'email_taken') {
      return c.json({ error: 'An account with this email already exists' }, 409);
    }
    return invalidInvite();
  }
  const user = claimResult.user;

  await issueAndSendVerificationCode(c, user);

  // No tokens, no onboarding session — verification comes next.
  return c.json({ email: user.email, message: 'Verification code sent. Check your email to continue.' }, 201);
});

// ── Email verification ───────────────────────────────────────────────────────

auth.post('/applicant/verify-email', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = verifyEmailSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  // One generic failure for every reason (unknown email, already verified, no
  // active code, expired code, too many attempts, wrong code) — reduces
  // account-enumeration surface to nothing beyond "did verification succeed".
  const invalidCode = () => c.json({ error: 'Invalid or expired verification code' }, 401);

  const email = result.data.email.toLowerCase().trim();
  const user = await findUserByEmail(c.env.DB, email);
  if (!user || user.email_verified_at) return invalidCode();

  const codeRow = await findEmailVerificationCodeForUser(c.env.DB, user.id);
  if (!codeRow) return invalidCode();
  if (new Date(codeRow.expires_at).getTime() < Date.now()) return invalidCode();
  if (codeRow.attempt_count >= MAX_VERIFICATION_ATTEMPTS) return invalidCode();

  const presentedHash = await hashVerificationCode(result.data.code, c.env.EMAIL_VERIFICATION_SECRET);
  if (!constantTimeEqual(presentedHash, codeRow.code_hash)) {
    await incrementEmailVerificationAttempts(c.env.DB, user.id);
    return invalidCode();
  }

  await markUserEmailVerified(c.env.DB, user.id);
  await deleteEmailVerificationCode(c.env.DB, user.id); // one-time use — consumed

  return c.json({ email: user.email, verified: true });
});

auth.post('/applicant/resend-verification', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = resendVerificationSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  // Always the same response regardless of whether the account exists, is
  // already verified, or is in cooldown — avoids confirming any of those to
  // the caller (standard "if an account exists..." pattern).
  const genericAck = () => c.json({ message: 'If an account exists and is not yet verified, a new code has been sent.' });

  const email = result.data.email.toLowerCase().trim();
  const user = await findUserByEmail(c.env.DB, email);
  if (!user || user.email_verified_at) return genericAck();

  const existingCode = await findEmailVerificationCodeForUser(c.env.DB, user.id);
  if (existingCode) {
    const secondsSinceLast = (Date.now() - new Date(existingCode.created_at).getTime()) / 1000;
    if (secondsSinceLast < VERIFICATION_RESEND_COOLDOWN_SECONDS) {
      return genericAck(); // cooldown active — silently no-op, still generic
    }
  }

  await issueAndSendVerificationCode(c, user);
  return genericAck();
});

// ── Applicant login (requires a verified email) ──────────────────────────────

auth.post('/applicant/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = loginSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  const email = result.data.email.toLowerCase().trim();
  const user = await findUserByEmail(c.env.DB, email);

  const sentinel = 'pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const ok = user
    ? await verifyPassword(result.data.password, user.password_hash)
    : await verifyPassword(result.data.password, sentinel).then(() => false);

  if (!ok || !user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  // Checked only AFTER the password is confirmed correct — checking this
  // first would let a caller probe "is this email verified" without knowing
  // the password at all.
  if (!user.email_verified_at) {
    return c.json({ error: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before signing in.' }, 403);
  }

  const tokens = await issueTokenPair(c, {
    userType: 'applicant',
    uid: user.id,
    email: user.email,
    role: 'applicant',
    accessExpirySeconds: DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS,
    deviceLabel: result.data.deviceLabel,
  });

  return c.json({
    email: tokens.email,
    role: tokens.role,
    accessToken: tokens.accessToken,
    refreshToken: tokens.rawRefreshToken,
    expiresIn: DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS,
  });
});

// ── Refresh (shared by both surfaces) ────────────────────────────────────────
//
// Admin web: refresh token comes from the admin_refresh_token cookie; the new
// pair is set as cookies again, response body carries no tokens.
// Applicant/mobile: refresh token comes from the JSON body; the new pair is
// returned in the JSON body.

auth.post('/refresh', async (c) => {
  const cookieHeader = c.req.header('cookie') ?? '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)admin_refresh_token=([^;]+)/);
  const cookieToken = cookieMatch?.[1];

  let bodyToken: string | undefined;
  if (!cookieToken) {
    let body: unknown = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    bodyToken = (body as { refreshToken?: string }).refreshToken;
  }

  const rawToken = cookieToken ?? bodyToken;
  if (!rawToken) {
    return c.json({ error: 'Refresh token is required' }, 400);
  }

  const result = await rotateRefreshToken(c, rawToken);
  if (!result.ok) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  if (cookieToken) {
    // Admin path — reissue both cookies, old refresh cookie value is now dead.
    c.header('Set-Cookie', `${ACCESS_COOKIE_NAME}=${result.tokens.accessToken}; ${cookieOpts(ADMIN_ACCESS_EXPIRY_SECONDS)}`, { append: true });
    c.header('Set-Cookie', `${REFRESH_COOKIE_NAME}=${result.tokens.rawRefreshToken}; ${cookieOpts(REFRESH_TOKEN_EXPIRY_SECONDS, '/api/auth')}`, { append: true });
    return c.json({ email: result.tokens.email, role: result.tokens.role });
  }

  return c.json({
    email: result.tokens.email,
    role: result.tokens.role,
    accessToken: result.tokens.accessToken,
    refreshToken: result.tokens.rawRefreshToken,
    expiresIn: result.userType === 'admin' ? ADMIN_ACCESS_EXPIRY_SECONDS : DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS,
  });
});

// ── Logout (single session) ──────────────────────────────────────────────────
//
// Preserves the exact prior behavior for admin (always clears the cookie and
// returns {ok:true}), and additionally revokes the specific refresh token
// record when one is presented, via cookie (admin) or JSON body (applicant).

auth.post('/logout', async (c) => {
  const cookieHeader = c.req.header('cookie') ?? '';
  const cookieMatch = cookieHeader.match(/(?:^|;\s*)admin_refresh_token=([^;]+)/);
  const cookieToken = cookieMatch?.[1];

  let bodyToken: string | undefined;
  if (!cookieToken) {
    try {
      const body = await c.req.json();
      bodyToken = (body as { refreshToken?: string }).refreshToken;
    } catch {
      // No body / not JSON — fine, logout still proceeds.
    }
  }

  const rawToken = cookieToken ?? bodyToken;
  if (rawToken) {
    const tokenHash = await hashRefreshToken(rawToken);
    await revokeRefreshTokenByHash(c.env.DB, tokenHash);
  }

  c.header('Set-Cookie', `${ACCESS_COOKIE_NAME}=; ${expiredCookieOpts()}`, { append: true });
  c.header('Set-Cookie', `${REFRESH_COOKIE_NAME}=; ${expiredCookieOpts('/api/auth')}`, { append: true });
  return c.json({ ok: true });
});

// ── Logout everywhere ────────────────────────────────────────────────────────

auth.post('/logout-all', requireAuth, async (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);
  await revokeAllRefreshTokensForIdentity(c.env.DB, payload.userType, payload.uid);

  c.header('Set-Cookie', `${ACCESS_COOKIE_NAME}=; ${expiredCookieOpts()}`, { append: true });
  c.header('Set-Cookie', `${REFRESH_COOKIE_NAME}=; ${expiredCookieOpts('/api/auth')}`, { append: true });
  return c.json({ ok: true });
});

// ── Who am I (admin cookie or applicant/mobile Bearer token) ────────────────

auth.get('/me', requireAuth, (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);
  return c.json({ email: payload.sub, role: payload.role });
});
