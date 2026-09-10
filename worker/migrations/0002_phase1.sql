-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1: Admin users, packet-driven sessions, exam submissions
-- ─────────────────────────────────────────────────────────────────────────────

-- Admin portal users (recruiters, HR, managers, super admins).
-- Applicants are identified by email only — they have no login account.
CREATE TABLE IF NOT EXISTS admin_users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT UNIQUE NOT NULL,
  -- PBKDF2-SHA256 encoded as "pbkdf2:iter:salt:hash" (all hex/base64)
  password_hash TEXT NOT NULL,
  -- 'super_admin' | 'admin'
  role         TEXT NOT NULL DEFAULT 'admin',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);

-- Packet-driven onboarding sessions.
-- One row per applicant attempt; an applicant may have multiple sessions
-- (e.g., after abandoning and restarting).
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id      TEXT UNIQUE NOT NULL,   -- nanoid / uuid, used in URLs

  -- Packet config that was active when the session was created.
  -- Sessions pin to the version they started on so step changes don't corrupt
  -- in-progress work.
  packet_id       TEXT NOT NULL,
  packet_version  INTEGER NOT NULL,

  -- Applicant identity — collected during the personal_info step.
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT,
  phone           TEXT,

  -- Serialized step states map: { [stepId]: StepStatus }
  step_states_json TEXT NOT NULL DEFAULT '{}',

  -- Serialized form field data (everything except docs/exams/audit).
  -- SSN stored as '[redacted]'; i9 signature stored as '[stored in R2]'.
  form_data_json   TEXT NOT NULL DEFAULT '{}',

  -- Overall session lifecycle.
  -- 'active' | 'submitted' | 'abandoned'
  status          TEXT NOT NULL DEFAULT 'active',

  -- Populated when status transitions to 'submitted'.
  application_id  TEXT,

  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (application_id) REFERENCES applications(application_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_session_id    ON onboarding_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_email         ON onboarding_sessions(email);
CREATE INDEX IF NOT EXISTS idx_sessions_application_id ON onboarding_sessions(application_id);

-- Link uploaded documents to a session (before submission) or application (after).
-- Replaces the ad-hoc pattern in application_documents.
ALTER TABLE application_documents
  ADD COLUMN session_id  TEXT REFERENCES onboarding_sessions(session_id);
ALTER TABLE application_documents
  ADD COLUMN doc_type    TEXT;  -- 'nursing_license' | 'cpr_cert' | 'list_a' | 'list_b' | 'list_c'

CREATE INDEX IF NOT EXISTS idx_app_docs_session_id ON application_documents(session_id);

-- Exam attempt history.
CREATE TABLE IF NOT EXISTS exam_submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  -- step id from the packet (e.g. 'safety_exam')
  step_id        TEXT NOT NULL,
  exam_type      TEXT NOT NULL,
  -- serialized { questionId: answerId } map
  answers_json   TEXT NOT NULL DEFAULT '{}',
  score          INTEGER NOT NULL,   -- 0–100
  passed         INTEGER NOT NULL,   -- 0 | 1  (SQLite boolean)
  attempt_number INTEGER NOT NULL,
  submitted_at   TEXT NOT NULL DEFAULT (datetime('now')),

  FOREIGN KEY (session_id) REFERENCES onboarding_sessions(session_id)
);

CREATE INDEX IF NOT EXISTS idx_exam_submissions_session_id ON exam_submissions(session_id);

-- Extend audit_logs to support session-level events (pre-submission).
ALTER TABLE audit_logs
  ADD COLUMN session_id TEXT REFERENCES onboarding_sessions(session_id);

-- application_id can now be NULL for session-only events.
-- SQLite cannot ALTER COLUMN constraints, so this is handled at the app layer.
