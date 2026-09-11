import { nowIso } from '../../utils/time';
import { generateOpaqueToken } from '../../services/opaqueTokens';
import type { UserRow } from './users';

export interface OnboardingInviteRow {
  id: number;
  email: string;
  token_hash: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  // Internal-only race-safety marker — see claimInviteAndCreateUser(). Never
  // returned by serializeInvite().
  claim_nonce: string | null;
  created_by: number;
  created_at: string;
  updated_at: string;
}

export async function insertOnboardingInvite(
  db: D1Database,
  p: { email: string; tokenHash: string; expiresAt: string; createdBy: number },
): Promise<OnboardingInviteRow> {
  const result = await db
    .prepare(
      `INSERT INTO onboarding_invites (email, token_hash, expires_at, created_by)
       VALUES (?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(p.email, p.tokenHash, p.expiresAt, p.createdBy)
    .first<OnboardingInviteRow>();
  if (!result) throw new Error('insertOnboardingInvite: RETURNING clause produced no row');
  return result;
}

export async function findOnboardingInviteById(db: D1Database, id: number): Promise<OnboardingInviteRow | null> {
  return db.prepare('SELECT * FROM onboarding_invites WHERE id = ? LIMIT 1').bind(id).first<OnboardingInviteRow>();
}

export async function findOnboardingInviteByTokenHash(
  db: D1Database,
  tokenHash: string,
): Promise<OnboardingInviteRow | null> {
  return db
    .prepare('SELECT * FROM onboarding_invites WHERE token_hash = ? LIMIT 1')
    .bind(tokenHash)
    .first<OnboardingInviteRow>();
}

/** The most recent outstanding (not used, not revoked, not expired) invite
 * for an email, if any. Compares against a JS-generated ISO timestamp rather
 * than SQL's datetime('now') — see utils/time.ts: expires_at is stored in
 * ISO format (from isoInSeconds()), and comparing it against SQLite's own,
 * differently-formatted datetime('now') can silently give the wrong answer,
 * not just fail to parse. */
export async function findOutstandingInviteForEmail(
  db: D1Database,
  email: string,
): Promise<OnboardingInviteRow | null> {
  return db
    .prepare(
      `SELECT * FROM onboarding_invites
       WHERE email = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(email, nowIso())
    .first<OnboardingInviteRow>();
}

export interface ListInvitesParams {
  page: number;
  pageSize: number;
  email?: string;
}

export async function listOnboardingInvites(
  db: D1Database,
  params: ListInvitesParams,
): Promise<{ invites: OnboardingInviteRow[]; total: number }> {
  const { page, pageSize, email } = params;
  const offset = (page - 1) * pageSize;
  // Exact match, not LIKE '%...%' — D1 enforces a hard cap on LIKE/GLOB
  // pattern length (well under a real email address's length), so a
  // substring search here would be unreliable in production for realistic
  // email addresses. Admins filter this list by a known applicant email.
  const where = email ? 'WHERE email = ?' : '';
  const bindings = email ? [email] : [];

  const data = await db
    .prepare(`SELECT * FROM onboarding_invites ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(...bindings, pageSize, offset)
    .all<OnboardingInviteRow>();
  const count = await db
    .prepare(`SELECT COUNT(*) AS total FROM onboarding_invites ${where}`)
    .bind(...bindings)
    .first<{ total: number }>();

  return { invites: data.results, total: count?.total ?? 0 };
}

export type ClaimInviteAndCreateUserResult =
  | { ok: true; user: UserRow }
  | { ok: false; reason: 'invite_not_claimable' }
  | { ok: false; reason: 'email_taken' };

/**
 * Atomically claims an invite AND creates its user account — either both
 * persist, or neither does. There is deliberately no separate "claim, then
 * insert" two-step here: a two-step version has a failure window where the
 * invite is marked used but the account was never created (e.g. a UNIQUE
 * constraint race on email), permanently burning the invite for nothing.
 *
 * How the atomicity is achieved with D1's real primitives (no BEGIN/COMMIT,
 * no writable CTEs — D1/SQLite doesn't support either from the Workers
 * binding): a single `db.batch([...])` call, which D1 documents as running
 * every statement inside one implicit transaction — if any statement in the
 * batch throws (e.g. a UNIQUE(email) constraint violation), the ENTIRE batch,
 * including the invite UPDATE, is rolled back.
 *
 * That handles "insert fails -> claim must not stick". The other direction —
 * "claim didn't happen -> insert must not happen either" — can't rely on a
 * thrown error, since an UPDATE whose WHERE clause matches zero rows is not
 * an error in SQLite, it's a silent no-op. So the INSERT is written as
 * `INSERT ... SELECT ... WHERE EXISTS (...)`, where the EXISTS subquery reads
 * the invite row back *after* the UPDATE has already applied within the same
 * transaction (statements in a D1 batch execute sequentially against one
 * connection, so the second statement sees the first's effect) and only
 * matches if `claim_nonce` now equals the fresh random value *this specific
 * call* just wrote.
 *
 * That nonce — not `used_at` — is what the EXISTS check compares against.
 * An earlier version of this function compared against the claim timestamp
 * instead, on the theory that only the winning call's own UPDATE could have
 * set it. That is wrong: two calls racing within the same millisecond can
 * compute an *identical* `nowIso()` string, so the losing call's EXISTS check
 * would also read true (because the shared timestamp happens to match its
 * own), letting it fall through to attempt an INSERT it should never reach —
 * confirmed empirically with a concurrent-registration test before this was
 * changed to a 256-bit random nonce (via the same generateOpaqueToken() used
 * for invite/refresh tokens), whose collision probability is negligible.
 */
export async function claimInviteAndCreateUser(
  db: D1Database,
  invite: OnboardingInviteRow,
  email: string,
  passwordHash: string,
): Promise<ClaimInviteAndCreateUserResult> {
  const claimedAt = nowIso();
  const nonce = generateOpaqueToken();

  const claimStmt = db
    .prepare(
      `UPDATE onboarding_invites
       SET used_at = ?, updated_at = ?, claim_nonce = ?
       WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    )
    .bind(claimedAt, claimedAt, nonce, invite.id, nowIso());

  const insertStmt = db
    .prepare(
      `INSERT INTO users (email, password_hash)
       SELECT ?, ?
       WHERE EXISTS (SELECT 1 FROM onboarding_invites WHERE id = ? AND claim_nonce = ?)
       RETURNING *`,
    )
    .bind(email, passwordHash, invite.id, nonce);

  let results;
  try {
    results = await db.batch<UserRow>([claimStmt, insertStmt]);
  } catch {
    // A statement in the batch threw (the only realistic cause here is the
    // INSERT hitting the UNIQUE(email) constraint) — D1 rolls the whole
    // batch back, so the invite claim above never actually persisted either.
    return { ok: false, reason: 'email_taken' };
  }

  const [claimResult, insertResult] = results;
  const claimed = (claimResult.meta.changes ?? 0) > 0;
  const user = insertResult.results[0];

  if (!claimed || !user) {
    // Belt-and-suspenders: these two must always agree (both true or both
    // false) given the EXISTS condition above, but if D1 ever surprises us,
    // treat any mismatch as "did not happen" rather than returning a user
    // without a consumed invite or vice versa.
    return { ok: false, reason: 'invite_not_claimable' };
  }

  return { ok: true, user };
}

export type RotateInviteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'already_used' | 'revoked' };

/** "Resend" — rotates the token/expiry on the SAME row rather than creating
 * a second one, so at most one raw token is ever valid for a given invite. */
export async function rotateOnboardingInvite(
  db: D1Database,
  id: number,
  p: { tokenHash: string; expiresAt: string },
): Promise<RotateInviteResult> {
  const existing = await findOnboardingInviteById(db, id);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.used_at) return { ok: false, reason: 'already_used' };
  if (existing.revoked_at) return { ok: false, reason: 'revoked' };

  await db
    .prepare(
      `UPDATE onboarding_invites SET token_hash = ?, expires_at = ?, updated_at = datetime('now') WHERE id = ?`,
    )
    .bind(p.tokenHash, p.expiresAt, id)
    .run();
  return { ok: true };
}

export type RevokeInviteResult = { ok: true } | { ok: false; reason: 'not_found' | 'already_used' };

export async function revokeOnboardingInvite(db: D1Database, id: number): Promise<RevokeInviteResult> {
  const existing = await findOnboardingInviteById(db, id);
  if (!existing) return { ok: false, reason: 'not_found' };
  if (existing.used_at) return { ok: false, reason: 'already_used' };

  await db
    .prepare(`UPDATE onboarding_invites SET revoked_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND revoked_at IS NULL`)
    .bind(id)
    .run();
  return { ok: true };
}
