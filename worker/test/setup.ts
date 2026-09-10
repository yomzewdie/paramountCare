import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import { hashPassword } from '../src/services/auth';

// Credentials for the seeded admin user used by tests that need an
// authenticated session (see test/index.spec.ts `loginAsAdmin()`).
export const TEST_ADMIN_EMAIL = 'admin@example.com';
export const TEST_ADMIN_PASSWORD = 'Test-Passw0rd!';

// D1 exec() splits on newlines — multi-line DDL must use prepare().run() instead.
// In production, apply via: wrangler d1 migrations apply paramountcare-db-dev
beforeAll(async () => {
  const db = env.DB;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS applications (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT UNIQUE NOT NULL,
      first_name     TEXT NOT NULL,
      last_name      TEXT NOT NULL,
      email          TEXT NOT NULL,
      phone          TEXT NOT NULL,
      status         TEXT NOT NULL DEFAULT 'submitted',
      payload_json   TEXT,
      submitted_at   TEXT NOT NULL
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS application_documents (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL,
      object_key     TEXT NOT NULL,
      file_name      TEXT NOT NULL,
      file_size      INTEGER NOT NULL,
      uploaded_at    TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(application_id)
    )
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id TEXT NOT NULL,
      action         TEXT NOT NULL,
      metadata_json  TEXT,
      created_at     TEXT NOT NULL,
      FOREIGN KEY (application_id) REFERENCES applications(application_id)
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_app_docs_app_id ON application_documents(application_id)`,
  ).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_app_id ON audit_logs(application_id)`,
  ).run();

  // admin_users — added in migration 0002_phase1.sql; mirrored here so
  // /api/auth/* and /api/admin/* routes are testable (see admin.ts / auth.ts).
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'admin',
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email)`,
  ).run();

  const passwordHash = await hashPassword(TEST_ADMIN_PASSWORD);
  await db
    .prepare(`INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?)`)
    .bind(TEST_ADMIN_EMAIL, passwordHash, 'admin')
    .run();
});
