import {
  docTypesForRequirement,
  documentRequirementLabel,
  getPacket,
  hasStoredDocument,
  requirementForDocType,
  reviewableRequirements,
} from '@pcs/shared';
import type { ClinicianRecordRow } from '../db/queries/clinicianRecords';
import {
  findReview,
  findReviewsForClinician,
  markCorrectionNotifiedStmt,
  resetReviewAfterChangeStmt,
  updateReviewDecisionStmt,
  upsertReviewDecisionStmt,
  type DocumentReviewRow,
  type ReviewStatus,
} from '../db/queries/documentReviews';
import { insertClinicianAuditIfChangedStmt, insertClinicianAuditStmt } from '../db/queries/auditLogs';
import { sendDocumentCorrectionRequest } from './email';
import { isDocumentActiveForSubmission } from './vaccineProof';

// ── Document review ──────────────────────────────────────────────────────────
//
// An admin reviews each LOGICAL requirement once — the professional license
// with its front and back, the I-9 identity requirement (List A, or List B +
// C) — never attachment by attachment. Which requirements exist, and whether
// they hold files, comes from the shared definition and the applicant's
// session; the decision itself lives in document_reviews (no row = Pending).

export interface RequirementReviewState {
  requirement: string;
  label: string;
  required: boolean;
  docTypes: string[];
  hasFiles: boolean;
  status: ReviewStatus;
  note: string | null;
  reviewedAt: string | null;
  reviewedBy: number | null;
  /** The applicant added, replaced or removed a file since the last review. */
  changedAfterReview: boolean;
  /** A correction was requested and hasn't been reviewed again yet. */
  correctionOpen: boolean;
  /** Whether the correction email went out (false while suppressed by On Hold). */
  correctionNotified: boolean;
  /** The review's version, for a decision guarded on what the admin saw. */
  updatedAt: string | null;
}

export function requirementReviewStates(packetId: string, formData: Record<string, unknown>, reviews: readonly DocumentReviewRow[]): RequirementReviewState[] {
  const packet = getPacket(packetId);
  if (!packet) return [];
  const acknowledgements = formData.acknowledgements as Parameters<typeof isDocumentActiveForSubmission>[1];
  const stored = hasStoredDocument(formData);
  const has = (docType: string) => stored(docType) && isDocumentActiveForSubmission(docType, acknowledgements);
  return reviewableRequirements(packet, formData, has).map((group) => {
    const review = reviews.find((r) => r.requirement === group.key);
    return {
      requirement: group.key,
      label: documentRequirementLabel(group.key),
      required: group.required,
      docTypes: group.docTypes,
      hasFiles: group.docTypes.some(has),
      status: review?.status ?? 'pending',
      note: review?.note ?? null,
      reviewedAt: review?.reviewed_at ?? null,
      reviewedBy: review?.reviewed_by ?? null,
      changedAfterReview: !!review?.changed_after_review,
      correctionOpen: !!review?.correction_open,
      correctionNotified: !!review?.correction_notified_at,
      updatedAt: review?.updated_at ?? null,
    };
  });
}

export interface DocumentReviewSummary {
  pending: number;
  accepted: number;
  needsCorrection: number;
}

/** Counts over the requirements that hold files (or are awaiting a correction). */
export function summarizeReviewStates(states: readonly RequirementReviewState[]): DocumentReviewSummary {
  const counted = states.filter((s) => s.hasFiles || s.status === 'needs_correction');
  return {
    pending: counted.filter((s) => s.status === 'pending').length,
    accepted: counted.filter((s) => s.status === 'accepted').length,
    needsCorrection: counted.filter((s) => s.status === 'needs_correction').length,
  };
}

export const REVIEW_ACTIONS: Record<ReviewStatus, string> = {
  accepted: 'document_accepted',
  needs_correction: 'document_correction_requested',
  pending: 'document_review_reset',
};

export const MAX_CORRECTION_NOTE_LENGTH = 500;

export type ReviewDecisionResult =
  | { ok: true; review: DocumentReviewRow; notification: CorrectionNotification | null }
  | { ok: false; status: 404 | 409 | 422; error: string };

/**
 * Records an admin's decision on one requirement. Guarded on the review as the
 * admin saw it (`expectedUpdatedAt`; null when there was no review yet): if
 * the applicant changed the files, or another admin decided, in between, the
 * decision is refused rather than applied to documents the admin never saw.
 */
export async function decideDocumentReview(
  env: { DB: D1Database; RESEND_API_KEY?: string },
  p: {
    record: ClinicianRecordRow;
    states: readonly RequirementReviewState[];
    requirement: string;
    status: ReviewStatus;
    note: string | null;
    adminId: number;
    expectedUpdatedAt: string | null;
    applicationId: string | null;
    sessionId: string | null;
  },
): Promise<ReviewDecisionResult> {
  const state = p.states.find((s) => s.requirement === p.requirement);
  if (!state) return { ok: false, status: 404, error: 'This document is not part of this clinician\'s onboarding.' };
  if (p.status !== 'pending' && !state.hasFiles) return { ok: false, status: 409, error: 'There are no files to review for this document yet.' };
  const note = p.note?.trim() || null;
  if (p.status === 'needs_correction' && !note) return { ok: false, status: 422, error: 'A correction reason is required.' };
  if (note && note.length > MAX_CORRECTION_NOTE_LENGTH) return { ok: false, status: 422, error: `The correction reason must be at most ${MAX_CORRECTION_NOTE_LENGTH} characters.` };

  const now = new Date().toISOString();
  const decision = {
    clinicianId: p.record.id, requirement: p.requirement, status: p.status,
    note: p.status === 'needs_correction' ? note : null, adminId: p.adminId, now, expectedUpdatedAt: p.expectedUpdatedAt,
  };
  const audit = {
    clinicianId: p.record.id, applicationId: p.applicationId, sessionId: p.sessionId, action: REVIEW_ACTIONS[p.status], createdAt: now,
    metadata: { adminId: p.adminId, requirement: p.requirement, previousStatus: state.status, ...(decision.note ? { note: decision.note } : {}) },
  };
  // Insert (no review yet) or update (the review the admin saw), each with its
  // own audit entry immediately after it: at most one of the two applies.
  const results = await env.DB.batch([
    upsertReviewDecisionStmt(env.DB, decision),
    insertClinicianAuditIfChangedStmt(env.DB, audit),
    updateReviewDecisionStmt(env.DB, decision),
    insertClinicianAuditIfChangedStmt(env.DB, audit),
  ]);
  if ((results[0].meta.changes ?? 0) + (results[2].meta.changes ?? 0) === 0) {
    return { ok: false, status: 409, error: 'This document changed since you opened it. Refresh and review it again.' };
  }

  const review = (await findReview(env.DB, p.record.id, p.requirement))!;
  const notification = p.status === 'needs_correction' ? await notifyCorrection(env, p.record, review) : null;
  return { ok: true, review, notification };
}

export type CorrectionNotification = 'sent' | 'suppressed_on_hold' | 'failed' | 'not_configured';

/** Emails the applicant about a requested correction — unless they are On
 * Hold, when it is saved (and shown in the app) but not sent; resuming
 * onboarding sends it then. */
export async function notifyCorrection(
  env: { DB: D1Database; RESEND_API_KEY?: string },
  record: ClinicianRecordRow,
  review: DocumentReviewRow,
): Promise<CorrectionNotification> {
  if (record.on_hold_at) return 'suppressed_on_hold';
  if (!env.RESEND_API_KEY) return 'not_configured';
  // The name a recruiter entered, else the one the applicant gave themselves.
  let firstName = record.first_name;
  if (!firstName && record.user_id !== null) {
    const session = await env.DB.prepare('SELECT first_name FROM onboarding_sessions WHERE user_id = ?').bind(record.user_id).first<{ first_name: string | null }>();
    firstName = session?.first_name ?? null;
  }
  try {
    await sendDocumentCorrectionRequest(env.RESEND_API_KEY, {
      to: record.email,
      firstName,
      documentName: documentRequirementLabel(review.requirement),
      reason: review.note ?? '',
    });
  } catch (e) {
    console.error('[document-reviews] correction email failed:', e);
    return 'failed';
  }
  await markCorrectionNotifiedStmt(env.DB, { reviewId: review.id, now: new Date().toISOString() }).run();
  return 'sent';
}

/** Sends every still-open correction whose email was held back. */
export async function sendHeldCorrectionNotices(env: { DB: D1Database; RESEND_API_KEY?: string }, record: ClinicianRecordRow): Promise<number> {
  const held = (await findReviewsForClinician(env.DB, record.id))
    .filter((r) => r.status === 'needs_correction' && r.correction_open && !r.correction_notified_at);
  let sent = 0;
  for (const review of held) {
    if ((await notifyCorrection(env, record, review)) === 'sent') sent += 1;
  }
  return sent;
}

/**
 * The applicant changed a requirement's files (added, replaced or removed).
 * An Accepted review goes back to Pending, marked as changed after review; a
 * Needs Correction review goes to Pending as a correction upload. Both are
 * audited; the previous decision stays in the audit history.
 */
export async function recordApplicantDocumentChange(
  db: D1Database,
  p: { clinicianId: number; docType: string; applicationId: string | null; sessionId: string },
): Promise<void> {
  const requirement = requirementForDocType(p.docType);
  const now = new Date().toISOString();
  const base = { clinicianId: p.clinicianId, applicationId: p.applicationId, sessionId: p.sessionId, createdAt: now };
  const accepted = db
    .prepare(
      `UPDATE document_reviews SET status = 'pending', changed_after_review = 1, updated_at = ?
       WHERE clinician_id = ? AND requirement = ? AND status = 'accepted'`,
    )
    .bind(now, p.clinicianId, requirement);
  await db.batch([
    accepted,
    insertClinicianAuditIfChangedStmt(db, { ...base, action: 'document_review_reset', metadata: { requirement, previousStatus: 'accepted', reason: 'applicant_changed_files', docType: p.docType } }),
    resetReviewAfterChangeStmt(db, { clinicianId: p.clinicianId, requirement, now }),
    insertClinicianAuditIfChangedStmt(db, { ...base, action: 'document_correction_uploaded', metadata: { requirement, previousStatus: 'needs_correction', docType: p.docType } }),
  ]);
}

/** A correction the applicant can see and act on. */
export interface OpenCorrection {
  requirement: string;
  label: string;
  docTypes: string[];
  /** needs_correction until they change the files; pending once sent back for review. */
  status: ReviewStatus;
  note: string | null;
  requestedAt: string | null;
}

export async function openCorrections(db: D1Database, clinicianId: number): Promise<OpenCorrection[]> {
  return (await findReviewsForClinician(db, clinicianId))
    .filter((r) => r.correction_open)
    .map((r) => ({
      requirement: r.requirement,
      label: documentRequirementLabel(r.requirement),
      docTypes: docTypesForRequirement(r.requirement),
      status: r.status,
      note: r.note,
      requestedAt: r.correction_requested_at,
    }));
}

/** Whether a requested correction currently reopens this document type. */
export async function hasOpenCorrection(db: D1Database, clinicianId: number, docType: string): Promise<boolean> {
  const review = await findReview(db, clinicianId, requirementForDocType(docType));
  return !!review?.correction_open;
}

export type ResendResult = { ok: true } | { ok: false; status: 409 | 502 | 503; error: string };

/**
 * An admin re-sends the correction email for one requirement — typically after
 * it failed to send. Only for a correction still open (never a stale one),
 * never while On Hold (resuming sends it), with the current document and reason.
 */
export async function resendCorrectionNotice(
  env: { DB: D1Database; RESEND_API_KEY?: string },
  p: { record: ClinicianRecordRow; requirement: string; adminId: number; applicationId: string | null; sessionId: string | null },
): Promise<ResendResult> {
  const review = await findReview(env.DB, p.record.id, p.requirement);
  if (!review || review.status !== 'needs_correction' || !review.correction_open) {
    return { ok: false, status: 409, error: 'There is no open correction for this document to notify about.' };
  }
  if (p.record.on_hold_at) {
    return { ok: false, status: 409, error: 'Notifications are paused while this clinician is On Hold. It is sent when onboarding resumes.' };
  }
  const outcome = await notifyCorrection(env, p.record, review);
  if (outcome === 'not_configured') return { ok: false, status: 503, error: 'Email is not configured.' };
  if (outcome !== 'sent') return { ok: false, status: 502, error: 'The notification could not be sent. The correction is saved — try again later.' };
  await insertClinicianAuditStmt(env.DB, {
    clinicianId: p.record.id, applicationId: p.applicationId, sessionId: p.sessionId, action: 'document_correction_notification_resent', createdAt: new Date().toISOString(),
    metadata: { adminId: p.adminId, requirement: p.requirement },
  }).run();
  return { ok: true };
}
