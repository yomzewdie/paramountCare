import { nowIso } from '../../utils/time';

export interface EmailVerificationCodeRow {
  id: number;
  user_id: number;
  code_hash: string;
  expires_at: string;
  attempt_count: number;
  created_at: string;
}

/** Generating a new code always replaces any existing one for this user
 * (UNIQUE(user_id) + upsert) — this IS "the newest code invalidates older
 * codes": there is only ever one row, so the old code's hash simply no
 * longer exists once a new one is issued.
 *
 * created_at is passed in as a JS-generated ISO timestamp (nowIso()) rather
 * than left to SQL's datetime('now') — see utils/time.ts for why mixing the
 * two formats is an actual correctness bug, not just a style choice: it's
 * compared against Date.now() in the resend-cooldown check in routes/auth.ts. */
export async function upsertEmailVerificationCode(
  db: D1Database,
  p: { userId: number; codeHash: string; expiresAt: string },
): Promise<void> {
  const createdAt = nowIso();
  await db
    .prepare(
      `INSERT INTO email_verification_codes (user_id, code_hash, expires_at, attempt_count, created_at)
       VALUES (?, ?, ?, 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         code_hash = excluded.code_hash,
         expires_at = excluded.expires_at,
         attempt_count = 0,
         created_at = excluded.created_at`,
    )
    .bind(p.userId, p.codeHash, p.expiresAt, createdAt)
    .run();
}

export async function findEmailVerificationCodeForUser(
  db: D1Database,
  userId: number,
): Promise<EmailVerificationCodeRow | null> {
  return db
    .prepare('SELECT * FROM email_verification_codes WHERE user_id = ? LIMIT 1')
    .bind(userId)
    .first<EmailVerificationCodeRow>();
}

export async function incrementEmailVerificationAttempts(db: D1Database, userId: number): Promise<void> {
  await db
    .prepare('UPDATE email_verification_codes SET attempt_count = attempt_count + 1 WHERE user_id = ?')
    .bind(userId)
    .run();
}

/** One-time use: consumed (deleted) the moment verification succeeds. */
export async function deleteEmailVerificationCode(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM email_verification_codes WHERE user_id = ?').bind(userId).run();
}
