// Final-submission atomicity (M16) — see docs/ARCHITECTURE_DECISION_RECORDS.md
// ADR-029 for the full design rationale. This is the one place that builds
// the batch of conditional statements routes/sessions.ts's submit route
// executes together via a single db.batch() call.
//
// No new migration was needed: `onboarding_sessions.status`/`application_id`
// (migrations/0002_phase1.sql) already exist and were already designed for
// exactly this "active -> submitted" transition; `application_documents`
// already carries `session_id`/`doc_type` for exactly this promotion.
//
// THE CORE TECHNIQUE: every statement below is guarded by the *identical*
// `WHERE session_id = ? AND revision = ? AND user_id = ? AND status = 'active'`
// predicate (either directly, on the session UPDATE, or via a `WHERE EXISTS
// (SELECT 1 FROM onboarding_sessions WHERE ...)` subquery on each INSERT).
// D1 executes every statement in a batch sequentially within ONE
// transaction, so a later statement in the array already sees an earlier
// statement's writes — which is why the conditional INSERTs are ordered
// BEFORE the session UPDATE: all of them evaluate the guard against the
// same still-'active' pre-transition snapshot. If the session is not
// actually active at the expected revision, EVERY conditioned statement
// (inserts and the update alike) affects zero rows — the whole batch is a
// harmless no-op, atomically. If it is, all of them commit together. This
// gives single-request atomicity for "create the application row, promote
// this session's live uploads, write one audit event, and flip the session
// to submitted" without needing a new table, a new column, or reliance on
// any cross-statement `changes()`/`last_insert_rowid()` propagation this
// codebase has never otherwise depended on.
//
// What is deliberately NOT in this batch: the I-9 PDF (an R2 write) and the
// applicant/admin confirmation emails. Neither can participate in a D1
// transaction, so — mirroring the existing (already-shipped) web
// `/api/submit-onboarding` route's own established ordering exactly — they
// only run AFTER this batch has confirmed the session actually transitioned,
// and a failure in either is logged and treated as non-fatal: the
// application row itself is already durably, atomically committed.

export interface SubmissionGuard {
  sessionId: string;
  expectedRevision: number;
  ownerUserId: number;
}

function guardExistsClause(): string {
  return `EXISTS (
    SELECT 1 FROM onboarding_sessions
    WHERE session_id = ? AND revision = ? AND user_id = ? AND status = 'active'
  )`;
}

export interface InsertApplicationIfEligibleParams extends SubmissionGuard {
  applicationId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  payloadJson: string;
  submittedAt: string;
}

/** Statement 1 (of N): inserts the `applications` row — but only if this
 * request's session/revision/owner guard still holds. Affects 0 rows,
 * silently, if it does not (see module doc comment). */
export function insertApplicationIfEligibleStmt(
  db: D1Database,
  p: InsertApplicationIfEligibleParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO applications
         (application_id, first_name, last_name, email, phone, payload_json, submitted_at)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ${guardExistsClause()}`,
    )
    .bind(
      p.applicationId, p.firstName, p.lastName, p.email, p.phone, p.payloadJson, p.submittedAt,
      p.sessionId, p.expectedRevision, p.ownerUserId,
    );
}

export interface PromoteDocumentIfEligibleParams extends SubmissionGuard {
  applicationId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
  docType: string | null;
}

/**
 * Promotes one live `uploaded_documents` row into `application_documents` —
 * a metadata reference only (same R2 object_key, no file copy/move — see
 * ADR-029 §5 on why: the original object stays exactly where it is,
 * `uploaded_documents` remains its own durable ownership record
 * independent of submission). One of these statements is built per row
 * `findLiveUploadsForSession` returns for this session; the caller is
 * responsible for only ever calling this with rows that query already
 * proved are live and owned by this session's user — this function adds no
 * further ownership check of its own beyond the shared submission guard,
 * since the row itself was never client-supplied (see routes/sessions.ts).
 */
export function promoteDocumentIfEligibleStmt(
  db: D1Database,
  p: PromoteDocumentIfEligibleParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO application_documents
         (application_id, object_key, file_name, file_size, uploaded_at, session_id, doc_type)
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ${guardExistsClause()}`,
    )
    .bind(
      p.applicationId, p.objectKey, p.fileName, p.fileSize, p.uploadedAt, p.sessionId, p.docType,
      p.sessionId, p.expectedRevision, p.ownerUserId,
    );
}

export interface InsertAuditLogIfEligibleParams extends SubmissionGuard {
  applicationId: string;
  action: string;
  metadataJson?: string | null;
  createdAt: string;
}

export function insertAuditLogIfEligibleStmt(
  db: D1Database,
  p: InsertAuditLogIfEligibleParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (application_id, action, metadata_json, created_at)
       SELECT ?, ?, ?, ?
       WHERE ${guardExistsClause()}`,
    )
    .bind(
      p.applicationId, p.action, p.metadataJson ?? null, p.createdAt,
      p.sessionId, p.expectedRevision, p.ownerUserId,
    );
}

/** Statement N (last): the actual session transition. Uses the guard
 * directly in its own WHERE (not a subquery) — identical predicate, same
 * pre-transaction snapshot, since nothing earlier in the batch touches
 * `onboarding_sessions`. This is the statement whose `meta.changes` the
 * caller checks to know whether this request won the submission.
 *
 * Also writes `step_states_json` with the `review` step itself now marked
 * 'completed' — the one step whose completion this action, not a prior
 * PATCH, is responsible for. Without this, `isPacketComplete`/
 * `resolveNextRequiredStep` (which both require `review` too, being
 * `required: true` like any other step) would keep reporting the packet
 * as incomplete and "review" as the next step forever, even immediately
 * after a real, successful submission. */
export function submitSessionStmt(
  db: D1Database,
  p: SubmissionGuard & { applicationId: string; stepStatesJson: string },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE onboarding_sessions
       SET status = 'submitted', application_id = ?, step_states_json = ?, revision = revision + 1, updated_at = datetime('now')
       WHERE session_id = ? AND revision = ? AND user_id = ? AND status = 'active'`,
    )
    .bind(p.applicationId, p.stepStatesJson, p.sessionId, p.expectedRevision, p.ownerUserId);
}
