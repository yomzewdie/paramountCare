import { findOwnedUpload, markUploadDeleted } from '../db/queries/uploadedDocuments';

export type DeleteOwnedUploadResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'storage_error' };

/**
 * The one real delete capability for an applicant's own uploaded document
 * (M13 hardening §3) — shared by the standalone `DELETE /api/uploads` route
 * (orphan cleanup after a failed association) and `sessions.ts`'s
 * document-slot remove/replace logic, so there is exactly one place that
 * decides "does this row exist and belong to this user" before anything is
 * physically deleted.
 *
 * Ordering matters: the R2 delete happens first, the D1 soft-delete second.
 * If the R2 delete succeeds but the D1 write fails, the object is gone but
 * still shows as "not deleted" in the ledger — a stale-but-safe state (a
 * future association attempt against that key would still be rejected,
 * since the object no longer exists in R2 if anyone ever tried to read it;
 * the row simply lingers as bookkeeping debt, never a security gap). The
 * reverse ordering (D1 first) would risk the opposite and worse outcome — a
 * row marked deleted while the real object still sits in R2, indistinguishable
 * from a successful delete to any future audit.
 *
 * Never throws — a storage-layer failure comes back as `{ok: false, reason:
 * 'storage_error'}` rather than propagating a raw R2/D1 error, so no caller
 * ever has to guard against this function throwing (M13 hardening §3).
 * Callers decide their own policy on `storage_error`: the dedicated
 * `DELETE /api/uploads` route surfaces a generic failure to the client;
 * best-effort cleanup call sites (replace/remove/orphan cleanup) log it and
 * proceed, documenting the residual orphan risk rather than failing an
 * otherwise-successful operation because of it (M13 hardening §4, §5, §7).
 */
export async function deleteOwnedUpload(
  env: { DB: D1Database; UPLOADS_BUCKET: R2Bucket },
  p: { objectKey: string; userId: number },
): Promise<DeleteOwnedUploadResult> {
  const owned = await findOwnedUpload(env.DB, p);
  if (!owned) return { ok: false, reason: 'not_found' };

  try {
    // R2's delete() is itself idempotent — deleting an already-absent key is
    // not an error — so "missing/already-deleted object handled safely" is
    // satisfied by R2's own semantics here, not extra branching.
    await env.UPLOADS_BUCKET.delete(p.objectKey);
  } catch (e) {
    console.error('[documents] R2 delete failed:', e);
    // Do not mark the ledger row deleted if the object itself might still be
    // present — a residual "still shows as live" row is safer than falsely
    // recording a deletion that didn't happen.
    return { ok: false, reason: 'storage_error' };
  }

  await markUploadDeleted(env.DB, p);
  return { ok: true };
}
