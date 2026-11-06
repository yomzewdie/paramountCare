-- ─────────────────────────────────────────────────────────────────────────────
-- New Applicants (pre-invite candidates) and document review
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Candidate details a recruiter keeps before inviting ─────────────────────
ALTER TABLE clinicians ADD COLUMN recruiter_notes TEXT;
-- NULL for a clinician no recruiter recorded as a candidate (e.g. backfilled).
ALTER TABLE clinicians ADD COLUMN interview_status TEXT
  CHECK (interview_status IS NULL OR interview_status IN ('pending', 'completed'));

-- The recruiter's copy of the clinician's resume: an ADMIN-owned private R2
-- object under candidates/<clinician id>/ — outside any applicant's uploads/
-- namespace and never in the applicant upload ledger, so no applicant route
-- can reach or delete it.
ALTER TABLE clinicians ADD COLUMN resume_object_key   TEXT;
ALTER TABLE clinicians ADD COLUMN resume_file_name    TEXT;
ALTER TABLE clinicians ADD COLUMN resume_file_size    INTEGER;
ALTER TABLE clinicians ADD COLUMN resume_content_type TEXT;
ALTER TABLE clinicians ADD COLUMN resume_uploaded_at  TEXT;

-- "Use existing resume for onboarding", chosen when the invitation is sent:
-- the candidate resume is copied into the applicant's own Resume requirement
-- (a real, ledger-backed upload) when their onboarding session is created.
ALTER TABLE onboarding_invites ADD COLUMN use_candidate_resume INTEGER NOT NULL DEFAULT 0;

-- ── Document review ──────────────────────────────────────────────────────────
-- One review per LOGICAL document requirement (e.g. the professional license,
-- however many attachments it holds; the I-9 identity requirement covers
-- List A or List B + C). No row means Pending.
CREATE TABLE IF NOT EXISTS document_reviews (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  clinician_id            INTEGER NOT NULL REFERENCES clinicians(id),
  requirement             TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'needs_correction')),
  -- The correction reason (required for needs_correction).
  note                    TEXT,
  reviewed_by             INTEGER REFERENCES admin_users(id),
  reviewed_at             TEXT,
  -- The applicant added, replaced or removed a file after the last review.
  changed_after_review    INTEGER NOT NULL DEFAULT 0,
  -- A correction was requested and has not been reviewed again yet: while
  -- set, the applicant may change this requirement's files, even after
  -- submission (and only this requirement).
  correction_open         INTEGER NOT NULL DEFAULT 0,
  correction_requested_at TEXT,
  -- When the correction email went out; NULL while suppressed (On Hold).
  correction_notified_at  TEXT,
  updated_at              TEXT NOT NULL,
  UNIQUE (clinician_id, requirement)
);

-- A submitted document replaced or removed during a targeted correction is
-- kept (submitted evidence is never deleted) but no longer current.
ALTER TABLE application_documents ADD COLUMN superseded_at TEXT;
