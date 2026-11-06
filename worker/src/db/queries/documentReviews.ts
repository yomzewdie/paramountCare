// Admin review of each LOGICAL document requirement (migrations/0008). No row
// means Pending.

export const REVIEW_STATUSES = ['pending', 'accepted', 'needs_correction'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

export interface DocumentReviewRow {
  id: number;
  clinician_id: number;
  requirement: string;
  status: ReviewStatus;
  note: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  changed_after_review: number;
  correction_open: number;
  correction_requested_at: string | null;
  correction_notified_at: string | null;
  updated_at: string;
}

export async function findReviewsForClinician(db: D1Database, clinicianId: number): Promise<DocumentReviewRow[]> {
  return (await db.prepare('SELECT * FROM document_reviews WHERE clinician_id = ? ORDER BY id').bind(clinicianId).all<DocumentReviewRow>()).results;
}

export async function findAllReviews(db: D1Database): Promise<DocumentReviewRow[]> {
  return (await db.prepare('SELECT * FROM document_reviews').all<DocumentReviewRow>()).results;
}

export async function findReview(db: D1Database, clinicianId: number, requirement: string): Promise<DocumentReviewRow | null> {
  return db.prepare('SELECT * FROM document_reviews WHERE clinician_id = ? AND requirement = ?').bind(clinicianId, requirement).first<DocumentReviewRow>();
}

/** An admin decision, guarded on the state it was made against: it applies
 * only if the review is still exactly what the admin saw (`expectedUpdatedAt`,
 * NULL for "no review yet"), so a decision made against a since-changed
 * document is refused rather than silently overwriting it. */
export function upsertReviewDecisionStmt(
  db: D1Database,
  p: { clinicianId: number; requirement: string; status: ReviewStatus; note: string | null; adminId: number; now: string; expectedUpdatedAt: string | null },
): D1PreparedStatement {
  const correction = p.status === 'needs_correction';
  return db
    .prepare(
      `INSERT INTO document_reviews
         (clinician_id, requirement, status, note, reviewed_by, reviewed_at, changed_after_review, correction_open, correction_requested_at, correction_notified_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, ?
       WHERE ? IS NULL AND NOT EXISTS (SELECT 1 FROM document_reviews WHERE clinician_id = ? AND requirement = ?)
       ON CONFLICT(clinician_id, requirement) DO NOTHING`,
    )
    .bind(
      p.clinicianId, p.requirement, p.status, p.note, p.adminId, p.now, correction ? 1 : 0, correction ? p.now : null, p.now,
      p.expectedUpdatedAt, p.clinicianId, p.requirement,
    );
}

export function updateReviewDecisionStmt(
  db: D1Database,
  p: { clinicianId: number; requirement: string; status: ReviewStatus; note: string | null; adminId: number; now: string; expectedUpdatedAt: string | null },
): D1PreparedStatement {
  const correction = p.status === 'needs_correction';
  return db
    .prepare(
      `UPDATE document_reviews
       SET status = ?, note = ?, reviewed_by = ?, reviewed_at = ?, changed_after_review = 0,
           correction_open = ?, correction_requested_at = ?, correction_notified_at = NULL, updated_at = ?
       WHERE clinician_id = ? AND requirement = ? AND updated_at = ?`,
    )
    .bind(
      p.status, p.note, p.adminId, p.now, correction ? 1 : 0, correction ? p.now : null, p.now,
      p.clinicianId, p.requirement, p.expectedUpdatedAt,
    );
}

/** The applicant changed this requirement's files: an Accepted or Needs
 * Correction review goes back to Pending, marked as changed after review. A
 * requested correction stays open (so the applicant can keep adding files)
 * until an admin reviews it again. */
export function resetReviewAfterChangeStmt(db: D1Database, p: { clinicianId: number; requirement: string; now: string }): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE document_reviews
       SET status = 'pending', changed_after_review = 1, updated_at = ?
       WHERE clinician_id = ? AND requirement = ? AND status IN ('accepted', 'needs_correction')`,
    )
    .bind(p.now, p.clinicianId, p.requirement);
}

export function markCorrectionNotifiedStmt(db: D1Database, p: { reviewId: number; now: string }): D1PreparedStatement {
  return db
    .prepare(`UPDATE document_reviews SET correction_notified_at = ? WHERE id = ? AND status = 'needs_correction' AND correction_notified_at IS NULL`)
    .bind(p.now, p.reviewId);
}
