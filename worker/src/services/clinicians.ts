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
import { toIsoTimestamp } from '../utils/time';

// ── The Admin clinician list ─────────────────────────────────────────────────
//
// One row per clinician across the existing onboarding lifecycle, combined
// from the records that already exist — never stored:
//   invitation → account → onboarding session → submitted application.
// A session (one per account) is the clinician from the moment onboarding
// starts, and carries its application once submitted. Before that, an account
// with no session, or an invitation no account has claimed yet, stands in.
// A submitted application with no session behind it (a historical web
// submission) is its own row.
//
// Every value is calculated on read with the shared rules: completion is
// computeOverallCompletion, documents are requiredDocumentGroups, and the
// queue follows from those. Volume is small enough to filter, sort and page
// in the Worker.

export type OnboardingQueue = 'invited' | 'in_progress' | 'almost_done' | 'application_completed';

export const ONBOARDING_QUEUES: readonly OnboardingQueue[] = ['invited', 'in_progress', 'almost_done', 'application_completed'];

/** Almost Done: at least this complete AND at most this many documents left. */
export const ALMOST_DONE_MIN_COMPLETION_PERCENT = 80;
export const ALMOST_DONE_MAX_DOCUMENTS_REMAINING = 5;

export function onboardingQueue(p: {
  submitted: boolean;
  started: boolean;
  completionPercent: number | null;
  documentsRemaining: number | null;
}): OnboardingQueue {
  if (p.submitted) return 'application_completed';
  if (!p.started) return 'invited';
  const almostDone =
    p.completionPercent !== null && p.completionPercent >= ALMOST_DONE_MIN_COMPLETION_PERCENT &&
    p.documentsRemaining !== null && p.documentsRemaining <= ALMOST_DONE_MAX_DOCUMENTS_REMAINING;
  return almostDone ? 'almost_done' : 'in_progress';
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
}

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
): ClinicianListItem {
  const formData = parseObject(session.form_data_json);
  const progress = sessionProgress(session.packet_id, formData);
  const submitted = session.status === 'submitted' || !!application;
  return {
    clinicianId: `session:${session.session_id}`,
    // The submitted application's snapshot is authoritative once there is one.
    firstName: nameOrNull(application?.first_name ?? session.first_name),
    lastName: nameOrNull(application?.last_name ?? session.last_name),
    ...emails(session.account_email, application?.email ?? session.email),
    ...clinicianProfile(formData.employmentApplication),
    queue: onboardingQueue({ submitted, started: true, ...progress, documentsRemaining: progress.requiredDocuments?.remaining ?? null }),
    ...progress,
    startedAt: toIsoTimestamp(session.created_at),
    lastActiveAt: toIsoTimestamp(session.updated_at),
    completedAt: toIsoTimestamp(application?.submitted_at),
    applicationId: application?.application_id ?? session.application_id ?? null,
    sessionId: session.session_id,
    documentCount: application ? application.document_count : null,
    invitation: invitationOf(invite),
  };
}

function notStarted(clinicianId: string, email: string, invite: ClinicianInviteRow | undefined): ClinicianListItem {
  return {
    clinicianId,
    firstName: null,
    lastName: null,
    email,
    contactEmail: null,
    position: null,
    specialtyPreference: [],
    primaryClinicalSpecialty: [],
    queue: 'invited',
    completionPercent: null,
    requiredDocuments: null,
    startedAt: null,
    lastActiveAt: null,
    completedAt: null,
    applicationId: null,
    sessionId: null,
    documentCount: null,
    invitation: invitationOf(invite),
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

/** Every clinician, once each. */
export function buildClinicians(sources: ClinicianSources): ClinicianListItem[] {
  const invites = latestInviteByEmail(sources.invites);
  const applications = new Map(sources.applications.map((a) => [a.application_id, a]));
  const accountEmails = new Set<string>();
  const clinicians: ClinicianListItem[] = [];

  for (const session of sources.sessions) {
    const email = emailKey(session.account_email ?? session.email);
    if (email) accountEmails.add(email);
    const application = session.application_id ? applications.get(session.application_id) ?? null : null;
    clinicians.push(sessionClinician(session, application, invites.get(email)));
  }
  for (const user of sources.usersWithoutSession) {
    const email = emailKey(user.email);
    accountEmails.add(email);
    clinicians.push(notStarted(`user:${user.id}`, user.email, invites.get(email)));
  }
  // An invitation nobody has registered with yet. A revoked one was withdrawn;
  // a used one is represented by its account above.
  for (const [email, invite] of invites) {
    if (accountEmails.has(email)) continue;
    const status = inviteStatus(invite);
    if (status === 'pending' || status === 'expired') clinicians.push(notStarted(`invite:${invite.id}`, invite.email, invite));
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

function matchesFilters(clinician: ClinicianListItem, query: ClinicianQuery): boolean {
  if (query.search && !matchesSearch(clinician, query.search)) return false;
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
export function queryClinicians(clinicians: readonly ClinicianListItem[], query: ClinicianQuery): ClinicianPage {
  const filtered = clinicians.filter((c) => matchesFilters(c, query));
  const queueCounts: QueueCounts = { all: filtered.length, invited: 0, in_progress: 0, almost_done: 0, application_completed: 0 };
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

/** The session's attached files a recruiter may view: applicant document
 * slots only, minus a vaccination proof whose answer is now a declination
 * (the same rule final submission promotes by). Ordered as the applicant
 * arranged each document's attachments. */
export function visibleSessionUploads(session: Pick<ClinicianSessionRow, 'form_data_json'>, uploads: readonly SessionUploadRow[]): SessionUploadRow[] {
  const formData = parseObject(session.form_data_json);
  const acknowledgements = formData.acknowledgements as Parameters<typeof isDocumentActiveForSubmission>[1];
  const visible = uploads.filter((u) => isApplicantDocType(u.doc_type) && isDocumentActiveForSubmission(u.doc_type, acknowledgements));
  const position = (u: SessionUploadRow) => {
    const index = documentAttachmentsFor(formData, u.doc_type).findIndex((file) => file.objectKey === u.object_key);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return [...visible].sort((a, b) => (a.doc_type === b.doc_type ? position(a) - position(b) || a.id - b.id : a.id - b.id));
}

export function onboardingSummary(
  session: ClinicianSessionRow,
  application: ClinicianApplicationRow | null,
  invites: readonly ClinicianInviteRow[],
  uploads: readonly SessionUploadRow[],
): OnboardingSummary {
  const clinician = sessionClinician(session, application, latestInviteByEmail(invites).values().next().value);
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
