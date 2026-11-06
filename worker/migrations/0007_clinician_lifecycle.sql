-- ─────────────────────────────────────────────────────────────────────────────
-- Clinicians — the lifecycle root, plus recruiter workflow state
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per person Paramount is onboarding, from the moment a recruiter
-- records them (before any invitation) through invitation, registration,
-- onboarding, submission, internal verification and clearance. Everything an
-- applicant answers stays where it already lives (onboarding_sessions /
-- applications); this row holds only who the person is before they answer
-- anything, how they link to the rest, and the recruiter's own workflow state.
--
-- Links:  clinicians.user_id → users (set at registration; NULL before)
--         onboarding_invites.clinician_id → clinicians
--         users → onboarding_sessions (user_id) → applications (application_id)
-- A historical web submission (no account, no session) has no clinician row:
-- its identity can't be tied to an account reliably, so it is never forced.

CREATE TABLE IF NOT EXISTS clinicians (
  id                            INTEGER PRIMARY KEY AUTOINCREMENT,
  -- Lowercased and trimmed; one clinician per email.
  email                         TEXT NOT NULL UNIQUE,
  -- Recruiter-entered before the applicant answers anything themselves; the
  -- applicant's own answers (session / application) take precedence on read.
  first_name                    TEXT,
  last_name                     TEXT,
  phone                         TEXT,
  position                      TEXT,
  user_id                       INTEGER UNIQUE REFERENCES users(id),

  -- On Hold: active while on_hold_at is set. History lives in audit_logs.
  on_hold_at                    TEXT,
  on_hold_by                    INTEGER REFERENCES admin_users(id),
  on_hold_reason                TEXT,

  -- Internal verification — recruiter workflow only, never derived from the
  -- applicant's own completion.
  background_check_status       TEXT NOT NULL DEFAULT 'not_started'
    CHECK (background_check_status IN ('not_started', 'pending', 'complete', 'needs_review')),
  reference_verification_status TEXT NOT NULL DEFAULT 'not_started'
    CHECK (reference_verification_status IN ('not_started', 'pending', 'complete', 'needs_review')),
  i9_verification_status        TEXT NOT NULL DEFAULT 'not_started'
    CHECK (i9_verification_status IN ('not_started', 'pending', 'complete', 'needs_review')),
  w4_verification_status        TEXT NOT NULL DEFAULT 'not_started'
    CHECK (w4_verification_status IN ('not_started', 'pending', 'complete', 'needs_review')),

  -- Cleared: an explicit admin action, never inferred.
  cleared_at                    TEXT,
  cleared_by                    INTEGER REFERENCES admin_users(id),

  -- NULL for a clinician who registered before this table existed.
  created_by                    INTEGER REFERENCES admin_users(id),
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);

ALTER TABLE onboarding_invites ADD COLUMN clinician_id INTEGER REFERENCES clinicians(id);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_clinician_id ON onboarding_invites(clinician_id);

-- ── Backfill ─────────────────────────────────────────────────────────────────
-- Every existing applicant account becomes a clinician (names from their
-- session, created_by from whoever first invited them).
INSERT INTO clinicians (email, first_name, last_name, user_id, created_by, created_at, updated_at)
SELECT
  lower(trim(u.email)),
  s.first_name,
  s.last_name,
  u.id,
  (SELECT i.created_by FROM onboarding_invites i WHERE lower(trim(i.email)) = lower(trim(u.email)) ORDER BY i.created_at, i.id LIMIT 1),
  u.created_at,
  u.created_at
FROM users u
LEFT JOIN onboarding_sessions s ON s.user_id = u.id
WHERE NOT EXISTS (SELECT 1 FROM clinicians c WHERE c.email = lower(trim(u.email)));

-- Every invited email nobody has registered with yet, unless every invitation
-- to it was revoked (withdrawn).
INSERT INTO clinicians (email, created_by, created_at, updated_at)
SELECT
  lower(trim(i.email)),
  (SELECT i2.created_by FROM onboarding_invites i2 WHERE lower(trim(i2.email)) = lower(trim(i.email)) ORDER BY i2.created_at, i2.id LIMIT 1),
  MIN(i.created_at),
  MIN(i.created_at)
FROM onboarding_invites i
WHERE i.revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM clinicians c WHERE c.email = lower(trim(i.email)))
GROUP BY lower(trim(i.email));

UPDATE onboarding_invites
SET clinician_id = (SELECT c.id FROM clinicians c WHERE c.email = lower(trim(onboarding_invites.email)))
WHERE clinician_id IS NULL;

-- ── audit_logs: allow events before submission ───────────────────────────────
-- application_id was NOT NULL (0001), so nothing could be audited for a
-- clinician who hasn't submitted. SQLite cannot drop a NOT NULL constraint in
-- place, so the table is rebuilt: same columns, same ids (so every existing
-- row is preserved exactly, in order), application_id now nullable, plus
-- clinician_id. No table references audit_logs, so the rename is safe.
PRAGMA defer_foreign_keys = true;

CREATE TABLE audit_logs_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT REFERENCES applications(application_id),
  action         TEXT NOT NULL,
  metadata_json  TEXT,
  created_at     TEXT NOT NULL,
  session_id     TEXT REFERENCES onboarding_sessions(session_id),
  clinician_id   INTEGER REFERENCES clinicians(id)
);

INSERT INTO audit_logs_new (id, application_id, action, metadata_json, created_at, session_id)
SELECT id, application_id, action, metadata_json, created_at, session_id FROM audit_logs;

DROP TABLE audit_logs;
ALTER TABLE audit_logs_new RENAME TO audit_logs;

CREATE INDEX IF NOT EXISTS idx_audit_logs_app_id       ON audit_logs(application_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_clinician_id ON audit_logs(clinician_id);

-- Existing application events, linked to the clinician whose session submitted them.
UPDATE audit_logs
SET clinician_id = (
  SELECT c.id FROM clinicians c
  JOIN onboarding_sessions s ON s.user_id = c.user_id
  WHERE s.application_id = audit_logs.application_id
)
WHERE application_id IS NOT NULL;
