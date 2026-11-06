import { documentAttachmentsFor } from '@pcs/shared';
import {
  VERIFICATION_COLUMNS,
  VERIFICATION_KINDS,
  findClinicianRecord,
  type ClinicianRecordRow,
  type VerificationKind,
  type VerificationStatus,
} from '../db/queries/clinicianRecords';
import {
  findInvitesForClinician,
  findSessionIdForUser,
  loadClinicianSession,
  type ClinicianApplicationRow,
  type ClinicianInviteRow,
  type ClinicianSessionRow,
  type SessionUploadRow,
} from '../db/queries/clinicians';
import { findDocumentsByApplicationId, type DocumentRow } from '../db/queries/documents';
import { findReviewsForClinician, type DocumentReviewRow } from '../db/queries/documentReviews';
import { findAuditLogsForClinician, insertClinicianAuditIfChangedStmt, type AuditLogRow } from '../db/queries/auditLogs';
import { latestInviteByEmail, notStartedClinician, parseObject, sessionClinician, visibleSessionUploads, type ClinicianListItem } from './clinicians';
import { requirementReviewStates, sendHeldCorrectionNotices, type RequirementReviewState } from './documentReviews';
import { inviteStatus } from '../db/queries/onboardingInvites';
import { toIsoTimestamp } from '../utils/time';
import { publicAuditMetadata } from './auditDisplay';

// ── One clinician's recruiter workflow ───────────────────────────────────────
//
// Everything an admin decides about a clinician — On Hold, the four internal
// verifications, document review and clearance — keyed by the clinician
// record, so it works at every stage: before an invitation, during
// onboarding, and after submission. Every change is a guarded UPDATE with its
// audit entry in the same batch (insertClinicianAuditIfChangedStmt), so two
// racing requests produce one change and one entry.

export interface ClinicianContext {
  record: ClinicianRecordRow;
  session: ClinicianSessionRow | null;
  application: ClinicianApplicationRow | null;
  invites: ClinicianInviteRow[];
  /** The applicant's current uploads (before submission). */
  uploads: SessionUploadRow[];
  /** The submitted application's documents, current and superseded. */
  applicationDocuments: DocumentRow[];
  reviews: DocumentReviewRow[];
}

export async function loadClinicianContext(db: D1Database, recordId: number): Promise<ClinicianContext | null> {
  const record = await findClinicianRecord(db, recordId);
  if (!record) return null;
  const sessionId = record.user_id !== null ? await findSessionIdForUser(db, record.user_id) : null;
  const [loaded, invites, reviews] = await Promise.all([
    sessionId ? loadClinicianSession(db, sessionId) : Promise.resolve(null),
    findInvitesForClinician(db, record),
    findReviewsForClinician(db, record.id),
  ]);
  const application = loaded?.application ?? null;
  return {
    record,
    session: loaded?.session ?? null,
    application,
    invites,
    uploads: loaded?.uploads ?? [],
    applicationDocuments: application ? await findDocumentsByApplicationId(db, application.application_id) : [],
    reviews,
  };
}

export function clinicianListItem(ctx: ClinicianContext): ClinicianListItem {
  const invite = ctx.invites.find((i) => i.clinician_id === ctx.record.id) ?? latestInviteByEmail(ctx.invites).values().next().value;
  if (ctx.session) return sessionClinician(ctx.session, ctx.application, invite, ctx.record, ctx.reviews);
  return notStartedClinician(`clinician:${ctx.record.id}`, ctx.record.email, invite, ctx.record);
}

// ── Document review with files ───────────────────────────────────────────────

export interface ReviewFile {
  id: number;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

export interface RequirementReview extends RequirementReviewState {
  /** The requirement's current files, by the id their source serves them by. */
  files: ReviewFile[];
}

/** Where the files listed in a review come from: the submitted application's
 * documents (by document id) or, before submission, the session's uploads
 * (by upload id). */
export type ReviewFileSource = 'application' | 'session' | null;

export function documentReviews(ctx: ClinicianContext): { source: ReviewFileSource; requirements: RequirementReview[] } {
  if (!ctx.session) return { source: null, requirements: [] };
  const formData = parseObject(ctx.session.form_data_json);
  const states = requirementReviewStates(ctx.session.packet_id, formData, ctx.reviews);
  const toFile = (f: { id: number; file_name: string; file_size: number; uploaded_at: string }): ReviewFile => ({
    id: f.id, fileName: f.file_name, fileSize: f.file_size, uploadedAt: toIsoTimestamp(f.uploaded_at) ?? f.uploaded_at,
  });

  if (ctx.application) {
    const order = (doc: DocumentRow) => documentAttachmentsFor(formData, doc.doc_type ?? '').findIndex((f) => f.objectKey === doc.object_key);
    const current = ctx.applicationDocuments.filter((d) => !d.superseded_at && d.doc_type);
    return {
      source: 'application',
      requirements: states.map((s) => ({
        ...s,
        files: current.filter((d) => s.docTypes.includes(d.doc_type!)).sort((a, b) => order(a) - order(b) || a.id - b.id).map(toFile),
      })),
    };
  }
  const uploads = visibleSessionUploads(ctx.session, ctx.uploads);
  return {
    source: 'session',
    requirements: states.map((s) => ({ ...s, files: uploads.filter((u) => s.docTypes.includes(u.doc_type)).map(toFile) })),
  };
}

// ── Clearance ────────────────────────────────────────────────────────────────

export interface ClearanceItem {
  key: string;
  label: string;
  met: boolean;
  /** What is still outstanding, for the documents item. */
  detail?: string[];
}

const VERIFICATION_LABELS: Record<VerificationKind, string> = {
  background_check: 'Background Check',
  reference_verification: 'Reference Verification',
  i9_verification: 'I-9 Verification',
  w4_verification: 'W-4 Verification',
};

/** Whether a document stands in the way of clearance: a required one until
 * it is Accepted; an optional one only while a correction requested on it is
 * open (until it is Accepted, or removed). An optional document never
 * uploaded never blocks. */
export function blocksClearance(r: Pick<RequirementReview, 'required' | 'status' | 'hasFiles' | 'correctionOpen'>): boolean {
  if (r.required) return !(r.status === 'accepted' && r.hasFiles);
  return r.hasFiles && (r.status === 'needs_correction' || r.correctionOpen);
}

/** What normal clearance requires, each item with what is still outstanding. */
export function clearanceChecklist(ctx: ClinicianContext): ClearanceItem[] {
  const { requirements } = documentReviews(ctx);
  const outstanding = requirements.filter(blocksClearance).map((r) => (r.required ? r.label : `${r.label} (correction requested)`));
  return [
    { key: 'submitted', label: 'Onboarding application submitted', met: !!ctx.application },
    { key: 'not_on_hold', label: 'Not on hold', met: !ctx.record.on_hold_at },
    ...VERIFICATION_KINDS.map((kind) => ({ key: kind, label: `${VERIFICATION_LABELS[kind]} complete`, met: ctx.record[VERIFICATION_COLUMNS[kind]] === 'complete' })),
    {
      key: 'documents',
      label: 'Required documents accepted, and requested corrections resolved',
      met: !!ctx.application && outstanding.length === 0,
      detail: outstanding,
    },
  ];
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type WorkflowResult = { ok: true } | { ok: false; status: 403 | 409 | 422; error: string; incomplete?: ClearanceItem[] };

const auditBase = (ctx: ClinicianContext, now: string) => ({
  clinicianId: ctx.record.id,
  applicationId: ctx.application?.application_id ?? null,
  sessionId: ctx.session?.session_id ?? null,
  createdAt: now,
});

async function guarded(db: D1Database, update: D1PreparedStatement, audit: Parameters<typeof insertClinicianAuditIfChangedStmt>[1]): Promise<boolean> {
  const [result] = await db.batch([update, insertClinicianAuditIfChangedStmt(db, audit)]);
  return (result.meta.changes ?? 0) > 0;
}

export const MAX_REASON_LENGTH = 500;
const reasonOrNull = (reason: unknown) => (typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, MAX_REASON_LENGTH) : null);

/** On Hold pauses recruiter-triggered reminders and correction emails. It
 * never erases progress or stops the applicant using the app. */
export async function placeOnHold(db: D1Database, ctx: ClinicianContext, adminId: number, reason: unknown): Promise<WorkflowResult> {
  const now = new Date().toISOString();
  const note = reasonOrNull(reason);
  const changed = await guarded(
    db,
    db.prepare('UPDATE clinicians SET on_hold_at = ?, on_hold_by = ?, on_hold_reason = ?, updated_at = ? WHERE id = ? AND on_hold_at IS NULL')
      .bind(now, adminId, note, now, ctx.record.id),
    { ...auditBase(ctx, now), action: 'placed_on_hold', metadata: { adminId, ...(note ? { reason: note } : {}) } },
  );
  return changed ? { ok: true } : { ok: false, status: 409, error: 'This clinician is already on hold.' };
}

/** Ends the hold (history stays in the audit log) and sends any correction
 * email that was held back while it was active. */
export async function resumeFromHold(env: { DB: D1Database; RESEND_API_KEY?: string }, ctx: ClinicianContext, adminId: number): Promise<WorkflowResult & { correctionNoticesSent?: number }> {
  const now = new Date().toISOString();
  const changed = await guarded(
    env.DB,
    env.DB.prepare('UPDATE clinicians SET on_hold_at = NULL, on_hold_by = NULL, on_hold_reason = NULL, updated_at = ? WHERE id = ? AND on_hold_at IS NOT NULL')
      .bind(now, ctx.record.id),
    {
      ...auditBase(ctx, now), action: 'resumed_from_hold',
      metadata: { adminId, heldSince: ctx.record.on_hold_at, heldBy: ctx.record.on_hold_by, ...(ctx.record.on_hold_reason ? { reason: ctx.record.on_hold_reason } : {}) },
    },
  );
  if (!changed) return { ok: false, status: 409, error: 'This clinician is not on hold.' };
  const resumed = (await findClinicianRecord(env.DB, ctx.record.id))!;
  return { ok: true, correctionNoticesSent: await sendHeldCorrectionNotices(env, resumed) };
}

export async function setVerificationStatus(db: D1Database, ctx: ClinicianContext, adminId: number, kind: VerificationKind, status: VerificationStatus): Promise<WorkflowResult> {
  const column = VERIFICATION_COLUMNS[kind];
  const from = ctx.record[column];
  if (from === status) return { ok: true };
  const now = new Date().toISOString();
  const changed = await guarded(
    db,
    db.prepare(`UPDATE clinicians SET ${column} = ?, updated_at = ? WHERE id = ? AND ${column} = ?`).bind(status, now, ctx.record.id, from),
    { ...auditBase(ctx, now), action: `${kind}_status_changed`, metadata: { adminId, from, to: status } },
  );
  return changed ? { ok: true } : { ok: false, status: 409, error: 'This status was changed by someone else. Refresh and try again.' };
}

/** Never overridable: someone who hasn't submitted, or is On Hold, can't be cleared. */
const HARD_BLOCKS = new Set(['submitted', 'not_on_hold']);

/** Whether a super_admin may clear despite what is incomplete: only when the
 * incomplete items are all overridable. */
export function overrideAllowed(checklist: readonly ClearanceItem[]): boolean {
  const incomplete = checklist.filter((item) => !item.met);
  return incomplete.length > 0 && incomplete.every((item) => !HARD_BLOCKS.has(item.key));
}

/** The document reviews as they stood when read: any review change since
 * (a decision, a reset when the applicant changed files) alters it. */
function reviewFingerprint(reviews: readonly DocumentReviewRow[]): string {
  const latest = reviews.reduce((max, r) => (r.updated_at > max ? r.updated_at : max), '');
  return `${reviews.length}:${latest}`;
}

/**
 * Clears a clinician. Normally only once every checklist item is met; a
 * super_admin may override what is incomplete, with a required reason —
 * except a hard block (not submitted, On Hold), which nothing overrides. The
 * override, its reason and exactly what was incomplete are audited.
 * `adminRole` is read from admin_users by the caller, not taken from the token.
 *
 * The decision is made on what was read (`ctx`) and applied only if none of it
 * has changed: the UPDATE itself re-checks the hard blocks and requires the
 * clinician record, the applicant's session and every document review to be
 * exactly as read. A status, hold, review or applicant file changed a moment
 * ago makes it a conflict to refresh, never a clearance on stale facts.
 */
export async function clearClinician(
  db: D1Database,
  ctx: ClinicianContext,
  p: { adminId: number; adminRole: string; override: boolean; reason: unknown },
): Promise<WorkflowResult> {
  if (ctx.record.cleared_at) return { ok: false, status: 409, error: 'This clinician is already cleared.' };
  const checklist = clearanceChecklist(ctx);
  const incomplete = checklist.filter((item) => !item.met);
  const hardBlocked = incomplete.filter((item) => HARD_BLOCKS.has(item.key));
  if (hardBlocked.length > 0) {
    return { ok: false, status: 409, error: `Can't be cleared: ${hardBlocked.map((i) => i.label.toLowerCase()).join(' and ')} is required, and can't be overridden.`, incomplete };
  }
  const reason = reasonOrNull(p.reason);
  if (incomplete.length > 0 && !p.override) {
    return { ok: false, status: 409, error: 'Clearance requirements are incomplete.', incomplete };
  }
  if (p.override) {
    if (p.adminRole !== 'super_admin') return { ok: false, status: 403, error: 'Only a super admin can override clearance requirements.' };
    if (!reason) return { ok: false, status: 422, error: 'A reason is required to override clearance requirements.' };
  }

  const now = new Date().toISOString();
  const base = auditBase(ctx, now);
  const overridden = p.override && incomplete.length > 0;
  const normalGuard = overridden ? '' : VERIFICATION_KINDS.map((k) => `AND ${VERIFICATION_COLUMNS[k]} = 'complete'`).join(' ');
  const statements = [
    db.prepare(
      `UPDATE clinicians SET cleared_at = ?, cleared_by = ?, updated_at = ?
       WHERE id = ? AND cleared_at IS NULL AND on_hold_at IS NULL AND updated_at = ?
         AND EXISTS (
           SELECT 1 FROM onboarding_sessions s JOIN applications a ON a.application_id = s.application_id
           WHERE s.session_id = ? AND s.user_id = clinicians.user_id AND s.revision = ?)
         AND (SELECT COUNT(*) || ':' || COALESCE(MAX(updated_at), '') FROM document_reviews WHERE clinician_id = clinicians.id) = ?
         ${normalGuard}`,
    ).bind(now, p.adminId, now, ctx.record.id, ctx.record.updated_at, ctx.session?.session_id ?? null, ctx.session?.revision ?? null, reviewFingerprint(ctx.reviews)),
    insertClinicianAuditIfChangedStmt(db, { ...base, action: 'clinician_cleared', metadata: { adminId: p.adminId, override: overridden } }),
  ];
  if (overridden) {
    statements.push(insertClinicianAuditIfChangedStmt(db, {
      ...base, action: 'clearance_overridden',
      metadata: { adminId: p.adminId, reason, incomplete: incomplete.map((i) => ({ key: i.key, label: i.label, ...(i.detail?.length ? { detail: i.detail } : {}) })) },
    }));
  }
  const [result] = await db.batch(statements);
  return (result.meta.changes ?? 0) > 0
    ? { ok: true }
    : { ok: false, status: 409, error: 'Something changed since this page loaded. Refresh and review the checklist again.' };
}

export async function revokeClearance(db: D1Database, ctx: ClinicianContext, adminId: number, reason: unknown): Promise<WorkflowResult> {
  const now = new Date().toISOString();
  const note = reasonOrNull(reason);
  const changed = await guarded(
    db,
    db.prepare('UPDATE clinicians SET cleared_at = NULL, cleared_by = NULL, updated_at = ? WHERE id = ? AND cleared_at IS NOT NULL').bind(now, ctx.record.id),
    { ...auditBase(ctx, now), action: 'clearance_revoked', metadata: { adminId, previousClearedAt: ctx.record.cleared_at, previousClearedBy: ctx.record.cleared_by, ...(note ? { reason: note } : {}) } },
  );
  return changed ? { ok: true } : { ok: false, status: 409, error: 'This clinician is not cleared.' };
}

// ── Detail ───────────────────────────────────────────────────────────────────

export interface ClinicianWorkflowDetail {
  clinician: ClinicianListItem;
  candidate: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    position: string | null;
    recruiterNotes: string | null;
    interviewStatus: string | null;
    resume: { fileName: string; fileSize: number; contentType: string; uploadedAt: string } | null;
    /** The email can be corrected only while no invitation is out or was used, and no account exists. */
    emailEditable: boolean;
  };
  invitation: { id: number; status: string; sentAt: string | null; expiresAt: string | null; useCandidateResume: boolean } | null;
  onHold: { since: string; by: string | null; reason: string | null } | null;
  verifications: Record<VerificationKind, VerificationStatus>;
  clearance: {
    clearedAt: string | null;
    clearedBy: string | null;
    checklist: ClearanceItem[];
    ready: boolean;
    /** Incomplete, but only in ways a super_admin may override (never not submitted or On Hold). */
    overrideAllowed: boolean;
  };
  documentReviews: { source: ReviewFileSource; requirements: RequirementReview[] };
  /** Who did it (the admin's email), when an admin did. */
  auditLogs: { id: number; action: string; actor: string | null; metadata: Record<string, unknown> | null; createdAt: string }[];
  /** What the signed-in admin may do beyond the regular workflow. The Worker
   * enforces each of these itself; this only spares the portal showing a
   * control that would be refused. */
  permissions: { overrideClearance: boolean };
}

/** Whether a candidate's email may still be corrected: while no account
 * exists and no invitation is out or was ever used — so before any invitation,
 * or when every invitation sent was revoked (e.g. sent to a mistyped address). */
export function emailEditable(ctx: Pick<ClinicianContext, 'record' | 'invites'>): boolean {
  return ctx.record.user_id === null && ctx.invites.every((i) => i.revoked_at !== null && i.used_at === null);
}

export async function workflowDetail(db: D1Database, ctx: ClinicianContext, viewerRole: string): Promise<ClinicianWorkflowDetail> {
  const r = ctx.record;
  const logs: AuditLogRow[] = await findAuditLogsForClinician(db, r.id, ctx.application?.application_id ?? null);
  const logAdminIds = logs.map((l) => publicAuditMetadata(l.metadata_json)?.adminId).filter((id): id is number => typeof id === 'number');
  const adminIds = [...new Set([r.on_hold_by, r.cleared_by, ...logAdminIds].filter((id): id is number => id !== null))];
  const admins = new Map<number, string>();
  if (adminIds.length > 0) {
    const rows = await db.prepare(`SELECT id, email FROM admin_users WHERE id IN (${adminIds.map(() => '?').join(', ')})`).bind(...adminIds).all<{ id: number; email: string }>();
    for (const row of rows.results) admins.set(row.id, row.email);
  }
  const invite = ctx.invites.find((i) => i.clinician_id === r.id) ?? ctx.invites[0];
  const checklist = clearanceChecklist(ctx);

  return {
    clinician: clinicianListItem(ctx),
    candidate: {
      firstName: r.first_name, lastName: r.last_name, email: r.email, phone: r.phone, position: r.position,
      recruiterNotes: r.recruiter_notes, interviewStatus: r.interview_status,
      resume: r.resume_object_key
        ? { fileName: r.resume_file_name!, fileSize: r.resume_file_size ?? 0, contentType: r.resume_content_type ?? '', uploadedAt: toIsoTimestamp(r.resume_uploaded_at) ?? '' }
        : null,
      emailEditable: emailEditable(ctx),
    },
    invitation: invite
      ? { id: invite.id, status: inviteStatus(invite), sentAt: toIsoTimestamp(invite.created_at), expiresAt: toIsoTimestamp(invite.expires_at), useCandidateResume: !!invite.use_candidate_resume }
      : null,
    onHold: r.on_hold_at ? { since: toIsoTimestamp(r.on_hold_at)!, by: r.on_hold_by !== null ? admins.get(r.on_hold_by) ?? null : null, reason: r.on_hold_reason } : null,
    verifications: Object.fromEntries(VERIFICATION_KINDS.map((k) => [k, r[VERIFICATION_COLUMNS[k]]])) as Record<VerificationKind, VerificationStatus>,
    clearance: {
      clearedAt: toIsoTimestamp(r.cleared_at),
      clearedBy: r.cleared_by !== null ? admins.get(r.cleared_by) ?? null : null,
      checklist,
      ready: checklist.every((i) => i.met),
      overrideAllowed: overrideAllowed(checklist),
    },
    documentReviews: documentReviews(ctx),
    auditLogs: logs.map((l) => {
      const metadata = publicAuditMetadata(l.metadata_json);
      const adminId = metadata?.adminId;
      return { id: l.id, action: l.action, actor: typeof adminId === 'number' ? admins.get(adminId) ?? null : null, metadata, createdAt: toIsoTimestamp(l.created_at) ?? l.created_at };
    }),
    permissions: { overrideClearance: viewerRole === 'super_admin' },
  };
}
