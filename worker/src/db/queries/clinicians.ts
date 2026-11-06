import { listClinicianRecords, type ClinicianRecordRow } from './clinicianRecords';
import { findAllReviews, type DocumentReviewRow } from './documentReviews';

// Read-only views over the existing onboarding lifecycle tables, for the
// Admin clinician list: an invitation (onboarding_invites), an account
// (users), an onboarding session (onboarding_sessions) and a submitted
// application (applications). Nothing here writes, and nothing is stored
// about the clinician beyond what those tables already hold.

export interface ClinicianSessionRow {
  session_id: string;
  user_id: number | null;
  revision: number;
  packet_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  status: string;
  application_id: string | null;
  created_at: string;
  updated_at: string;
  form_data_json: string;
  step_states_json: string;
  /** The applicant account's email — the session's own copy is only set once
   * personal info is saved. */
  account_email: string | null;
}

export interface ClinicianApplicationRow {
  application_id: string;
  first_name: string;
  last_name: string;
  email: string;
  submitted_at: string;
  document_count: number;
  /** 1 when an onboarding session links to this application. */
  has_session: number;
  /** Only read for an application no session links to (a historical web
   * submission) — the session's own data is used otherwise. */
  legacy_payload_json: string | null;
}

export interface ClinicianUserRow {
  id: number;
  email: string;
  created_at: string;
}

export interface ClinicianInviteRow {
  id: number;
  email: string;
  clinician_id: number | null;
  use_candidate_resume: number;
  created_at: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}

export interface ClinicianSources {
  sessions: ClinicianSessionRow[];
  applications: ClinicianApplicationRow[];
  /** Accounts that have not started an onboarding session. */
  usersWithoutSession: ClinicianUserRow[];
  /** Newest first. */
  invites: ClinicianInviteRow[];
  /** The lifecycle root (migrations/0007): one per clinician. */
  records: ClinicianRecordRow[];
  reviews: DocumentReviewRow[];
}

const SESSION_COLUMNS = `
  s.session_id, s.user_id, s.revision, s.packet_id, s.first_name, s.last_name, s.email, s.status, s.application_id,
  s.created_at, s.updated_at, s.form_data_json, s.step_states_json, u.email AS account_email`;

const APPLICATION_COLUMNS = `
  a.application_id, a.first_name, a.last_name, a.email, a.submitted_at,
  (SELECT COUNT(*) FROM application_documents d WHERE d.application_id = a.application_id) AS document_count,
  EXISTS (SELECT 1 FROM onboarding_sessions s WHERE s.application_id = a.application_id) AS has_session,
  CASE WHEN EXISTS (SELECT 1 FROM onboarding_sessions s WHERE s.application_id = a.application_id)
       THEN NULL ELSE a.payload_json END AS legacy_payload_json`;

const INVITE_COLUMNS = 'id, email, clinician_id, use_candidate_resume, created_at, expires_at, used_at, revoked_at';

export async function loadClinicianSources(db: D1Database): Promise<ClinicianSources> {
  const [sessions, applications, usersWithoutSession, invites, records, reviews] = await Promise.all([
    db.prepare(`SELECT ${SESSION_COLUMNS} FROM onboarding_sessions s LEFT JOIN users u ON u.id = s.user_id`).all<ClinicianSessionRow>(),
    db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications a`).all<ClinicianApplicationRow>(),
    db.prepare(
      `SELECT u.id, u.email, u.created_at FROM users u
       WHERE NOT EXISTS (SELECT 1 FROM onboarding_sessions s WHERE s.user_id = u.id)`,
    ).all<ClinicianUserRow>(),
    db.prepare(`SELECT ${INVITE_COLUMNS} FROM onboarding_invites ORDER BY created_at DESC, id DESC`).all<ClinicianInviteRow>(),
    listClinicianRecords(db),
    findAllReviews(db),
  ]);
  return {
    sessions: sessions.results,
    applications: applications.results,
    usersWithoutSession: usersWithoutSession.results,
    invites: invites.results,
    records,
    reviews,
  };
}

/** One session with whatever it links to, for the read-only onboarding summary. */
export async function loadClinicianSession(
  db: D1Database,
  sessionId: string,
): Promise<{ session: ClinicianSessionRow; application: ClinicianApplicationRow | null; invites: ClinicianInviteRow[]; uploads: SessionUploadRow[] } | null> {
  const session = await db
    .prepare(`SELECT ${SESSION_COLUMNS} FROM onboarding_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE s.session_id = ? LIMIT 1`)
    .bind(sessionId)
    .first<ClinicianSessionRow>();
  if (!session) return null;

  const email = (session.account_email ?? session.email ?? '').toLowerCase();
  const [application, invites, uploads] = await Promise.all([
    session.application_id
      ? db.prepare(`SELECT ${APPLICATION_COLUMNS} FROM applications a WHERE a.application_id = ? LIMIT 1`).bind(session.application_id).first<ClinicianApplicationRow>()
      : Promise.resolve(null),
    email
      ? db.prepare(`SELECT ${INVITE_COLUMNS} FROM onboarding_invites WHERE lower(email) = ? ORDER BY created_at DESC, id DESC`).bind(email).all<ClinicianInviteRow>()
      : Promise.resolve({ results: [] as ClinicianInviteRow[] }),
    findSessionUploads(db, sessionId),
  ]);
  return { session, application, invites: invites.results, uploads };
}

/** A file the applicant has attached to their onboarding session, as the
 * upload ledger records it: live, attached to this session, and uploaded by
 * the session's own applicant. */
export interface SessionUploadRow {
  id: number;
  object_key: string;
  doc_type: string;
  file_name: string;
  file_size: number;
  content_type: string;
  uploaded_at: string;
}

const SESSION_UPLOADS = `
  SELECT d.id, d.object_key, d.doc_type, d.file_name, d.file_size, d.content_type, d.uploaded_at
  FROM uploaded_documents d
  JOIN onboarding_sessions s ON s.session_id = d.session_id AND s.user_id = d.user_id
  WHERE d.session_id = ? AND d.deleted_at IS NULL AND d.doc_type IS NOT NULL`;

export async function findSessionUploads(db: D1Database, sessionId: string): Promise<SessionUploadRow[]> {
  const result = await db.prepare(`${SESSION_UPLOADS} ORDER BY d.id ASC`).bind(sessionId).all<SessionUploadRow>();
  return result.results;
}

export async function findSessionIdForUser(db: D1Database, userId: number): Promise<string | null> {
  const row = await db.prepare('SELECT session_id FROM onboarding_sessions WHERE user_id = ? LIMIT 1').bind(userId).first<{ session_id: string }>();
  return row?.session_id ?? null;
}

/** Invitations for a clinician — linked, or (before linking existed) by email — newest first. */
export async function findInvitesForClinician(db: D1Database, record: Pick<ClinicianRecordRow, 'id' | 'email'>): Promise<ClinicianInviteRow[]> {
  const result = await db
    .prepare(`SELECT ${INVITE_COLUMNS} FROM onboarding_invites WHERE clinician_id = ? OR lower(email) = ? ORDER BY created_at DESC, id DESC`)
    .bind(record.id, record.email)
    .all<ClinicianInviteRow>();
  return result.results;
}
