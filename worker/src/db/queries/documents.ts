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

/**
 * M16 hardening (I-9 durability follow-up): the same conditional-INSERT
 * technique `db/queries/submission.ts` already uses for the main
 * submission batch — `INSERT ... SELECT ... WHERE NOT EXISTS (...)` — is
 * a single atomic statement, not a separate check-then-insert round trip,
 * so it is safe under two genuinely concurrent callers racing to record
 * the SAME (application_id, object_key) pair: whichever executes first
 * (D1/SQLite serializes writes) wins and inserts; the other's own
 * WHERE NOT EXISTS now evaluates false against that just-committed row,
 * so it affects zero rows rather than creating a duplicate. Callers check
 * `result.meta.changes` to know whether THEIR call is the one that
 * actually created the record (used by services/submission.ts to decide
 * whether to send confirmation emails exactly once, not once per racing
 * caller). No new schema/constraint needed — this is exactly the same
 * technique already proven for the submission batch itself, applied here
 * to close the one spot that was still a plain, non-idempotent INSERT.
 */
export function insertDocumentIfNotExistsStmt(
  db: D1Database,
  p: InsertDocumentParams,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO application_documents
         (application_id, object_key, file_name, file_size, uploaded_at)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM application_documents WHERE application_id = ? AND object_key = ?
       )`,
    )
    .bind(p.applicationId, p.objectKey, p.fileName, p.fileSize, p.uploadedAt, p.applicationId, p.objectKey);
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

/**
 * Generic admin document download (Official Forms Audit finding): looks up
 * a document by its own id AND requires it to belong to the given
 * applicationId in the same query — an id that exists but belongs to a
 * different application simply matches no row, rather than being fetched
 * and checked afterward. This is the ownership check itself, not a
 * pre-check for one done elsewhere — a caller can never pass an arbitrary
 * R2 object key directly; only a (documentId, applicationId) pair that this
 * query has already verified belong together ever reaches R2.
 */
export async function findDocumentByIdForApplication(
  db: D1Database,
  documentId: number,
  applicationId: string,
): Promise<DocumentRow | null> {
  const row = await db
    .prepare('SELECT * FROM application_documents WHERE id = ? AND application_id = ?')
    .bind(documentId, applicationId)
    .first<DocumentRow>();
  return row ?? null;
}

/**
 * M16 hardening (ADR-029 addendum): is this exact R2 object referenced by
 * ANY submitted application's document manifest? Reference promotion
 * (`uploaded_documents.object_key` -> `application_documents.object_key`,
 * no R2 copy — see services/submission.ts) only works as a durable
 * post-submission record if the underlying object is guaranteed to
 * outlive the applicant's own ordinary upload-cleanup lifecycle. This is
 * the one query that answers "would deleting this object leave a
 * submitted application's document manifest dangling" — checked by the
 * DB relationship itself, never by an object-key naming convention.
 */
export async function isObjectPromoted(db: D1Database, objectKey: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM application_documents WHERE object_key = ? LIMIT 1')
    .bind(objectKey)
    .first();
  return row !== null;
}
