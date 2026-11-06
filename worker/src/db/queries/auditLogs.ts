export interface AuditLogRow {
  id: number;
  /** NULL for an event before (or without) a submitted application. */
  application_id: string | null;
  action: string;
  metadata_json: string | null;
  created_at: string;
  session_id: string | null;
  clinician_id: number | null;
}

export interface InsertAuditLogParams {
  applicationId: string;
  action: string;
  metadataJson?: string | null;
  createdAt: string;
}

export function insertAuditLogStmt(
  db: D1Database,
  p: InsertAuditLogParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO audit_logs (application_id, action, metadata_json, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(p.applicationId, p.action, p.metadataJson ?? null, p.createdAt);
}

/** An event about a clinician, at any point in their lifecycle — before an
 * invitation, during onboarding, or after submission. */
export interface ClinicianAuditEvent {
  clinicianId: number;
  action: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  applicationId?: string | null;
  sessionId?: string | null;
}

const CLINICIAN_AUDIT_INSERT = `INSERT INTO audit_logs (clinician_id, application_id, session_id, action, metadata_json, created_at)`;

function auditValues(e: ClinicianAuditEvent): (string | number | null)[] {
  return [e.clinicianId, e.applicationId ?? null, e.sessionId ?? null, e.action, JSON.stringify(e.metadata), e.createdAt];
}

export function insertClinicianAuditStmt(db: D1Database, e: ClinicianAuditEvent): D1PreparedStatement {
  return db.prepare(`${CLINICIAN_AUDIT_INSERT} VALUES (?, ?, ?, ?, ?, ?)`).bind(...auditValues(e));
}

/**
 * Recorded only if the statement immediately before it in the same batch
 * changed a row. A batch runs its statements in order, in one transaction, so
 * a guarded UPDATE and this audit entry either both happen or neither does —
 * two racing requests produce one change and one entry.
 */
export function insertClinicianAuditIfChangedStmt(db: D1Database, e: ClinicianAuditEvent): D1PreparedStatement {
  return db.prepare(`${CLINICIAN_AUDIT_INSERT} SELECT ?, ?, ?, ?, ?, ? WHERE changes() > 0`).bind(...auditValues(e));
}

export async function findAuditLogsByApplicationId(
  db: D1Database,
  applicationId: string,
): Promise<AuditLogRow[]> {
  const result = await db
    .prepare('SELECT * FROM audit_logs WHERE application_id = ? ORDER BY id ASC')
    .bind(applicationId)
    .all<AuditLogRow>();
  return result.results;
}

/** Everything audited about a clinician, and about their application. */
export async function findAuditLogsForClinician(db: D1Database, clinicianId: number, applicationId: string | null): Promise<AuditLogRow[]> {
  const result = await db
    .prepare('SELECT * FROM audit_logs WHERE clinician_id = ? OR (? IS NOT NULL AND application_id = ?) ORDER BY id ASC')
    .bind(clinicianId, applicationId, applicationId)
    .all<AuditLogRow>();
  return result.results;
}
