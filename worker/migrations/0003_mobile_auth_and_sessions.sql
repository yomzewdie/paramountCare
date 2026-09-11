-- ─────────────────────────────────────────────────────────────────────────────
-- M2: mobile-capable authentication + authoritative onboarding sessions
-- ─────────────────────────────────────────────────────────────────────────────
-- Purely additive: no existing table is dropped, recreated, or has a column
-- removed or narrowed. Safe to run against a database that already has real
-- applications / admin_users / onboarding_sessions data — every ALTER TABLE
-- below adds a nullable column or a NOT NULL column with a valid default, so
-- every existing row gets a well-defined value with no backfill step needed.
--
-- This file has never been deployed (M2 has not been committed/pushed), so it
-- was safe to edit in place rather than layering a follow-up ALTER TABLE for
-- users.email_verified_at — see docs/ARCHITECTURE_DECISION_RECORDS.md ADR-008
-- and ADR-011, and the invite-only-registration product-decision addendum,
-- for the design this migration implements.

-- ── Applicant accounts ──────────────────────────────────────────────────────
-- Deliberately a separate table from admin_users, not a shared "users" table
-- with a role column: different population (external job applicants vs.
-- internal staff), different app surface, different risk profile. Keeping
-- them separate means admin_users, its queries, and admin login behavior are
-- completely untouched by this migration.
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT UNIQUE NOT NULL,
  -- Same PBKDF2-SHA256 format as admin_users.password_hash (worker/src/services/auth.ts).
  password_hash     TEXT NOT NULL,
  -- NULL until the applicant completes email verification (see
  -- migrations/0004_invites_and_email_verification.sql). An applicant with
  -- email_verified_at IS NULL cannot log in — see routes/auth.ts.
  email_verified_at TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ── Refresh tokens (admin + applicant) ──────────────────────────────────────
-- Server-side record of every issued refresh token, for BOTH admin and
-- applicant sessions. The raw token is never stored anywhere — only a
-- SHA-256 hash of it (see worker/src/services/refreshTokens.ts). user_type +
-- user_id together identify the owning account (admin_users.id or users.id
-- respectively); SQLite cannot express a polymorphic foreign key across two
-- tables, so this pairing is validated at the application layer instead of a
-- FK constraint.
--
-- Rotation/reuse-detection model: presenting a refresh token issues a new one
-- in the same family_id and sets replaced_by_id on the old row. If a row with
-- replaced_by_id already set is presented again, that is theft/replay — the
-- entire family is revoked (see rotateRefreshToken in
-- worker/src/services/refreshTokens.ts / worker/src/db/queries/refreshTokens.ts).
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash      TEXT UNIQUE NOT NULL,
  user_type       TEXT NOT NULL,             -- 'admin' | 'applicant'
  user_id         INTEGER NOT NULL,
  family_id       TEXT NOT NULL,
  device_label    TEXT,                      -- optional, client-supplied at login
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  replaced_by_id  INTEGER REFERENCES refresh_tokens(id),
  last_used_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user       ON refresh_tokens(user_type, user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family     ON refresh_tokens(family_id);

-- ── onboarding_sessions: owning identity + optimistic concurrency ──────────
--
-- Product decision (post-M2 correction): every onboarding session is created
-- by, and belongs to, exactly one authenticated applicant from the moment it
-- is created — there is no anonymous session and no claim transition. The
-- application (routes/sessions.ts) always sets user_id at INSERT time from
-- the verified access token and never accepts it from client input.
--
-- The column itself remains NULLABLE at the database level, not because new
-- sessions are allowed to be ownerless, but because onboarding_sessions is
-- an EXISTING table (created in migrations/0002_phase1.sql, already part of
-- the committed baseline on main) that may already contain real rows from
-- before applicant accounts existed. SQLite requires a non-NULL DEFAULT to
-- add a NOT NULL column via ALTER TABLE, and there is no meaningful,
-- non-fabricated user_id to backfill those historical rows with — inventing
-- a sentinel value would be worse than an application-enforced invariant.
-- Ownership is therefore guaranteed by the application (every INSERT always
-- supplies a real user_id, every read/write is scoped by
-- "WHERE ... AND user_id = ?" against the verified token) rather than by a
-- database-level NOT NULL constraint. This is a deliberate, documented
-- trade-off, not an oversight.
ALTER TABLE onboarding_sessions ADD COLUMN user_id  INTEGER REFERENCES users(id);

-- Optimistic-concurrency counter. Existing rows default to 1, a valid
-- starting revision identical to what a freshly-created row gets going
-- forward — no ambiguity or special-casing needed for pre-existing sessions.
ALTER TABLE onboarding_sessions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON onboarding_sessions(user_id);
