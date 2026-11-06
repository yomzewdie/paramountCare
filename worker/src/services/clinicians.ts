import {
  POSITION_OPTIONS,
  SPECIALTY_OPTIONS,
  computeOverallCompletion,
  computeStepCompletion,
  defaultFormData,
  documentAttachmentsFor,
  finalizeEmploymentApplication,
  getPacket,
  isApplicantDocType,
  isOptionValue,
  normalizeEmploymentApplication,
  requiredDocumentGroups,
  summarizeRequiredDocuments,
  type OnboardingFormData,
  type RequiredDocumentSummary,
  type StepCompletion,
} from '@pcs/shared';
import {
  type ClinicianApplicationRow,
  type ClinicianInviteRow,
  type ClinicianSessionRow,
  type ClinicianSources,
  type SessionUploadRow,
} from '../db/queries/clinicians';
import { isDocumentActiveForSubmission } from './vaccineProof';
import { inviteStatus, type InviteStatus } from '../db/queries/onboardingInvites';
import { VERIFICATION_COLUMNS, VERIFICATION_KINDS, type ClinicianRecordRow, type InterviewStatus, type VerificationKind, type VerificationStatus } from '../db/queries/clinicianRecords';
import type { DocumentReviewRow, ReviewStatus } from '../db/queries/documentReviews';
import { requirementReviewStates, summarizeReviewStates, type DocumentReviewSummary } from './documentReviews';
import { toIsoTimestamp } from '../utils/time';

// ── The Admin clinician list ─────────────────────────────────────────────────
//
// One row per clinician across the whole lifecycle:
//   New Applicant → invitation → account → onboarding session → submitted
//   application → internal verification → cleared.
// The `clinicians` record (migrations/0007) is the root: it exists from the
// moment a recruiter records someone, before any invitation, and carries the
// recruiter's own workflow state. Everything the applicant answered stays in
// their session / application and is read from there. Data with no clinician
// record (an account or invitation from before the record existed, a
// historical web application) is still listed, read-only, from what it has.
//
// Every value is calculated on read with the shared rules: completion is
// computeOverallCompletion, documents are requiredDocumentGroups, and the
// queue follows from those and the recruiter's state. Volume is small enough
// to filter, sort and page in the Worker.

export type OnboardingQueue =
  | 'new_applicant' | 'invited' | 'in_progress' | 'almost_done' | 'application_completed' | 'cleared' | 'on_hold';

export const ONBOARDING_QUEUES: readonly OnboardingQueue[] = [
  'new_applicant', 'invited', 'in_progress', 'almost_done', 'application_completed', 'cleared', 'on_hold',
];

/** Almost Done: at least this complete AND at most this many documents left. */
export const ALMOST_DONE_MIN_COMPLETION_PERCENT = 80;
export const ALMOST_DONE_MAX_DOCUMENTS_REMAINING = 5;

/**
 * Precedence: On Hold → Cleared → Application Completed → Almost Done →
 * In Progress → Invited → New Applicant. On Hold and Cleared are recruiter
 * decisions; the rest follow from the applicant's own progress.
 */
export function onboardingQueue(p: {
  submitted: boolean;
  started: boolean;
  completionPercent: number | null;
  documentsRemaining: number | null;
  onHold?: boolean;
  cleared?: boolean;
  /** False only for someone recorded but never sent an invitation. */
  invited?: boolean;
}): OnboardingQueue {
  if (p.onHold) return 'on_hold';
  if (p.cleared) return 'cleared';
  if (p.submitted) return 'application_completed';
  if (!p.started) return p.invited === false ? 'new_applicant' : 'invited';
  const almostDone =
    p.completionPercent !== null && p.completionPercent >= ALMOST_DONE_MIN_COMPLETION_PERCENT &&
    p.documentsRemaining !== null && p.documentsRemaining <= ALMOST_DONE_MAX_DOCUMENTS_REMAINING;
  return almostDone ? 'almost_done' : 'in_progress';
}

/** Recently Onboarded: cleared within the last 14 days (inclusive). */
export const RECENTLY_ONBOARDED_DAYS = 14;

export function isRecentlyOnboarded(clearedAt: string | null, now: number): boolean {
  if (!clearedAt) return false;
  const cleared = Date.parse(clearedAt);
  return cleared <= now && now - cleared <= RECENTLY_ONBOARDED_DAYS * 24 * 60 * 60 * 1000;
}

export interface ClinicianInvitation {
  status: InviteStatus;
  sentAt: string | null;
  expiresAt: string | null;
}

export interface ClinicianListItem {
  /** Stable for the clinician's current record: `session:`, `user:`, `invite:` or `application:` + id. */
  clinicianId: string;
  firstName: string | null;
  lastName: string | null;
  /** The email the clinician was invited and registered with, when there is
   * an account; otherwise the only email on record. */
  email: string | null;
  /** The contact email the applicant entered, when it differs from `email`. */
  contactEmail: string | null;
  /** Canonical POSITION_OPTIONS value, or null when none is recorded. */
  position: string | null;
  /** SPECIALTY_OPTIONS codes — where the clinician wants to work. */
  specialtyPreference: string[];
  /** SPECIALTY_OPTIONS codes — where the clinician has experience. */
  primaryClinicalSpecialty: string[];
  queue: OnboardingQueue;
  completionPercent: number | null;
  requiredDocuments: RequiredDocumentSummary | null;
  startedAt: string | null;
  /** The applicant's own last save to their onboarding session. */
  lastActiveAt: string | null;
  completedAt: string | null;
  applicationId: string | null;
  sessionId: string | null;
  /** Files recorded on the submitted application. */
  documentCount: number | null;
  invitation: ClinicianInvitation | null;
  /** The clinician record id; null for data that has none (read-only). */
  clinicianRecordId: number | null;
  onHold: { since: string; reason: string | null } | null;
  clearedAt: string | null;
  /** The four internal verifications; null when there is no clinician record. */
  verifications: Record<VerificationKind, VerificationStatus> | null;
  /** Review counts over the documents the applicant has uploaded. */
  documentReview: DocumentReviewSummary | null;
  interviewStatus: InterviewStatus | null;
  hasCandidateResume: boolean;
}

/** The recruiter's own state for a clinician record; defaults for data without one. */
function workflowFields(record: ClinicianRecordRow | null): Pick<ClinicianListItem, 'clinicianRecordId' | 'onHold' | 'clearedAt' | 'verifications' | 'interviewStatus' | 'hasCandidateResume'> {
  if (!record) return { clinicianRecordId: null, onHold: null, clearedAt: null, verifications: null, interviewStatus: null, hasCandidateResume: false };
  return {
    clinicianRecordId: record.id,
    onHold: record.on_hold_at ? { since: toIsoTimestamp(record.on_hold_at)!, reason: record.on_hold_reason } : null,
    clearedAt: toIsoTimestamp(record.cleared_at),
    verifications: Object.fromEntries(VERIFICATION_KINDS.map((kind) => [kind, record[VERIFICATION_COLUMNS[kind]]])) as Record<VerificationKind, VerificationStatus>,
    interviewStatus: record.interview_status,
    hasCandidateResume: !!record.resume_object_key,
  };
}

const recruiterPosition = (record: ClinicianRecordRow | null) => (record?.position && isOptionValue(POSITION_OPTIONS, record.position) ? record.position : null);

export function parseObject(json: string | null | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const value: unknown = JSON.parse(json);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const knownSpecialties = (codes: readonly string[]) => codes.filter((code) => isOptionValue(SPECIALTY_OPTIONS, code));

/** Position and specialties as answered — the final, active answers for a
 * canonical position; for a historical answer without one, whatever stored
 * selections are still real specialty codes. */
export function clinicianProfile(rawEmploymentApplication: unknown): Pick<ClinicianListItem, 'position' | 'specialtyPreference' | 'primaryClinicalSpecialty'> {
  if (!rawEmploymentApplication || typeof rawEmploymentApplication !== 'object') {
    return { position: null, specialtyPreference: [], primaryClinicalSpecialty: [] };
  }
  const normalized = normalizeEmploymentApplication(rawEmploymentApplication);
  const position = isOptionValue(POSITION_OPTIONS, normalized.positionApplied) ? normalized.positionApplied : null;
  const answers = position ? finalizeEmploymentApplication(rawEmploymentApplication) : normalized;
  const primaryClinicalSpecialty = knownSpecialties(answers.primaryClinicalSpecialty);
  // A historical application's single primary specialty, when it names one.
  const legacyPrimary = normalized.primarySpecialty;
  if (legacyPrimary && isOptionValue(SPECIALTY_OPTIONS, legacyPrimary) && !primaryClinicalSpecialty.includes(legacyPrimary)) {
    primaryClinicalSpecialty.push(legacyPrimary);
  }
  return { position, specialtyPreference: knownSpecialties(answers.specialtyPreference), primaryClinicalSpecialty };
}

/** Completion and documents owed, by the shared rules. Unknown (null) when the
 * session's packet is unknown or its stored data can't be evaluated — one
 * malformed session never takes the whole list down. */
export function sessionProgress(packetId: string, formData: Record<string, unknown>): { completionPercent: number | null; requiredDocuments: RequiredDocumentSummary | null } {
  const packet = getPacket(packetId);
  if (!packet) return { completionPercent: null, requiredDocuments: null };
  try {
    const shaped = { ...defaultFormData, ...formData } as unknown as OnboardingFormData;
    return {
      completionPercent: computeOverallCompletion(packet, shaped),
      requiredDocuments: summarizeRequiredDocuments(requiredDocumentGroups(packet, formData)),
    };
  } catch (e) {
    console.warn('[clinicians] could not evaluate session progress:', e);
    return { completionPercent: null, requiredDocuments: null };
  }
}

function invitationOf(invite: ClinicianInviteRow | undefined): ClinicianInvitation | null {
  if (!invite) return null;
  return { status: inviteStatus(invite), sentAt: toIsoTimestamp(invite.created_at), expiresAt: toIsoTimestamp(invite.expires_at) };
}

/** The account email is the clinician's identity; the contact email they
 * entered is kept beside it when it differs. */
function emails(accountEmail: string | null, contactEmail: string | null | undefined): Pick<ClinicianListItem, 'email' | 'contactEmail'> {
  const email = accountEmail || contactEmail || null;
  const contact = contactEmail && emailKey(contactEmail) !== emailKey(email) ? contactEmail : null;
  return { email, contactEmail: contact };
}

const nameOrNull = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
const emailKey = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();

export function sessionClinician(
  session: ClinicianSessionRow,
  application: ClinicianApplicationRow | null,
  invite: ClinicianInviteRow | undefined,
  record: ClinicianRecordRow | null = null,
  reviews: readonly DocumentReviewRow[] = [],
): ClinicianListItem {
  const formData = parseObject(session.form_data_json);
  const progress = sessionProgress(session.packet_id, formData);
  const submitted = session.status === 'submitted' || !!application;
  const profile = clinicianProfile(formData.employmentApplication);
  return {
    clinicianId: record ? `clinician:${record.id}` : `session:${session.session_id}`,
    // The submitted application's snapshot is authoritative once there is
    // one; the applicant's own answers come before what a recruiter entered.
    firstName: nameOrNull(application?.first_name ?? session.first_name) ?? nameOrNull(record?.first_name),
    lastName: nameOrNull(application?.last_name ?? session.last_name) ?? nameOrNull(record?.last_name),
    ...emails(session.account_email ?? record?.email ?? null, application?.email ?? session.email),
    ...profile,
    position: profile.position ?? recruiterPosition(record),
    queue: onboardingQueue({
      submitted, started: true, ...progress, documentsRemaining: progress.requiredDocuments?.remaining ?? null,
      onHold: !!record?.on_hold_at, cleared: !!record?.cleared_at,
    }),
    ...progress,
    startedAt: toIsoTimestamp(session.created_at),
    lastActiveAt: toIsoTimestamp(session.updated_at),
    completedAt: toIsoTimestamp(application?.submitted_at),
    applicationId: application?.application_id ?? session.application_id ?? null,
    sessionId: session.session_id,
    documentCount: application ? application.document_count : null,
    invitation: invitationOf(invite),
    ...workflowFields(record),
    documentReview: record ? reviewSummary(session.packet_id, formData, reviews) : null,
  };
}

function reviewSummary(packetId: string, formData: Record<string, unknown>, reviews: readonly DocumentReviewRow[]): DocumentReviewSummary | null {
  try {
    return summarizeReviewStates(requirementReviewStates(packetId, formData, reviews));
  } catch (e) {
    console.warn('[clinicians] could not evaluate document reviews:', e);
    return null;
  }
}

/** Someone who hasn't started onboarding: a recorded candidate, an invitee,
 * or an account with no session yet. */
export function notStartedClinician(clinicianId: string, email: string, invite: ClinicianInviteRow | undefined, record: ClinicianRecordRow | null = null): ClinicianListItem {
  const invited = !!invite && inviteStatus(invite) !== 'revoked';
  return {
    clinicianId,
    firstName: nameOrNull(record?.first_name),
    lastName: nameOrNull(record?.last_name),
    email,
    contactEmail: null,
    position: recruiterPosition(record),
    specialtyPreference: [],
    primaryClinicalSpecialty: [],
    queue: onboardingQueue({
      submitted: false, started: false, completionPercent: null, documentsRemaining: null,
      onHold: !!record?.on_hold_at, cleared: !!record?.cleared_at,
      // An account means an invitation was used, even one this row can't see.
      invited: invited || !!record?.user_id || !record,
    }),
    completionPercent: null,
    requiredDocuments: null,
    startedAt: null,
    lastActiveAt: null,
    completedAt: null,
    applicationId: null,
    sessionId: null,
    documentCount: null,
    invitation: invitationOf(invite),
    ...workflowFields(record),
    documentReview: null,
  };
}

function historicalApplicationClinician(application: ClinicianApplicationRow): ClinicianListItem {
  const payload = parseObject(application.legacy_payload_json);
  return {
    clinicianId: `application:${application.application_id}`,
    firstName: nameOrNull(application.first_name),
    lastName: nameOrNull(application.last_name),
    email: application.email || null,
    contactEmail: null,
    ...clinicianProfile(payload.employmentApplication),
    queue: 'application_completed',
    // No onboarding session or packet to measure against.
    completionPercent: null,
    requiredDocuments: null,
    startedAt: null,
    lastActiveAt: null,
    completedAt: toIsoTimestamp(application.submitted_at),
    applicationId: application.application_id,
    sessionId: null,
    documentCount: application.document_count,
    invitation: null,
    ...workflowFields(null),
    documentReview: null,
  };
}

/** The newest invitation for each email. `invites` must be newest first. */
export function latestInviteByEmail(invites: readonly ClinicianInviteRow[]): Map<string, ClinicianInviteRow> {
  const latest = new Map<string, ClinicianInviteRow>();
  for (const invite of invites) {
    const key = emailKey(invite.email);
    if (!latest.has(key)) latest.set(key, invite);
  }
  return latest;
}

/** The newest invitation per clinician record. `invites` must be newest first. */
function latestInviteByClinician(invites: readonly ClinicianInviteRow[]): Map<number, ClinicianInviteRow> {
  const latest = new Map<number, ClinicianInviteRow>();
  for (const invite of invites) {
    if (invite.clinician_id !== null && !latest.has(invite.clinician_id)) latest.set(invite.clinician_id, invite);
  }
  return latest;
}

/** Every clinician, once each. */
export function buildClinicians(sources: ClinicianSources): ClinicianListItem[] {
  const invitesByEmail = latestInviteByEmail(sources.invites);
  const invitesByRecord = latestInviteByClinician(sources.invites);
  const applications = new Map(sources.applications.map((a) => [a.application_id, a]));
  const recordsByUser = new Map(sources.records.filter((r) => r.user_id !== null).map((r) => [r.user_id!, r]));
  const recordsByEmail = new Map(sources.records.map((r) => [r.email, r]));
  const reviewsByRecord = new Map<number, DocumentReviewRow[]>();
  for (const review of sources.reviews) reviewsByRecord.set(review.clinician_id, [...(reviewsByRecord.get(review.clinician_id) ?? []), review]);

  const listedRecords = new Set<number>();
  const accountEmails = new Set<string>();
  const clinicians: ClinicianListItem[] = [];
  const recordFor = (userId: number | null, email: string) => {
    const record = (userId !== null ? recordsByUser.get(userId) : undefined) ?? recordsByEmail.get(email) ?? null;
    if (record) listedRecords.add(record.id);
    return record;
  };
  const inviteFor = (record: ClinicianRecordRow | null, email: string) => (record ? invitesByRecord.get(record.id) : undefined) ?? invitesByEmail.get(email);

  for (const session of sources.sessions) {
    const email = emailKey(session.account_email ?? session.email);
    if (email) accountEmails.add(email);
    const record = recordFor(session.user_id, email);
    const application = session.application_id ? applications.get(session.application_id) ?? null : null;
    clinicians.push(sessionClinician(session, application, inviteFor(record, email), record, record ? reviewsByRecord.get(record.id) ?? [] : []));
  }
  for (const user of sources.usersWithoutSession) {
    const email = emailKey(user.email);
    accountEmails.add(email);
    const record = recordFor(user.id, email);
    clinicians.push(notStartedClinician(record ? `clinician:${record.id}` : `user:${user.id}`, user.email, inviteFor(record, email), record));
  }
  // Clinicians who haven't registered: New Applicants and invitees.
  for (const record of sources.records) {
    if (listedRecords.has(record.id)) continue;
    accountEmails.add(record.email);
    clinicians.push(notStartedClinician(`clinician:${record.id}`, record.email, inviteFor(record, record.email), record));
  }
  // An invitation with no clinician record and nobody registered (data from
  // before records existed). A revoked one was withdrawn; a used one is
  // represented by its account above.
  for (const [email, invite] of invitesByEmail) {
    if (accountEmails.has(email)) continue;
    const status = inviteStatus(invite);
    if (status === 'pending' || status === 'expired') clinicians.push(notStartedClinician(`invite:${invite.id}`, invite.email, invite));
  }
  for (const application of sources.applications) {
    if (!application.has_session) clinicians.push(historicalApplicationClinician(application));
  }
  return clinicians;
}

// ── Search, filters, sorting, pagination ─────────────────────────────────────

export type ClinicianSort = 'recent' | 'name_asc' | 'name_desc';
export const CLINICIAN_SORTS: readonly ClinicianSort[] = ['recent', 'name_asc', 'name_desc'];

export interface DateRange {
  /** Inclusive, YYYY-MM-DD (UTC). */
  from?: string;
  /** Inclusive, YYYY-MM-DD (UTC). */
  to?: string;
}

export interface ClinicianQuery {
  search?: string;
  queue?: OnboardingQueue;
  position?: string;
  specialty?: string;
  started?: DateRange;
  lastActive?: DateRange;
  completed?: DateRange;
  /** Cleared within the last 14 days. */
  recentlyOnboarded?: boolean;
  verifications?: Partial<Record<VerificationKind, VerificationStatus>>;
  /** Has at least one uploaded document in this review state. */
  documentReview?: ReviewStatus;
  sort: ClinicianSort;
  page: number;
  pageSize: number;
}

export type QueueCounts = Record<OnboardingQueue | 'all', number>;

export interface ClinicianPage {
  data: ClinicianListItem[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  /** Every queue's size under the other filters, so switching queue keeps them. */
  queueCounts: QueueCounts;
}

/** An ID only matches a term this long, so a short name fragment never hits
 * random characters inside one. */
const MIN_ID_SEARCH_LENGTH = 6;

/** Every word must appear in the name or email, or name an ID — so "Jane
 * Smith", "Smith Jane", "Smith, Jane" and partial words all find the same person. */
export function matchesSearch(clinician: ClinicianListItem, search: string): boolean {
  const terms = search.toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (terms.length === 0) return true;
  const lower = (values: (string | null)[]) => values.filter((v): v is string => !!v).map((v) => v.toLowerCase());
  const text = lower([clinician.firstName, clinician.lastName, clinician.email, clinician.contactEmail]);
  const ids = lower([clinician.applicationId, clinician.sessionId]);
  return terms.every((term) =>
    text.some((field) => field.includes(term)) ||
    (term.length >= MIN_ID_SEARCH_LENGTH && ids.some((id) => id.includes(term))));
}

const DAY_MS = 24 * 60 * 60 * 1000;

function inRange(timestamp: string | null, range: DateRange | undefined): boolean {
  if (!range || (!range.from && !range.to)) return true;
  if (!timestamp) return false;
  const time = Date.parse(timestamp);
  if (range.from && time < Date.parse(`${range.from}T00:00:00.000Z`)) return false;
  if (range.to && time >= Date.parse(`${range.to}T00:00:00.000Z`) + DAY_MS) return false;
  return true;
}

const REVIEW_COUNT_FIELD: Record<ReviewStatus, keyof DocumentReviewSummary> = {
  pending: 'pending', accepted: 'accepted', needs_correction: 'needsCorrection',
};

function matchesFilters(clinician: ClinicianListItem, query: ClinicianQuery, now: number): boolean {
  if (query.search && !matchesSearch(clinician, query.search)) return false;
  if (query.recentlyOnboarded && !isRecentlyOnboarded(clinician.clearedAt, now)) return false;
  for (const [kind, status] of Object.entries(query.verifications ?? {}) as [VerificationKind, VerificationStatus][]) {
    if (clinician.verifications?.[kind] !== status) return false;
  }
  if (query.documentReview && !(clinician.documentReview && clinician.documentReview[REVIEW_COUNT_FIELD[query.documentReview]] > 0)) return false;
  if (query.position && clinician.position !== query.position) return false;
  if (query.specialty && !clinician.specialtyPreference.includes(query.specialty) && !clinician.primaryClinicalSpecialty.includes(query.specialty)) return false;
  return inRange(clinician.startedAt, query.started) && inRange(clinician.lastActiveAt, query.lastActive) && inRange(clinician.completedAt, query.completed);
}

/** "Last, First" when there is a name; otherwise the email. */
export function sortName(clinician: ClinicianListItem): string {
  const name = [clinician.lastName, clinician.firstName].filter(Boolean).join(', ');
  return (name || clinician.email || '').toLowerCase();
}

const hasName = (clinician: ClinicianListItem) => !!(clinician.firstName || clinician.lastName);

/** The clinician's most recent recorded moment, for the default ordering. */
function recentActivity(clinician: ClinicianListItem): number {
  const timestamp = clinician.lastActiveAt ?? clinician.completedAt ?? clinician.invitation?.sentAt ?? clinician.startedAt;
  return timestamp ? Date.parse(timestamp) : 0;
}

const byId = (a: ClinicianListItem, b: ClinicianListItem) => (a.clinicianId < b.clinicianId ? -1 : a.clinicianId > b.clinicianId ? 1 : 0);

export function compareClinicians(sort: ClinicianSort): (a: ClinicianListItem, b: ClinicianListItem) => number {
  if (sort === 'recent') return (a, b) => recentActivity(b) - recentActivity(a) || byId(a, b);
  const direction = sort === 'name_asc' ? 1 : -1;
  // Named clinicians first either way; someone known only by an invitation
  // email follows, ordered by that email.
  return (a, b) =>
    Number(hasName(b)) - Number(hasName(a)) ||
    direction * sortName(a).localeCompare(sortName(b), 'en', { sensitivity: 'base' }) ||
    (a.email ?? '').localeCompare(b.email ?? '') ||
    byId(a, b);
}

/** Filters and sorts the complete set first, then pages it. */
export function queryClinicians(clinicians: readonly ClinicianListItem[], query: ClinicianQuery, now: number = Date.now()): ClinicianPage {
  const filtered = clinicians.filter((c) => matchesFilters(c, query, now));
  const queueCounts: QueueCounts = { all: filtered.length, ...(Object.fromEntries(ONBOARDING_QUEUES.map((q) => [q, 0])) as Record<OnboardingQueue, number>) };
  for (const c of filtered) queueCounts[c.queue] += 1;

  const inQueue = query.queue ? filtered.filter((c) => c.queue === query.queue) : filtered;
  const sorted = [...inQueue].sort(compareClinicians(query.sort));
  const start = (query.page - 1) * query.pageSize;
  return {
    data: sorted.slice(start, start + query.pageSize),
    pagination: { page: query.page, pageSize: query.pageSize, total: sorted.length, totalPages: Math.ceil(sorted.length / query.pageSize) },
    queueCounts,
  };
}

// ── One clinician's onboarding summary ───────────────────────────────────────
//
// What a recruiter needs about someone still onboarding: where they are in
// their packet and which required documents are in. Read-only, and no
// answers beyond the list's own fields — the full record is the submitted
// application.

export interface OnboardingStepSummary {
  id: string;
  label: string;
  required: boolean;
  /** The applicant's own step state; 'not_started' when none is recorded. */
  status: string;
  percent: number | null;
}

export interface OnboardingDocumentSummary {
  /** A doc type, or the I-9 identity requirement. */
  key: string;
  stepId: string;
  satisfied: boolean;
  /** Files currently held for it. */
  attachmentCount: number;
}

/** A file attached so far, by its upload id — never its storage key. */
export interface OnboardingUploadSummary {
  id: number;
  docType: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

export interface OnboardingSummary {
  clinician: ClinicianListItem;
  steps: OnboardingStepSummary[];
  requiredDocuments: OnboardingDocumentSummary[];
  /** Every file the applicant has attached that the session still counts, in
   * the applicant's own attachment order within each document. */
  documents: OnboardingUploadSummary[];
}

/** The session's attached files a recruiter may view: the applicant's current
 * documents only, minus a vaccination proof whose answer is now a declination
 * (the same rule final submission promotes by). Ordered as the applicant
 * arranged each document's attachments. */
export function visibleSessionUploads(session: Pick<ClinicianSessionRow, 'form_data_json'>, uploads: readonly SessionUploadRow[]): SessionUploadRow[] {
  const formData = parseObject(session.form_data_json);
  const acknowledgements = formData.acknowledgements as Parameters<typeof isDocumentActiveForSubmission>[1];
  const position = (u: SessionUploadRow) => documentAttachmentsFor(formData, u.doc_type).findIndex((file) => file.objectKey === u.object_key);
  // Only files the session currently holds: a file replaced during a
  // post-submission correction keeps its ledger row (submitted files are
  // never deleted) but is no longer one of the applicant's documents.
  const visible = uploads.filter((u) => isApplicantDocType(u.doc_type) && isDocumentActiveForSubmission(u.doc_type, acknowledgements) && position(u) !== -1);
  return [...visible].sort((a, b) => (a.doc_type === b.doc_type ? position(a) - position(b) || a.id - b.id : a.id - b.id));
}

export function onboardingSummary(
  session: ClinicianSessionRow,
  application: ClinicianApplicationRow | null,
  invites: readonly ClinicianInviteRow[],
  uploads: readonly SessionUploadRow[],
  record: ClinicianRecordRow | null = null,
  reviews: readonly DocumentReviewRow[] = [],
): OnboardingSummary {
  const clinician = sessionClinician(session, application, latestInviteByEmail(invites).values().next().value, record, reviews);
  const documents = visibleSessionUploads(session, uploads).map((u) => ({
    id: u.id, docType: u.doc_type, fileName: u.file_name, fileSize: u.file_size, uploadedAt: toIsoTimestamp(u.uploaded_at) ?? u.uploaded_at,
  }));
  const packet = getPacket(session.packet_id);
  if (!packet) return { clinician, steps: [], requiredDocuments: [], documents };

  const formData = parseObject(session.form_data_json);
  const stepStates = parseObject(session.step_states_json);
  let completions: Record<string, StepCompletion> = {};
  try {
    completions = computeStepCompletion({ ...defaultFormData, ...formData } as unknown as OnboardingFormData);
  } catch (e) {
    console.warn('[clinicians] could not evaluate step completion:', e);
  }

  return {
    clinician,
    steps: packet.steps
      .filter((step) => step.type !== 'review')
      .map((step) => ({
        id: step.id,
        label: step.label,
        required: step.required,
        status: typeof stepStates[step.id] === 'string' ? (stepStates[step.id] as string) : 'not_started',
        percent: completions[step.id]?.percent ?? null,
      })),
    requiredDocuments: requiredDocumentGroups(packet, formData).map((group) => ({
      key: group.key,
      stepId: group.stepId,
      satisfied: group.satisfied,
      attachmentCount: group.docTypes.reduce((n, docType) => n + documentAttachmentsFor(formData, docType).length, 0),
    })),
    documents,
  };
}
