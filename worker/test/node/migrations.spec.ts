import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// The real migration files, applied in order to a plain SQLite database the
// way D1 applies them: each file in its own transaction, foreign keys
// enforced. Covers a fresh database and an upgrade of a database holding data
// in the current (0001–0006) schema.

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations');
const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return db;
}

function apply(db: DatabaseSync, which: (file: string) => boolean) {
  for (const file of files.filter(which)) {
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`${file}: ${(e as Error).message}`);
    }
  }
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
}

const upTo = (n: number) => (file: string) => Number(file.slice(0, 4)) <= n;
const after = (n: number) => (file: string) => Number(file.slice(0, 4)) > n;
const columns = (db: DatabaseSync, table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string; notnull: number }[]);
const all = (db: DatabaseSync, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).all(...params);
const get = (db: DatabaseSync, sql: string, ...params: (string | number | null)[]) => db.prepare(sql).get(...params) as Record<string, unknown> | undefined;

describe('migrations on a fresh database', () => {
  const db = database();
  apply(db, () => true);

  it('creates the clinician lifecycle, workflow and review schema', () => {
    const clinicianColumns = columns(db, 'clinicians').map((c) => c.name);
    for (const name of [
      'email', 'first_name', 'last_name', 'phone', 'position', 'user_id', 'on_hold_at', 'on_hold_by', 'on_hold_reason',
      'background_check_status', 'reference_verification_status', 'i9_verification_status', 'w4_verification_status',
      'cleared_at', 'cleared_by', 'created_by', 'recruiter_notes', 'interview_status', 'resume_object_key',
    ]) expect(clinicianColumns).toContain(name);
    expect(columns(db, 'document_reviews').map((c) => c.name)).toEqual(expect.arrayContaining(['clinician_id', 'requirement', 'status', 'note', 'correction_open']));
    expect(columns(db, 'onboarding_invites').map((c) => c.name)).toEqual(expect.arrayContaining(['clinician_id', 'use_candidate_resume']));
    expect(columns(db, 'application_documents').map((c) => c.name)).toContain('superseded_at');
  });

  it('a clinician can exist before any account, invitation, session or application', () => {
    db.prepare(`INSERT INTO clinicians (email, created_at, updated_at) VALUES ('new@example.com', 'x', 'x')`).run();
    expect(get(db, `SELECT user_id, background_check_status, interview_status FROM clinicians WHERE email = 'new@example.com'`))
      .toEqual({ user_id: null, background_check_status: 'not_started', interview_status: null });
  });

  it('audit events no longer need an application', () => {
    expect(columns(db, 'audit_logs').find((c) => c.name === 'application_id')!.notnull).toBe(0);
    const clinician = get(db, `SELECT id FROM clinicians WHERE email = 'new@example.com'`)!.id as number;
    db.prepare(`INSERT INTO audit_logs (action, created_at, clinician_id) VALUES ('candidate_created', 'x', ?)`).run(clinician);
  });

  it('rejects unknown workflow values and duplicate emails', () => {
    expect(() => db.prepare(`UPDATE clinicians SET background_check_status = 'done'`).run()).toThrow();
    expect(() => db.prepare(`UPDATE clinicians SET interview_status = 'scheduled'`).run()).toThrow();
    expect(() => db.prepare(`INSERT INTO clinicians (email, created_at, updated_at) VALUES ('new@example.com', 'x', 'x')`).run()).toThrow();
    const clinician = get(db, `SELECT id FROM clinicians WHERE email = 'new@example.com'`)!.id as number;
    expect(() => db.prepare(`INSERT INTO document_reviews (clinician_id, requirement, status, updated_at) VALUES (?, 'cpr_cert', 'approved', 'x')`).run(clinician)).toThrow();
  });
});

describe('upgrading a database with existing data', () => {
  const db = database();
  apply(db, upTo(6));

  // ── Data as it exists today ──
  db.exec(`
    INSERT INTO admin_users (id, email, password_hash, role) VALUES (1, 'recruiter@paramount.test', 'h', 'admin');
    INSERT INTO users (id, email, password_hash, email_verified_at, created_at) VALUES
      (10, 'Submitted@Example.com', 'h', '2026-09-01 10:00:00', '2026-09-01 10:00:00'),
      (11, 'progress@example.com', 'h', '2026-09-02 10:00:00', '2026-09-02 10:00:00'),
      (12, 'registered@example.com', 'h', '2026-09-03 10:00:00', '2026-09-03 10:00:00');
    INSERT INTO onboarding_invites (id, email, token_hash, expires_at, used_at, created_by, created_at) VALUES
      (1, 'submitted@example.com', 't1', '2026-09-08', '2026-09-01', 1, '2026-08-31 10:00:00'),
      (2, 'progress@example.com', 't2', '2026-09-09', '2026-09-02', 1, '2026-09-01 10:00:00'),
      (3, 'registered@example.com', 't3', '2026-09-10', '2026-09-03', 1, '2026-09-02 10:00:00'),
      (4, 'pending@example.com', 't4', '2026-12-01', NULL, 1, '2026-10-01 10:00:00'),
      (5, 'pending@example.com', 't5', '2026-12-02', NULL, 1, '2026-10-02 10:00:00');
    INSERT INTO onboarding_invites (id, email, token_hash, expires_at, revoked_at, created_by, created_at) VALUES
      (6, 'revoked@example.com', 't6', '2026-12-01', '2026-10-03', 1, '2026-10-01 10:00:00');
    INSERT INTO applications (application_id, first_name, last_name, email, phone, payload_json, submitted_at) VALUES
      ('PCS-2026-SUBM', 'Sue', 'Mitted', 'submitted@example.com', '555', '{}', '2026-09-20T10:00:00.000Z'),
      ('PCS-2025-WEBB', 'Old', 'Web', 'old@example.com', '555', '{}', '2025-01-01T10:00:00.000Z');
    INSERT INTO onboarding_sessions (session_id, packet_id, packet_version, first_name, last_name, email, status, application_id, user_id) VALUES
      ('s-submitted', 'general_rn', 6, 'Sue', 'Mitted', 'submitted@example.com', 'submitted', 'PCS-2026-SUBM', 10),
      ('s-progress', 'general_rn', 6, 'Pro', 'Gress', 'progress@example.com', 'active', NULL, 11);
    INSERT INTO application_documents (id, application_id, object_key, file_name, file_size, uploaded_at, doc_type) VALUES
      (1, 'PCS-2026-SUBM', 'uploads/10/cpr.jpg', 'cpr.jpg', 10, 'x', 'cpr_cert'),
      (2, 'PCS-2025-WEBB', 'uploads/old/a.pdf', 'a.pdf', 10, 'x', NULL);
    INSERT INTO audit_logs (id, application_id, action, metadata_json, created_at) VALUES
      (1, 'PCS-2026-SUBM', 'application_submitted', '{"source":"mobile_session"}', '2026-09-20T10:00:00.000Z'),
      (2, 'PCS-2025-WEBB', 'application_submitted', '{"source":"web_onboarding"}', '2025-01-01T10:00:00.000Z'),
      (3, 'PCS-2026-SUBM', 'i9_pdf_generated', NULL, '2026-09-20T10:00:01.000Z');
  `);
  const snapshot = (table: string) => all(db, `SELECT * FROM ${table} ORDER BY 1`);
  const before = {
    users: snapshot('users'), applications: snapshot('applications'), sessions: snapshot('onboarding_sessions'),
    documents: snapshot('application_documents'), audit: all(db, 'SELECT id, application_id, action, metadata_json, created_at, session_id FROM audit_logs ORDER BY id'),
    invites: all(db, 'SELECT id, email, token_hash, expires_at, used_at, revoked_at, created_by, created_at FROM onboarding_invites ORDER BY id'),
  };

  apply(db, after(6));

  it('preserves users, applications, sessions, documents and invitations exactly', () => {
    expect(snapshot('users')).toEqual(before.users);
    expect(snapshot('applications')).toEqual(before.applications);
    expect(snapshot('onboarding_sessions')).toEqual(before.sessions);
    expect(all(db, 'SELECT id, application_id, object_key, file_name, file_size, uploaded_at, session_id, doc_type FROM application_documents ORDER BY id')).toEqual(before.documents);
    expect(all(db, 'SELECT id, email, token_hash, expires_at, used_at, revoked_at, created_by, created_at FROM onboarding_invites ORDER BY id')).toEqual(before.invites);
  });

  it('preserves every audit entry, with its id, through the rebuild', () => {
    expect(all(db, 'SELECT id, application_id, action, metadata_json, created_at, session_id FROM audit_logs ORDER BY id')).toEqual(before.audit);
  });

  it('backfills one clinician per account, linked, named from the session, created by the inviter', () => {
    expect(all(db, 'SELECT email, first_name, last_name, user_id, created_by FROM clinicians WHERE user_id IS NOT NULL ORDER BY user_id')).toEqual([
      { email: 'submitted@example.com', first_name: 'Sue', last_name: 'Mitted', user_id: 10, created_by: 1 },
      { email: 'progress@example.com', first_name: 'Pro', last_name: 'Gress', user_id: 11, created_by: 1 },
      { email: 'registered@example.com', first_name: null, last_name: null, user_id: 12, created_by: 1 },
    ]);
  });

  it('backfills one clinician per still-invited email, but none for a revoked-only invitation or a historical web application', () => {
    expect(all(db, 'SELECT email FROM clinicians WHERE user_id IS NULL')).toEqual([{ email: 'pending@example.com' }]);
    expect(get(db, `SELECT COUNT(*) AS n FROM clinicians WHERE email IN ('revoked@example.com', 'old@example.com')`)).toEqual({ n: 0 });
  });

  it('links every invitation to its clinician, except a revoked-only one', () => {
    const links = all(db, 'SELECT i.id, c.email FROM onboarding_invites i LEFT JOIN clinicians c ON c.id = i.clinician_id ORDER BY i.id');
    expect(links).toEqual([
      { id: 1, email: 'submitted@example.com' }, { id: 2, email: 'progress@example.com' }, { id: 3, email: 'registered@example.com' },
      { id: 4, email: 'pending@example.com' }, { id: 5, email: 'pending@example.com' }, { id: 6, email: null },
    ]);
  });

  it('links existing application audit entries to the clinician who submitted, leaving historical ones unlinked', () => {
    const submitted = get(db, `SELECT id FROM clinicians WHERE user_id = 10`)!.id;
    expect(all(db, 'SELECT id, clinician_id FROM audit_logs ORDER BY id')).toEqual([
      { id: 1, clinician_id: submitted }, { id: 2, clinician_id: null }, { id: 3, clinician_id: submitted },
    ]);
  });

  it('defaults every workflow field safely for existing clinicians', () => {
    const rows = all(db, 'SELECT on_hold_at, cleared_at, background_check_status, reference_verification_status, i9_verification_status, w4_verification_status, interview_status, resume_object_key FROM clinicians');
    for (const row of rows) {
      expect(row).toEqual({
        on_hold_at: null, cleared_at: null, background_check_status: 'not_started', reference_verification_status: 'not_started',
        i9_verification_status: 'not_started', w4_verification_status: 'not_started', interview_status: null, resume_object_key: null,
      });
    }
    expect(all(db, 'SELECT DISTINCT use_candidate_resume FROM onboarding_invites')).toEqual([{ use_candidate_resume: 0 }]);
    expect(get(db, 'SELECT COUNT(*) AS n FROM application_documents WHERE superseded_at IS NOT NULL')).toEqual({ n: 0 });
    expect(get(db, 'SELECT COUNT(*) AS n FROM document_reviews')).toEqual({ n: 0 });
  });

  it('new audit ids continue after the preserved ones', () => {
    db.prepare(`INSERT INTO audit_logs (action, created_at) VALUES ('candidate_created', 'x')`).run();
    expect(get(db, `SELECT MAX(id) AS id FROM audit_logs`)).toEqual({ id: 4 });
  });
});
