// The Admin clinician list: the Worker's response shape (GET
// /api/admin/clinicians and /api/admin/sessions/:id) and presentational
// helpers. Queues, completion and required documents are calculated by the
// Worker with the shared rules; nothing here recalculates them.

import { POSITION_OPTIONS, SPECIALTY_OPTIONS, optionLabel } from '@pcs/shared';
import { DOC_TYPE_LABELS } from './document-labels';

export type OnboardingQueue =
  | 'new_applicant' | 'invited' | 'in_progress' | 'almost_done' | 'application_completed' | 'cleared' | 'on_hold';

export type VerificationKind = 'background_check' | 'reference_verification' | 'i9_verification' | 'w4_verification';
export type VerificationStatus = 'not_started' | 'pending' | 'complete' | 'needs_review';
export type ReviewStatus = 'pending' | 'accepted' | 'needs_correction';

export interface RequiredDocumentSummary {
  total: number;
  completed: number;
  remaining: number;
}

export interface ClinicianListItem {
  clinicianId: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  contactEmail: string | null;
  position: string | null;
  specialtyPreference: string[];
  primaryClinicalSpecialty: string[];
  queue: OnboardingQueue;
  completionPercent: number | null;
  requiredDocuments: RequiredDocumentSummary | null;
  startedAt: string | null;
  lastActiveAt: string | null;
  completedAt: string | null;
  applicationId: string | null;
  sessionId: string | null;
  documentCount: number | null;
  invitation: { status: 'pending' | 'used' | 'expired' | 'revoked'; sentAt: string | null; expiresAt: string | null } | null;
  /** The clinician record; null for data that has none (read-only, e.g. a historical web application). */
  clinicianRecordId: number | null;
  onHold: { since: string; reason: string | null } | null;
  clearedAt: string | null;
  verifications: Record<VerificationKind, VerificationStatus> | null;
  documentReview: { pending: number; accepted: number; needsCorrection: number } | null;
  interviewStatus: 'pending' | 'completed' | null;
  hasCandidateResume: boolean;
}

export type QueueCounts = Record<OnboardingQueue | 'all', number>;

export interface ClinicianPage {
  data: ClinicianListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  queueCounts: QueueCounts;
}

export interface OnboardingSummary {
  clinician: ClinicianListItem;
  steps: { id: string; label: string; required: boolean; status: string; percent: number | null }[];
  requiredDocuments: { key: string; stepId: string; satisfied: boolean; attachmentCount: number }[];
  /** Files attached so far, by upload id, in the applicant's order. */
  documents: { id: number; docType: string; fileName: string; fileSize: number; uploadedAt: string }[];
}

/** The summary's files grouped by document, labelled as on a submitted application. */
export function onboardingDocumentGroups(documents: OnboardingSummary['documents']) {
  const groups: { label: string; documents: OnboardingSummary['documents'] }[] = [];
  for (const doc of documents) {
    const label = DOC_TYPE_LABELS[doc.docType] ?? doc.docType;
    const group = groups.find((g) => g.label === label);
    if (group) group.documents.push(doc);
    else groups.push({ label, documents: [doc] });
  }
  return groups;
}

// ── Queues ───────────────────────────────────────────────────────────────────

export const QUEUE_TABS: { value: OnboardingQueue | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'new_applicant', label: 'New Applicants' },
  { value: 'invited', label: 'Invited' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'almost_done', label: 'Almost Done' },
  { value: 'application_completed', label: 'Application Completed' },
  { value: 'cleared', label: 'Cleared' },
  { value: 'on_hold', label: 'On Hold' },
];

export function queueLabel(queue: OnboardingQueue): string {
  return QUEUE_TABS.find((t) => t.value === queue)?.label ?? queue;
}

// ── Filters ──────────────────────────────────────────────────────────────────

export const POSITION_FILTER_OPTIONS = POSITION_OPTIONS;

/** The shared specialty catalog, once each (labels as applicants see them). */
export const SPECIALTY_FILTER_OPTIONS = SPECIALTY_OPTIONS.filter((o, i) => SPECIALTY_OPTIONS.findIndex((x) => x.value === o.value) === i);

export const SORT_OPTIONS = [
  { value: 'recent', label: 'Most recent activity' },
  { value: 'name_asc', label: 'Name A–Z' },
  { value: 'name_desc', label: 'Name Z–A' },
] as const;

export const DATE_FILTERS = [
  { key: 'started', label: 'Application started' },
  { key: 'lastActive', label: 'Last active' },
  { key: 'completed', label: 'Application completed' },
] as const;

/** Every query parameter the Worker's clinician list understands. */
export const CLINICIAN_QUERY_PARAMS = [
  'page', 'search', 'sort', 'queue', 'position', 'specialty',
  'startedFrom', 'startedTo', 'lastActiveFrom', 'lastActiveTo', 'completedFrom', 'completedTo',
  'recentlyOnboarded', 'backgroundCheck', 'referenceVerification', 'i9Verification', 'w4Verification', 'documentReview',
] as const;

// ── Recruiter workflow ───────────────────────────────────────────────────────

export const VERIFICATIONS: { kind: VerificationKind; param: 'backgroundCheck' | 'referenceVerification' | 'i9Verification' | 'w4Verification'; label: string; short: string }[] = [
  { kind: 'background_check', param: 'backgroundCheck', label: 'Background Check', short: 'BG' },
  { kind: 'reference_verification', param: 'referenceVerification', label: 'Reference Verification', short: 'Ref' },
  { kind: 'i9_verification', param: 'i9Verification', label: 'I-9 Verification', short: 'I-9' },
  { kind: 'w4_verification', param: 'w4Verification', label: 'W-4 Verification', short: 'W-4' },
];

export const VERIFICATION_STATUS_OPTIONS: { value: VerificationStatus; label: string }[] = [
  { value: 'not_started', label: 'Not Started' },
  { value: 'pending', label: 'Pending' },
  { value: 'complete', label: 'Complete' },
  { value: 'needs_review', label: 'Needs Review' },
];

export const REVIEW_STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'needs_correction', label: 'Needs Correction' },
];

export function verificationStatusLabel(status: VerificationStatus): string {
  return VERIFICATION_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export function reviewStatusLabel(status: ReviewStatus): string {
  return REVIEW_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
}

export type ClinicianQueryParams = Partial<Record<(typeof CLINICIAN_QUERY_PARAMS)[number], string>>;

/** Only the known parameters, trimmed and non-empty. */
export function pickClinicianQuery(params: Record<string, string | string[] | undefined>): ClinicianQueryParams {
  const picked: ClinicianQueryParams = {};
  for (const key of CLINICIAN_QUERY_PARAMS) {
    const raw = params[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (value) picked[key] = value;
  }
  return picked;
}

/** The list URL for a queue tab: every other filter kept, back to page 1. */
export function queueHref(params: ClinicianQueryParams, queue: OnboardingQueue | ''): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key !== 'queue' && key !== 'page' && value) next.set(key, value);
  }
  if (queue) next.set('queue', queue);
  const qs = next.toString();
  return `/admin/applications${qs ? `?${qs}` : ''}`;
}

export function hasActiveFilters(params: ClinicianQueryParams): boolean {
  return Object.entries(params).some(([key, value]) => key !== 'page' && key !== 'sort' && key !== 'queue' && !!value);
}

// ── Display ──────────────────────────────────────────────────────────────────

/** "First Last", or the email for someone known only by an invitation. */
export function clinicianName(c: Pick<ClinicianListItem, 'firstName' | 'lastName' | 'email'>): string {
  return [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unnamed clinician';
}

export function hasName(c: Pick<ClinicianListItem, 'firstName' | 'lastName'>): boolean {
  return !!(c.firstName || c.lastName);
}

/** Specialty labels, preference first, each once. */
export function specialtyLabels(c: Pick<ClinicianListItem, 'specialtyPreference' | 'primaryClinicalSpecialty'>): string[] {
  const codes = Array.from(new Set([...c.specialtyPreference, ...c.primaryClinicalSpecialty]));
  return codes.map((code) => optionLabel(SPECIALTY_OPTIONS, code));
}

export function documentsLeftText(summary: RequiredDocumentSummary | null): string | null {
  if (!summary) return null;
  if (summary.remaining === 0) return 'All documents in';
  return `${summary.remaining} document${summary.remaining === 1 ? '' : 's'} left`;
}

/** Where a clinician opens: the submitted application, the onboarding
 * summary, their clinician page (not started yet), or Invitations for an
 * invitation with no clinician record. */
export function clinicianHref(c: Pick<ClinicianListItem, 'applicationId' | 'sessionId'> & Partial<Pick<ClinicianListItem, 'clinicianRecordId'>>): string {
  if (c.applicationId) return `/admin/applications/${encodeURIComponent(c.applicationId)}`;
  if (c.sessionId) return `/admin/onboarding/${encodeURIComponent(c.sessionId)}`;
  if (c.clinicianRecordId) return `/admin/clinicians/${c.clinicianRecordId}`;
  return '/admin/invitations';
}

const REQUIREMENT_LABELS: Record<string, string> = {
  i9_identity: 'I-9 identity (List A, or List B + List C)',
};

export function requirementLabel(key: string): string {
  return REQUIREMENT_LABELS[key] ?? DOC_TYPE_LABELS[key] ?? key;
}

const STEP_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  not_started: 'Not started',
  failed: 'Failed',
  skipped: 'Skipped',
};

export function stepStatusLabel(status: string): string {
  return STEP_STATUS_LABELS[status] ?? status;
}

export function positionLabel(position: string | null): string {
  return position ? optionLabel(POSITION_OPTIONS, position) : '—';
}
