export interface AdminUserRow {
  id: number;
  email: string;
  password_hash: string;
  role: string;
  created_at: string;
  updated_at: string;
}

export async function findAdminUserByEmail(
  db: D1Database,
  email: string,
): Promise<AdminUserRow | null> {
  return db
    .prepare('SELECT * FROM admin_users WHERE email = ? LIMIT 1')
    .bind(email)
    .first<AdminUserRow>();
}

export async function insertAdminUser(
  db: D1Database,
  email: string,
  passwordHash: string,
  role: 'super_admin' | 'admin' = 'admin',
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO admin_users (email, password_hash, role)
       VALUES (?, ?, ?)`,
    )
    .bind(email, passwordHash, role)
    .run();
}
