export interface DocumentRow {
  id: number;
  application_id: string;
  object_key: string;
  file_name: string;
  file_size: number;
  uploaded_at: string;
}

export interface InsertDocumentParams {
  applicationId: string;
  objectKey: string;
  fileName: string;
  fileSize: number;
  uploadedAt: string;
}

export function insertDocumentStmt(
  db: D1Database,
  p: InsertDocumentParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO application_documents
         (application_id, object_key, file_name, file_size, uploaded_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(p.applicationId, p.objectKey, p.fileName, p.fileSize, p.uploadedAt);
}

export async function findDocumentsByApplicationId(
  db: D1Database,
  applicationId: string,
): Promise<DocumentRow[]> {
  const result = await db
    .prepare('SELECT * FROM application_documents WHERE application_id = ? ORDER BY id ASC')
    .bind(applicationId)
    .all<DocumentRow>();
  return result.results;
}
