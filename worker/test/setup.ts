import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import { hashPassword } from '../src/services/auth';

// Credentials for the seeded admin user used by tests that need an
// authenticated session (see test/index.spec.ts `loginAsAdmin()`).
export const TEST_ADMIN_EMAIL = 'admin@example.com';
export const TEST_ADMIN_PASSWORD = 'Test-Passw0rd!';

// Populated in beforeAll below — used by invites.spec.ts / auth.spec.ts to
// seed onboarding_invites rows with a real, valid created_by admin id.
export let TEST_ADMIN_ID: number;

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
  const adminRow = await db
    .prepare(`INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, ?) RETURNING id`)
    .bind(TEST_ADMIN_EMAIL, passwordHash, 'admin')
    .first<{ id: number }>();
  TEST_ADMIN_ID = adminRow!.id;

  // ── M2: mobile-capable auth + onboarding sessions ─────────────────────────
  // Mirrors migrations/0003_mobile_auth_and_sessions.sql, plus
  // onboarding_sessions itself (0002_phase1.sql), which nothing in the test
  // bootstrap created before now since no route referenced it pre-M2.

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      email             TEXT UNIQUE NOT NULL,
      password_hash     TEXT NOT NULL,
      email_verified_at TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  ).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      token_hash      TEXT UNIQUE NOT NULL,
      user_type       TEXT NOT NULL,
      user_id         INTEGER NOT NULL,
      family_id       TEXT NOT NULL,
      device_label    TEXT,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at      TEXT NOT NULL,
      revoked_at      TEXT,
      replaced_by_id  INTEGER REFERENCES refresh_tokens(id),
      last_used_at    TEXT
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash)`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_type, user_id)`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id)`,
  ).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS onboarding_sessions (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id        TEXT UNIQUE NOT NULL,
      packet_id         TEXT NOT NULL,
      packet_version    INTEGER NOT NULL,
      first_name        TEXT,
      last_name         TEXT,
      email             TEXT,
      phone             TEXT,
      step_states_json  TEXT NOT NULL DEFAULT '{}',
      form_data_json    TEXT NOT NULL DEFAULT '{}',
      status            TEXT NOT NULL DEFAULT 'active',
      application_id    TEXT,
      user_id           INTEGER REFERENCES users(id),
      revision          INTEGER NOT NULL DEFAULT 1,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (application_id) REFERENCES applications(application_id)
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_sessions_session_id ON onboarding_sessions(session_id)`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON onboarding_sessions(user_id)`,
  ).run();
  // Mirrors migrations/0005_onboarding_session_uniqueness.sql (ADR-018 §2) —
  // at most one row per non-null user_id, enforced by the database itself.
  await db.prepare(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_user_id_unique ON onboarding_sessions(user_id) WHERE user_id IS NOT NULL`,
  ).run();

  // ── Invite-only registration + email verification ─────────────────────────
  // Mirrors migrations/0004_invites_and_email_verification.sql.

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS onboarding_invites (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      email        TEXT NOT NULL,
      token_hash   TEXT UNIQUE NOT NULL,
      expires_at   TEXT NOT NULL,
      used_at      TEXT,
      revoked_at   TEXT,
      claim_nonce  TEXT,
      created_by   INTEGER NOT NULL REFERENCES admin_users(id),
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_onboarding_invites_email ON onboarding_invites(email)`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_onboarding_invites_token_hash ON onboarding_invites(token_hash)`,
  ).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS email_verification_codes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
      code_hash     TEXT NOT NULL,
      expires_at    TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  // ── M13 hardening: uploaded-document ownership ledger ─────────────────────
  // Mirrors migrations/0006_uploaded_documents_ownership.sql.

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS uploaded_documents (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      object_key   TEXT UNIQUE NOT NULL,
      user_id      INTEGER NOT NULL REFERENCES users(id),
      session_id   TEXT REFERENCES onboarding_sessions(session_id),
      doc_type     TEXT,
      file_name    TEXT NOT NULL,
      file_size    INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      uploaded_at  TEXT NOT NULL,
      deleted_at   TEXT
    )
  `).run();

  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_uploaded_documents_user ON uploaded_documents(user_id)`,
  ).run();
  await db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_uploaded_documents_session_doctype ON uploaded_documents(session_id, doc_type)`,
  ).run();
});
