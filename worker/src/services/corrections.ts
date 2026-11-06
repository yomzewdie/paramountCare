import { docTypesForRequirement, documentAttachmentsFor } from '@pcs/shared';
import { findReviewsForClinician } from '../db/queries/documentReviews';
import { findOwnedUpload } from '../db/queries/uploadedDocuments';
import { insertCorrectionDocumentStmt } from '../db/queries/documents';

// ── Targeted corrections: keeping the application's documents in step ──────
//
// A correction to a submitted requirement changes the applicant's session
// first (the authoritative list of their files), then the application's own
// document records. Those are separate writes — and R2 can't share a D1
// transaction anyway — so instead of pretending they're atomic, this makes the
// application's CURRENT documents for every requirement under an open
// correction match exactly what the session holds:
//  - a file the session holds that the application lacks is added (from the
//    applicant's own upload record — never a client-supplied value);
//  - a file the application lists that the session no longer holds is
//    superseded (kept, never deleted — it was submitted);
//  - a superseded file the session holds again is current again.
// It is idempotent: run it again and nothing changes. It runs after every
// correction change and whenever the applicant or an admin next looks, so a
// step that failed part-way is repaired on the next request without the
// applicant uploading anything again.

interface CorrectionSession {
  session_id: string;
  user_id: number | null;
  application_id: string | null;
  form_data_json: string;
}

export async function reconcileCorrectionDocuments(db: D1Database, session: CorrectionSession, clinicianId: number): Promise<void> {
  if (!session.application_id || session.user_id === null) return;
  const open = (await findReviewsForClinician(db, clinicianId)).filter((r) => r.correction_open);
  if (open.length === 0) return;

  let formData: Record<string, unknown> = {};
  try { formData = JSON.parse(session.form_data_json || '{}'); } catch { /* nothing to reconcile against */ }
  const docTypes = open.flatMap((r) => docTypesForRequirement(r.requirement));
  const applicationId = session.application_id;
  const documents = (await db
    .prepare(`SELECT id, object_key, doc_type, superseded_at FROM application_documents WHERE application_id = ? AND doc_type IN (${docTypes.map(() => '?').join(', ')})`)
    .bind(applicationId, ...docTypes)
    .all<{ id: number; object_key: string; doc_type: string; superseded_at: string | null }>()).results;

  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const docType of docTypes) {
    const held = documentAttachmentsFor(formData, docType).map((f) => f.objectKey).filter((key): key is string => !!key);
    for (const objectKey of held) {
      const existing = documents.find((d) => d.object_key === objectKey);
      if (existing) {
        if (existing.superseded_at) statements.push(db.prepare('UPDATE application_documents SET superseded_at = NULL WHERE id = ?').bind(existing.id));
        continue;
      }
      const upload = await findOwnedUpload(db, { objectKey, userId: session.user_id });
      if (!upload) continue;
      statements.push(insertCorrectionDocumentStmt(db, {
        applicationId, objectKey, fileName: upload.file_name, fileSize: upload.file_size, uploadedAt: upload.uploaded_at, sessionId: session.session_id, docType,
      }));
    }
    for (const doc of documents) {
      if (doc.doc_type === docType && !doc.superseded_at && !held.includes(doc.object_key)) {
        statements.push(db.prepare('UPDATE application_documents SET superseded_at = ? WHERE id = ? AND superseded_at IS NULL').bind(now, doc.id));
      }
    }
  }
  if (statements.length > 0) await db.batch(statements);
}
