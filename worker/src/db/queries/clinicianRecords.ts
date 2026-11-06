// The clinicians table (migrations/0007, 0008): the lifecycle root and the
// recruiter's own workflow state. Applicant answers never live here.

export const VERIFICATION_STATUSES = ['not_started', 'pending', 'complete', 'needs_review'] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** The four internal verifications, by the name used in URLs and audit actions. */
export const VERIFICATION_COLUMNS = {
  background_check: 'background_check_status',
  reference_verification: 'reference_verification_status',
  i9_verification: 'i9_verification_status',
  w4_verification: 'w4_verification_status',
} as const;
export type VerificationKind = keyof typeof VERIFICATION_COLUMNS;
export const VERIFICATION_KINDS = Object.keys(VERIFICATION_COLUMNS) as VerificationKind[];

export const INTERVIEW_STATUSES = ['pending', 'completed'] as const;
export type InterviewStatus = (typeof INTERVIEW_STATUSES)[number];

export interface ClinicianRecordRow {
  id: number;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  position: string | null;
  user_id: number | null;
  on_hold_at: string | null;
  on_hold_by: number | null;
  on_hold_reason: string | null;
  background_check_status: VerificationStatus;
  reference_verification_status: VerificationStatus;
  i9_verification_status: VerificationStatus;
  w4_verification_status: VerificationStatus;
  cleared_at: string | null;
  cleared_by: number | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  recruiter_notes: string | null;
  interview_status: InterviewStatus | null;
  resume_object_key: string | null;
  resume_file_name: string | null;
  resume_file_size: number | null;
  resume_content_type: string | null;
  resume_uploaded_at: string | null;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export async function findClinicianRecord(db: D1Database, id: number): Promise<ClinicianRecordRow | null> {
  return db.prepare('SELECT * FROM clinicians WHERE id = ?').bind(id).first<ClinicianRecordRow>();
}

export async function findClinicianRecordByEmail(db: D1Database, email: string): Promise<ClinicianRecordRow | null> {
  return db.prepare('SELECT * FROM clinicians WHERE email = ?').bind(normalizeEmail(email)).first<ClinicianRecordRow>();
}

export async function findClinicianRecordByUserId(db: D1Database, userId: number): Promise<ClinicianRecordRow | null> {
  return db.prepare('SELECT * FROM clinicians WHERE user_id = ?').bind(userId).first<ClinicianRecordRow>();
}

export async function listClinicianRecords(db: D1Database): Promise<ClinicianRecordRow[]> {
  return (await db.prepare('SELECT * FROM clinicians').all<ClinicianRecordRow>()).results;
}

/** The clinician for an email, created (by `createdBy`) if there is none.
 * Safe under concurrency: the insert is a no-op if the email already exists. */
export async function ensureClinicianRecord(db: D1Database, p: { email: string; createdBy: number | null; now: string }): Promise<{ record: ClinicianRecordRow; created: boolean }> {
  const email = normalizeEmail(p.email);
  const inserted = await db
    .prepare(`INSERT INTO clinicians (email, created_by, created_at, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`)
    .bind(email, p.createdBy, p.now, p.now)
    .run();
  const record = await findClinicianRecordByEmail(db, email);
  if (!record) throw new Error('ensureClinicianRecord: row missing after insert');
  return { record, created: (inserted.meta.changes ?? 0) > 0 };
}
