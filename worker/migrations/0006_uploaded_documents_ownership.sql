-- ─────────────────────────────────────────────────────────────────────────────
-- Uploaded-document ownership ledger — M13 hardening
-- ─────────────────────────────────────────────────────────────────────────────
-- Before this migration, `/api/uploads` wrote bytes to R2 and returned an
-- `objectKey` to the client, but nothing on the server durably recorded WHO
-- uploaded a given object. Associating that objectKey with a session (e.g.
-- Direct Deposit's voided check) trusted the client-supplied string itself,
-- checked only against its own `uploads/<uid>/...` path prefix — correct as
-- far as it goes, but "object-key secrecy is never treated as authorization"
-- (M13 hardening prompt) demands a durable, server-created record of the
-- actual upload event to check association requests against, not just a
-- string-shape check on the key the client happens to send.
--
-- `application_documents` (migrations/0001, extended in 0002 with a nullable
-- session_id/doc_type) was considered and rejected as the place to record
-- this: it requires a NOT NULL application_id, which does not exist until
-- final legacy-web submission — its `session_id`/`doc_type` columns are
-- schema-only today (added "in anticipation," never populated by any
-- current code; confirmed by reading every call site of insertDocumentStmt).
-- It is a post-submission archive table, not a fit for tracking an
-- in-progress mobile onboarding session's own uploads.
--
-- This table is the new, minimal, purpose-built ownership ledger: one row
-- per uploaded R2 object, created at upload time (before any session
-- association exists), scoped by the authenticated uploader's own user_id.
CREATE TABLE IF NOT EXISTS uploaded_documents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  object_key   TEXT UNIQUE NOT NULL,
  -- Always the uploader's own verified uid at upload time — never
  -- client-supplied. See worker/src/routes/uploads.ts.
  user_id      INTEGER NOT NULL REFERENCES users(id),
  -- NULL until the object is associated with a specific session/slot via
  -- POST /api/sessions/:sessionId/documents/:docType. An unassociated row is
  -- exactly the "orphan" case M13's failed-association cleanup targets.
  session_id   TEXT REFERENCES onboarding_sessions(session_id),
  doc_type     TEXT,
  file_name    TEXT NOT NULL,
  file_size    INTEGER NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_at  TEXT NOT NULL,
  -- Soft-delete: set the moment the R2 object itself is deleted (explicit
  -- Remove, a Replace's old-object cleanup, or orphan cleanup after a failed
  -- association). A row with deleted_at set can never be associated to a
  -- session again — this is what makes "already-deleted object handled
  -- safely" a query condition, not a race.
  deleted_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_uploaded_documents_user            ON uploaded_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_documents_session_doctype ON uploaded_documents(session_id, doc_type);
