// The recruiter workflow for one clinician — the Worker's response shape
// (GET /api/admin/clinicians/:id and every action under it) and the browser
// calls that change it. Every rule (what blocks clearance, which documents
// can be reviewed) is decided by the Worker; nothing here recalculates it.

import { documentRequirementLabel } from '@pcs/shared';
import { VERIFICATIONS, verificationStatusLabel, type ClinicianListItem, type ReviewStatus, type VerificationKind, type VerificationStatus } from './clinicians';

export interface ClearanceItem {
  key: string;
  label: string;
  met: boolean;
  detail?: string[];
}

export interface ReviewFile {
  id: number;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

export interface RequirementReview {
  requirement: string;
  label: string;
  required: boolean;
  docTypes: string[];
  hasFiles: boolean;
  status: ReviewStatus;
  note: string | null;
  reviewedAt: string | null;
  reviewedBy: number | null;
  changedAfterReview: boolean;
  correctionOpen: boolean;
  correctionNotified: boolean;
  updatedAt: string | null;
  files: ReviewFile[];
}

export interface ClinicianWorkflow {
  clinician: ClinicianListItem;
  candidate: {
    firstName: string | null;
    lastName: string | null;
    email: string;
    phone: string | null;
    position: string | null;
    recruiterNotes: string | null;
    interviewStatus: 'pending' | 'completed' | null;
    resume: { fileName: string; fileSize: number; contentType: string; uploadedAt: string } | null;
    /** Correctable only until an invitation has been sent (the Worker enforces it). */
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
    /** Incomplete only in ways a super_admin may override — never not submitted or On Hold. */
    overrideAllowed: boolean;
  };
  documentReviews: { source: 'application' | 'session' | null; requirements: RequirementReview[] };
  auditLogs: AuditEntry[];
  /** What the signed-in admin may do beyond the regular workflow (the Worker enforces it). */
  permissions: { overrideClearance: boolean };
}

export interface AuditEntry {
  id: number;
  action: string;
  /** The admin who acted, when an admin did. */
  actor?: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export type ActionResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

/** One workflow action through the same-origin admin proxy. */
export async function clinicianAction(path: string, method: 'POST' | 'PUT' | 'PATCH', body?: unknown): Promise<ActionResult> {
  try {
    const res = await fetch(`/api/admin/clinicians${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!res.ok) return { ok: false, error: typeof parsed?.error === 'string' ? parsed.error : 'Something went wrong. Please try again.' };
    return { ok: true, data: parsed ?? {} };
  } catch {
    return { ok: false, error: 'Unable to reach the server. Please try again.' };
  }
}

/** Audit actions as recruiters read them. */
export function auditActionLabel(action: string): string {
  const label = action.replace(/_/g, ' ').replace(/\bi9\b/g, 'I-9').replace(/\bw4\b/g, 'W-4');
  return label.charAt(0).toUpperCase() + label.slice(1);
}

const CANDIDATE_FIELD_LABELS: Record<string, string> = {
  first_name: 'First name', last_name: 'Last name', phone: 'Phone', position: 'Position', recruiter_notes: 'Recruiter notes', interview_status: 'Interview', email: 'Email',
};

/**
 * One audit entry as a sentence a recruiter can read — what happened, and
 * the few details that matter (a reason, a status change, a file name).
 * Only known fields are shown; nothing technical is printed as-is.
 */
export function describeAuditEvent(action: string, metadata: Record<string, unknown> | null): { title: string; details: string[] } {
  const m = metadata ?? {};
  const text = (key: string) => (typeof m[key] === 'string' && (m[key] as string).trim() ? (m[key] as string) : null);
  const doc = text('requirement') ? documentRequirementLabel(text('requirement')!) : 'Document';
  const details = (...values: (string | null | false | undefined)[]) => values.filter((v): v is string => !!v);

  const verification = VERIFICATIONS.find((v) => action === `${v.kind}_status_changed`);
  if (verification) {
    const from = text('from'), to = text('to');
    return { title: `${verification.label}: ${from ? verificationStatusLabel(from as VerificationStatus) : '—'} → ${to ? verificationStatusLabel(to as VerificationStatus) : '—'}`, details: [] };
  }

  switch (action) {
    case 'candidate_created': return { title: 'Added as a New Applicant', details: [] };
    case 'candidate_updated': {
      const changed = (m.changed && typeof m.changed === 'object' ? m.changed : {}) as Record<string, unknown>;
      return {
        title: 'Details updated',
        details: Object.entries(changed).map(([field, value]) => {
          const label = CANDIDATE_FIELD_LABELS[field] ?? field;
          if (field === 'email' && value && typeof value === 'object') {
            const { from, to } = value as { from?: string; to?: string };
            return `Email: ${from ?? '—'} → ${to ?? '—'}`;
          }
          if (field === 'recruiter_notes') return 'Recruiter notes edited';
          if (field === 'interview_status') return `Interview: ${value === 'completed' ? 'Completed' : 'Pending'}`;
          return `${label}: ${typeof value === 'string' && value ? value : '—'}`;
        }),
      };
    }
    case 'candidate_resume_uploaded': return { title: 'Resume uploaded', details: details(text('fileName'), text('replacedFileName') && `Replaced ${text('replacedFileName')}`) };
    case 'invitation_sent': return { title: 'Onboarding invitation sent', details: details(m.useCandidateResume === true && 'With the recruiter\'s resume for onboarding') };
    case 'candidate_resume_promoted': return { title: 'Recruiter\'s resume added to onboarding', details: details(text('fileName')) };
    case 'document_accepted': return { title: `${doc} accepted`, details: [] };
    case 'document_correction_requested': return { title: `Correction requested: ${doc}`, details: details(text('note')) };
    case 'document_review_reset': return { title: `${doc} back to Pending`, details: [m.reason === 'applicant_changed_files' ? 'The applicant changed the files after review' : 'Reset by an admin'] };
    case 'document_correction_uploaded': return { title: `Corrected ${doc} uploaded by the applicant`, details: [] };
    case 'document_correction_notification_resent': return { title: `Correction email re-sent: ${doc}`, details: [] };
    case 'placed_on_hold': return { title: 'Placed on hold', details: details(text('reason')) };
    case 'resumed_from_hold': return { title: 'Onboarding resumed', details: [] };
    case 'clinician_cleared': return { title: m.override === true ? 'Cleared (with override)' : 'Cleared', details: [] };
    case 'clearance_revoked': return { title: 'Clearance revoked', details: details(text('reason')) };
    case 'clearance_overridden': {
      const incomplete = Array.isArray(m.incomplete) ? (m.incomplete as { label?: string }[]).map((i) => i.label).filter(Boolean).join(', ') : '';
      return { title: 'Clearance requirements overridden', details: details(text('reason') && `Reason: ${text('reason')}`, incomplete && `Incomplete at the time: ${incomplete}`) };
    }
    case 'application_submitted': return { title: 'Application submitted', details: [] };
    case 'i9_pdf_generated': return { title: 'Signed I-9 generated', details: [] };
    case 'w4_pdf_generated': return { title: 'Signed W-4 generated', details: [] };
    case 'verified_license_uploaded': return { title: 'Verified License uploaded', details: details(text('fileName')) };
    case 'verified_license_replaced': return { title: 'Verified License replaced', details: details(text('fileName')) };
    case 'verified_license_removed': return { title: 'Verified License removed', details: details(text('fileName')) };
    default: return { title: auditActionLabel(action), details: [] };
  }
}
