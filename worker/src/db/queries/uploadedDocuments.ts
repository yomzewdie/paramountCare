// The uploaded-document ownership ledger (migrations/0006). One row per
// real upload event, created at upload time — see routes/uploads.ts. This
// is the durable record association/deletion endpoints check an incoming
// objectKey against, rather than trusting the key's own `uploads/<uid>/...`
// shape alone ("object-key secrecy is never treated as authorization").

export interface UploadedDocumentRow {
  id: number;
  object_key: string;
  user_id: number;
  session_id: string | null;
  doc_type: string | null;
  file_name: string;
  file_size: number;
  content_type: string;
  uploaded_at: string;
  deleted_at: string | null;
}

export interface InsertUploadedDocumentParams {
  objectKey: string;
  userId: number;
  fileName: string;
  fileSize: number;
  contentType: string;
  uploadedAt: string;
}

export async function insertUploadedDocument(
  db: D1Database,
  p: InsertUploadedDocumentParams,
): Promise<UploadedDocumentRow> {
  const row = await db
    .prepare(
      `INSERT INTO uploaded_documents (object_key, user_id, file_name, file_size, content_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(p.objectKey, p.userId, p.fileName, p.fileSize, p.contentType, p.uploadedAt)
    .first<UploadedDocumentRow>();
  if (!row) throw new Error('insertUploadedDocument: RETURNING clause produced no row');
  return row;
}

/**
 * The one authorization check every association/delete path uses: does a
 * live (not soft-deleted) upload with this exact objectKey exist, and does
 * it belong to this exact authenticated user? Covers cross-user objects,
 * forged/never-uploaded keys, and already-deleted objects with a single
 * query — all three simply fail to match a row.
 */
export async function findOwnedUpload(
  db: D1Database,
  p: { objectKey: string; userId: number },
): Promise<UploadedDocumentRow | null> {
  return db
    .prepare('SELECT * FROM uploaded_documents WHERE object_key = ? AND user_id = ? AND deleted_at IS NULL LIMIT 1')
    .bind(p.objectKey, p.userId)
    .first<UploadedDocumentRow>();
}

/**
 * Every live (not soft-deleted) upload currently associated with a session,
 * across every doc_type — the authoritative source for document promotion
 * at final submission (M16). Deliberately queries this ledger directly
 * rather than trusting the file list embedded in a session's own
 * form_data_json: even though `formData.uploadedDocuments`/
 * `directDepositProofDocument` values only ever arrive via the
 * ownership-verified association endpoint (never client-writable directly —
 * see validation.ts's own comment), re-deriving the promotion set from the
 * ledger itself — scoped to (session_id, live only) — is the same
 * "never trust the client-shaped blob for something a durable server
 * record can answer more directly" discipline uploads.ts/documents.ts
 * already apply everywhere else.
 */
export async function findLiveUploadsForSession(
  db: D1Database,
  p: { sessionId: string; userId: number },
): Promise<UploadedDocumentRow[]> {
  const result = await db
    .prepare('SELECT * FROM uploaded_documents WHERE session_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id ASC')
    .bind(p.sessionId, p.userId)
    .all<UploadedDocumentRow>();
  return result.results;
}

/** Whatever currently occupies a given session's document slot, if
 * anything — used to know what to clean up after a successful replace, and
 * what to delete on an explicit remove. */
export async function findCurrentSlotDocument(
  db: D1Database,
  p: { sessionId: string; docType: string },
): Promise<UploadedDocumentRow | null> {
  return db
    .prepare('SELECT * FROM uploaded_documents WHERE session_id = ? AND doc_type = ? AND deleted_at IS NULL LIMIT 1')
    .bind(p.sessionId, p.docType)
    .first<UploadedDocumentRow>();
}

/** Marks an upload as now occupying a given session's document slot.
 * Scoped by object_key alone since callers always call this only after
 * findOwnedUpload has already confirmed ownership of that exact key. */
export async function associateUploadToSlot(
  db: D1Database,
  p: { objectKey: string; sessionId: string; docType: string },
): Promise<void> {
  await db
    .prepare('UPDATE uploaded_documents SET session_id = ?, doc_type = ? WHERE object_key = ?')
    .bind(p.sessionId, p.docType, p.objectKey)
    .run();
}

/**
 * Soft-deletes an owned upload — scoped by (object_key, user_id) so a
 * caller can never mark another user's row deleted even if this function
 * were ever called without an upstream ownership check. Returns whether a
 * row was actually changed, so "already deleted" and "never existed" can
 * both be handled as a no-op rather than an error.
 */
export async function markUploadDeleted(
  db: D1Database,
  p: { objectKey: string; userId: number },
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE uploaded_documents SET deleted_at = datetime('now')
       WHERE object_key = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .bind(p.objectKey, p.userId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
