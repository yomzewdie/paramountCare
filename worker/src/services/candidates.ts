import { z } from 'zod';
import { POSITION_OPTIONS, RESUME_DOC_TYPE, documentAttachmentsFor, isOptionValue, withDocumentAttachments } from '@pcs/shared';
import type { AppEnv } from '../env';
import {
  INTERVIEW_STATUSES,
  ensureClinicianRecord,
  findClinicianRecordByEmail,
  findClinicianRecordByUserId,
  normalizeEmail,
  type ClinicianRecordRow,
} from '../db/queries/clinicianRecords';
import { insertClinicianAuditIfChangedStmt } from '../db/queries/auditLogs';
import { emailEditable, type ClinicianContext } from './clinicianWorkflow';
import { findOutstandingInviteForEmail, insertOnboardingInviteStmt, type OnboardingInviteRow } from '../db/queries/onboardingInvites';
import { findUserByEmail } from '../db/queries/users';
import { associateUploadToSlot } from '../db/queries/uploadedDocuments';
import { findSessionById, updateSessionWithRevision, type OnboardingSessionRow } from '../db/queries/onboardingSessions';
import { generateInviteCode, hashInviteCode, normalizeInviteCode } from './inviteCode';
import { sendApplicantInvitation } from './email';
import { candidateResumeCopyKey, generateCandidateResumeObjectKey } from '../utils/objectKey';
import { isoInSeconds } from '../utils/time';
import { DOCX_MIME_TYPE, DOC_MIME_TYPE, MAX_UPLOAD_SIZE_BYTES, RESUME_CONTENT_TYPES } from '../routes/uploads';
import { buildContentDisposition } from '../utils/contentDisposition';

// ── New Applicants: clinicians a recruiter records before inviting ──────────
//
// Deliberately small — who they are, a note, whether they've been
// interviewed, and their resume — not an applicant tracking system.

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const candidateFieldsSchema = z.object({
  /** Correctable only until an invitation has been sent (see updateCandidate). */
  email: z.string().trim().email('Invalid email address').optional(),
  firstName: optionalText(100),
  lastName: optionalText(100),
  phone: optionalText(40),
  position: z.string().refine((v) => isOptionValue(POSITION_OPTIONS, v), 'Unknown position').nullable().optional(),
  recruiterNotes: optionalText(4000),
  interviewStatus: z.enum(INTERVIEW_STATUSES).optional(),
});

export const createCandidateSchema = candidateFieldsSchema.extend({
  email: z.string().trim().email('Invalid email address'),
  firstName: z.string().trim().min(1, 'First name is required').max(100),
  lastName: z.string().trim().min(1, 'Last name is required').max(100),
});

const blankToNull = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);

export type CreateCandidateResult =
  | { ok: true; record: ClinicianRecordRow }
  | { ok: false; status: 409; error: string; clinicianId: number };

export async function createCandidate(db: D1Database, adminId: number, input: z.infer<typeof createCandidateSchema>): Promise<CreateCandidateResult> {
  const email = normalizeEmail(input.email);
  const existing = await findClinicianRecordByEmail(db, email);
  if (existing) return { ok: false, status: 409, error: 'A clinician with this email already exists.', clinicianId: existing.id };

  const now = new Date().toISOString();
  const fields = {
    first_name: blankToNull(input.firstName), last_name: blankToNull(input.lastName), phone: blankToNull(input.phone),
    position: input.position ?? null, recruiter_notes: blankToNull(input.recruiterNotes), interview_status: input.interviewStatus ?? 'pending',
  };
  // ON CONFLICT: a concurrent create for the same email inserts nothing — and
  // so records no audit entry, which is written in the same batch only when
  // the insert happened, about the row it created.
  const metadata = { adminId, ...Object.fromEntries(Object.entries(fields).filter(([key, v]) => v !== null && key !== 'recruiter_notes')) };
  const [inserted] = await db.batch([
    db.prepare(
      `INSERT INTO clinicians (email, first_name, last_name, phone, position, recruiter_notes, interview_status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(email) DO NOTHING`,
    ).bind(email, fields.first_name, fields.last_name, fields.phone, fields.position, fields.recruiter_notes, fields.interview_status, adminId, now, now),
    db.prepare(
      `INSERT INTO audit_logs (clinician_id, action, metadata_json, created_at)
       SELECT last_insert_rowid(), 'candidate_created', ?, ? WHERE changes() > 0`,
    ).bind(JSON.stringify(metadata), now),
  ]);
  const record = (await findClinicianRecordByEmail(db, email))!;
  if ((inserted.meta.changes ?? 0) === 0) {
    return { ok: false, status: 409, error: 'A clinician with this email already exists.', clinicianId: record.id };
  }
  return { ok: true, record };
}

const FIELD_COLUMNS = {
  firstName: 'first_name', lastName: 'last_name', phone: 'phone', position: 'position', recruiterNotes: 'recruiter_notes', interviewStatus: 'interview_status',
} as const;

const EMAIL_LOCKED = 'The email can no longer be changed: an invitation is out or was accepted. Revoke an outstanding invitation first to correct it.';

export type UpdateCandidateResult = { ok: true } | { ok: false; status: 409; error: string };

/**
 * Updates the recruiter's own details. Only fields present in the request
 * change, audited in the same batch (notes by length, not content). The email
 * is the identity an invitation and account are tied to, so it can be
 * corrected only while no invitation is out or was used and no account exists
 * (emailEditable) — enforced here, and again in the UPDATE itself so a
 * concurrent invitation can't slip in between.
 */
export async function updateCandidate(db: D1Database, ctx: Pick<ClinicianContext, 'record' | 'invites'>, adminId: number, input: z.infer<typeof candidateFieldsSchema>): Promise<UpdateCandidateResult> {
  const { record } = ctx;
  const changes: [string, string | null][] = [];
  if (input.email !== undefined && normalizeEmail(input.email) !== record.email) {
    if (!emailEditable(ctx)) return { ok: false, status: 409, error: EMAIL_LOCKED };
    const email = normalizeEmail(input.email);
    if ((await findClinicianRecordByEmail(db, email)) || (await findUserByEmail(db, email))) {
      return { ok: false, status: 409, error: 'Another clinician already uses this email.' };
    }
    changes.push(['email', email]);
  }
  for (const [field, column] of Object.entries(FIELD_COLUMNS) as [keyof typeof FIELD_COLUMNS, (typeof FIELD_COLUMNS)[keyof typeof FIELD_COLUMNS]][]) {
    if (!(field in input) || input[field] === undefined) continue;
    const value = field === 'interviewStatus' || field === 'position' ? (input[field] ?? null) : blankToNull(input[field] as string | null);
    if (value !== record[column]) changes.push([column, value]);
  }
  if (changes.length === 0) return { ok: true };

  const now = new Date().toISOString();
  const emailGuard = changes.some(([column]) => column === 'email')
    ? `AND user_id IS NULL AND NOT EXISTS (
         SELECT 1 FROM onboarding_invites
         WHERE (clinician_id = clinicians.id OR lower(email) = clinicians.email) AND (revoked_at IS NULL OR used_at IS NOT NULL))`
    : '';
  const changed = Object.fromEntries(changes.map(([column, value]) => [
    column,
    column === 'recruiter_notes' ? `${value?.length ?? 0} characters` : column === 'email' ? { from: record.email, to: value } : value,
  ]));
  const [result] = await db.batch([
    db.prepare(`UPDATE clinicians SET ${changes.map(([c]) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? ${emailGuard}`)
      .bind(...changes.map(([, v]) => v), now, record.id),
    insertClinicianAuditIfChangedStmt(db, { clinicianId: record.id, action: 'candidate_updated', createdAt: now, metadata: { adminId, changed } }),
  ]);
  if ((result.meta.changes ?? 0) === 0) return { ok: false, status: 409, error: EMAIL_LOCKED };
  return { ok: true };
}

// ── The candidate's resume (admin-owned) ─────────────────────────────────────

const REQUIRED_RESUME_EXTENSION: Record<string, RegExp> = { [DOC_MIME_TYPE]: /\.doc$/i, [DOCX_MIME_TYPE]: /\.docx$/i };

export type StoreResumeResult = { ok: true } | { ok: false; status: 400 | 413 | 415 | 500; error: string };

/** Stores (or replaces) the recruiter's copy of a candidate's resume in
 * private R2: PDF, DOC or DOCX, up to 10 MB, a Word file with its own extension. */
export async function storeCandidateResume(env: AppEnv['Bindings'], record: ClinicianRecordRow, adminId: number, file: unknown): Promise<StoreResumeResult> {
  if (!(file instanceof File)) return { ok: false, status: 400, error: 'Missing or invalid field: file.' };
  if (!(RESUME_CONTENT_TYPES as readonly string[]).includes(file.type)) return { ok: false, status: 415, error: 'A resume must be a PDF, DOC, or DOCX file.' };
  const extension = REQUIRED_RESUME_EXTENSION[file.type];
  if (extension && !extension.test(file.name)) return { ok: false, status: 415, error: 'The file name does not match its file type.' };
  if (file.size > MAX_UPLOAD_SIZE_BYTES) return { ok: false, status: 413, error: 'File exceeds the 10 MB size limit.' };

  const objectKey = generateCandidateResumeObjectKey(record.id, file.name);
  try {
    await env.UPLOADS_BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, contentDisposition: buildContentDisposition(file.name) },
    });
  } catch (e) {
    console.error('[candidates] resume R2 put failed:', e);
    return { ok: false, status: 500, error: 'Storage error. Please try again.' };
  }

  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE clinicians SET resume_object_key = ?, resume_file_name = ?, resume_file_size = ?, resume_content_type = ?, resume_uploaded_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(objectKey, file.name, file.size, file.type, now, now, record.id),
    insertClinicianAuditIfChangedStmt(env.DB, {
      clinicianId: record.id, action: 'candidate_resume_uploaded', createdAt: now,
      metadata: { adminId, fileName: file.name, ...(record.resume_file_name ? { replacedFileName: record.resume_file_name } : {}) },
    }),
  ]);
  if (record.resume_object_key) {
    try {
      await env.UPLOADS_BUCKET.delete(record.resume_object_key);
    } catch (e) {
      console.error('[candidates] best-effort delete of replaced resume failed:', e);
    }
  }
  return { ok: true };
}

// ── Invitations (the one invitation mechanism) ───────────────────────────────

const INVITE_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

export type EmailDelivery = 'sent' | 'failed';

/** Emails an invitation code. Delivery failure never fails the request — the
 * invitation already exists, and the admin can resend. */
export async function sendInvitationEmail(env: { RESEND_API_KEY?: string }, email: string, code: string, expiresAt: string): Promise<EmailDelivery> {
  if (!env.RESEND_API_KEY) {
    console.warn('[invites] email skipped: RESEND_API_KEY not configured');
    return 'failed';
  }
  try {
    await sendApplicantInvitation(env.RESEND_API_KEY, { to: email, code, expiresAt });
    return 'sent';
  } catch (e) {
    console.error('[invites] failed to send invitation email:', e);
    return 'failed';
  }
}

export type CreateInvitationResult =
  | { ok: true; invite: OnboardingInviteRow; emailDelivery: EmailDelivery; clinicianId: number }
  | { ok: false; status: 409 | 422; error: string; inviteId?: number };

/**
 * Sends an onboarding invitation — from the Invitations page (by email) or a
 * New Applicant's page (`useCandidateResume`). Every invitation belongs to a
 * clinician, created now if the recruiter never recorded one.
 */
export async function createInvitation(
  env: AppEnv['Bindings'],
  p: { email: string; adminId: number; useCandidateResume?: boolean },
): Promise<CreateInvitationResult> {
  const email = normalizeEmail(p.email);
  if (await findUserByEmail(env.DB, email)) {
    return { ok: false, status: 409, error: 'An account with this email is already registered' };
  }
  const outstanding = await findOutstandingInviteForEmail(env.DB, email);
  if (outstanding) {
    return { ok: false, status: 409, error: 'An outstanding invitation already exists for this email — use resend instead', inviteId: outstanding.id };
  }

  const now = new Date().toISOString();
  const { record } = await ensureClinicianRecord(env.DB, { email, createdBy: p.adminId, now });
  const useCandidateResume = !!p.useCandidateResume;
  if (useCandidateResume && !record.resume_object_key) {
    return { ok: false, status: 422, error: 'There is no candidate resume to use for onboarding.' };
  }

  const rawCode = generateInviteCode();
  const tokenHash = await hashInviteCode(normalizeInviteCode(rawCode), env.INVITE_CODE_SECRET);
  const expiresAt = isoInSeconds(INVITE_EXPIRY_SECONDS);
  const [inserted] = await env.DB.batch<OnboardingInviteRow>([
    insertOnboardingInviteStmt(env.DB, { email, tokenHash, expiresAt, createdBy: p.adminId, clinicianId: record.id, useCandidateResume }),
    // The audit entry names the invitation it records, in the same transaction.
    env.DB.prepare(
      `INSERT INTO audit_logs (clinician_id, action, metadata_json, created_at)
       SELECT ?, 'invitation_sent', json_object('adminId', ?, 'inviteId', last_insert_rowid(), 'useCandidateResume', json(?)), ? WHERE changes() > 0`,
    ).bind(record.id, p.adminId, useCandidateResume ? 'true' : 'false', now),
  ]);
  const invite = inserted.results[0];

  const emailDelivery = await sendInvitationEmail(env, email, rawCode, expiresAt);
  return { ok: true, invite, emailDelivery, clinicianId: record.id };
}

// ── Candidate resume → the applicant's Resume requirement ────────────────────

interface PromotionUpload {
  id: number;
  object_key: string;
  user_id: number;
  session_id: string | null;
  file_name: string;
  file_size: number;
  content_type: string;
  uploaded_at: string;
  deleted_at: string | null;
}

/**
 * When an applicant invited with "Use existing resume for onboarding" starts
 * or resumes onboarding, their recruiter's copy of the resume becomes their own
 * Resume requirement — a real, ledger-backed upload, so it counts exactly like
 * one they uploaded (and they can replace it). The object is COPIED into the
 * applicant's own uploads/ namespace: the recruiter's copy is never shared
 * with, or deletable by, the applicant. Provenance is audited.
 *
 * Safe to run on every request, and to retry after any step failed: the copy
 * lands at the same key each time (candidateResumeCopyKey) and is skipped if
 * already there; the upload record is inserted once; the session update is
 * revision-guarded; the audit entry is written once per invitation. A finished
 * promotion is recognised and left alone, and one the applicant removed is
 * never re-added. If it can't complete, the applicant can upload their own.
 */
export async function ensureCandidateResumePromoted(env: AppEnv['Bindings'], p: { userId: number; session: OnboardingSessionRow }): Promise<OnboardingSessionRow> {
  const { session } = p;
  if (session.status !== 'active') return session;
  const record = await findClinicianRecordByUserId(env.DB, p.userId);
  if (!record?.resume_object_key || !record.resume_file_name) return session;
  const invite = await env.DB
    .prepare('SELECT id FROM onboarding_invites WHERE clinician_id = ? AND used_at IS NOT NULL AND use_candidate_resume = 1 ORDER BY used_at DESC LIMIT 1')
    .bind(record.id)
    .first<{ id: number }>();
  if (!invite) return session;

  const objectKey = candidateResumeCopyKey(p.userId, invite.id, record.resume_file_name);
  const findUpload = () => env.DB.prepare('SELECT * FROM uploaded_documents WHERE object_key = ?').bind(objectKey).first<PromotionUpload>();
  let upload = await findUpload();
  // Removed by the applicant (or someone else's key): never re-added.
  if (upload && (upload.deleted_at || upload.user_id !== p.userId)) return session;

  const formData = JSON.parse(session.form_data_json || '{}') as Record<string, unknown>;
  const resumes = documentAttachmentsFor(formData, RESUME_DOC_TYPE);
  // The applicant already has a resume of their own: nothing to do.
  if (resumes.length > 0 && !resumes.some((f) => f.objectKey === objectKey)) return session;

  try {
    if (!(await env.UPLOADS_BUCKET.head(objectKey))) {
      const source = await env.UPLOADS_BUCKET.get(record.resume_object_key);
      if (!source) return session;
      const contentType = record.resume_content_type ?? source.httpMetadata?.contentType ?? 'application/pdf';
      await env.UPLOADS_BUCKET.put(objectKey, await source.arrayBuffer(), {
        httpMetadata: { contentType, contentDisposition: buildContentDisposition(record.resume_file_name) },
      });
    }
    if (!upload) {
      const stored = (await env.UPLOADS_BUCKET.head(objectKey))!;
      await env.DB
        .prepare(
          `INSERT INTO uploaded_documents (object_key, user_id, file_name, file_size, content_type, uploaded_at)
           VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(object_key) DO NOTHING`,
        )
        .bind(objectKey, p.userId, record.resume_file_name, stored.size, stored.httpMetadata?.contentType ?? record.resume_content_type ?? 'application/pdf', new Date().toISOString())
        .run();
      upload = (await findUpload())!;
    }

    let current = session;
    if (resumes.length === 0) {
      const file = { name: upload.file_name, size: upload.file_size, type: upload.content_type, objectKey, uploadedAt: upload.uploaded_at };
      const updated = await updateSessionWithRevision(env.DB, {
        sessionId: session.session_id, expectedRevision: session.revision, ownerUserId: p.userId,
        formDataJson: JSON.stringify(withDocumentAttachments(formData, RESUME_DOC_TYPE, [file])),
      });
      // A concurrent save won; the next request finishes the promotion.
      if (!updated.ok) return updated.reason === 'conflict' ? updated.current : session;
      current = updated.session;
    }
    if (upload.session_id !== session.session_id) {
      await associateUploadToSlot(env.DB, { objectKey, sessionId: session.session_id, docType: RESUME_DOC_TYPE });
    }
    await env.DB
      .prepare(
        `INSERT INTO audit_logs (clinician_id, session_id, action, metadata_json, created_at)
         SELECT ?, ?, 'candidate_resume_promoted', ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM audit_logs WHERE clinician_id = ? AND action = 'candidate_resume_promoted' AND json_extract(metadata_json, '$.inviteId') = ?)`,
      )
      .bind(record.id, session.session_id, JSON.stringify({ inviteId: invite.id, uploadId: upload.id, fileName: upload.file_name }), new Date().toISOString(), record.id, invite.id)
      .run();
    return current;
  } catch (e) {
    console.error('[candidates] candidate resume promotion did not complete; it is retried on the next request:', e);
    return (await findSessionById(env.DB, session.session_id)) ?? session;
  }
}
