export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function findUserByEmail(
  db: D1Database,
  email: string,
): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<UserRow>();
}

export async function findUserById(
  db: D1Database,
  id: number,
): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM users WHERE id = ? LIMIT 1')
    .bind(id)
    .first<UserRow>();
}

/** One-way: there is no code path that un-verifies an account once verified. */
export async function markUserEmailVerified(db: D1Database, id: number): Promise<void> {
  await db
    .prepare(`UPDATE users SET email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND email_verified_at IS NULL`)
    .bind(id)
    .run();
}
