import type { UserType } from '../../utils/jwt';

export interface RefreshTokenRow {
  id: number;
  token_hash: string;
  user_type: UserType;
  user_id: number;
  family_id: string;
  device_label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  replaced_by_id: number | null;
  last_used_at: string | null;
}

export interface InsertRefreshTokenParams {
  tokenHash: string;
  userType: UserType;
  userId: number;
  familyId: string;
  expiresAt: string; // ISO timestamp
  deviceLabel?: string;
}

export async function insertRefreshToken(
  db: D1Database,
  p: InsertRefreshTokenParams,
): Promise<RefreshTokenRow> {
  const result = await db
    .prepare(
      `INSERT INTO refresh_tokens (token_hash, user_type, user_id, family_id, expires_at, device_label)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(p.tokenHash, p.userType, p.userId, p.familyId, p.expiresAt, p.deviceLabel ?? null)
    .first<RefreshTokenRow>();

  if (!result) throw new Error('insertRefreshToken: RETURNING clause produced no row');
  return result;
}

export async function findRefreshTokenByHash(
  db: D1Database,
  tokenHash: string,
): Promise<RefreshTokenRow | null> {
  return db
    .prepare('SELECT * FROM refresh_tokens WHERE token_hash = ? LIMIT 1')
    .bind(tokenHash)
    .first<RefreshTokenRow>();
}

/** Marks a token as rotated (superseded) — presenting it again is treated as replay. */
export async function markRefreshTokenRotated(
  db: D1Database,
  id: number,
  replacedById: number,
): Promise<void> {
  await db
    .prepare('UPDATE refresh_tokens SET replaced_by_id = ?, last_used_at = datetime(\'now\') WHERE id = ?')
    .bind(replacedById, id)
    .run();
}

export async function touchRefreshTokenLastUsed(db: D1Database, id: number): Promise<void> {
  await db
    .prepare('UPDATE refresh_tokens SET last_used_at = datetime(\'now\') WHERE id = ?')
    .bind(id)
    .run();
}

export async function revokeRefreshTokenById(db: D1Database, id: number): Promise<void> {
  await db
    .prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE id = ? AND revoked_at IS NULL')
    .bind(id)
    .run();
}

export async function revokeRefreshTokenByHash(db: D1Database, tokenHash: string): Promise<void> {
  await db
    .prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(tokenHash)
    .run();
}

/** Reuse-detection response: revoke every token descended from the same login. */
export async function revokeRefreshTokenFamily(db: D1Database, familyId: string): Promise<void> {
  await db
    .prepare('UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE family_id = ? AND revoked_at IS NULL')
    .bind(familyId)
    .run();
}

/** "Log out everywhere" — revokes every non-revoked session for an identity, across all families/devices. */
export async function revokeAllRefreshTokensForIdentity(
  db: D1Database,
  userType: UserType,
  userId: number,
): Promise<void> {
  await db
    .prepare(
      'UPDATE refresh_tokens SET revoked_at = datetime(\'now\') WHERE user_type = ? AND user_id = ? AND revoked_at IS NULL',
    )
    .bind(userType, userId)
    .run();
}
