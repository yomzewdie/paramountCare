export interface AuditLogRow {
  id: number;
  application_id: string;
  action: string;
  metadata_json: string | null;
  created_at: string;
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
