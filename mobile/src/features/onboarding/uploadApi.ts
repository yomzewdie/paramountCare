import { env } from '../../config/env';
import { authenticatedFetch } from '../../services/apiClient';
import { toAppError, networkFailureToAppError, type AppError } from '../../utils/errors';
import type { UploadedFile } from '@pcs/shared';

/** A file the applicant just picked, before it has been uploaded — a device
 * URI plus the metadata the Worker's multipart guard needs, never a real
 * web File/Blob (there is no such thing on React Native). */
export interface PickedFile {
  uri: string;
  name: string;
  type: string;   // MIME type
  size?: number;
}

export type UploadFileResult =
  | { ok: true; data: UploadedFile }
  | { ok: false; error: AppError };

/**
 * POSTs a picked file to the now-authenticated `/api/uploads` Worker route
 * (M13 — see worker/src/routes/uploads.ts) and returns the resulting
 * `UploadedFile` (name/size/type + the server-issued objectKey/uploadedAt).
 * `authenticatedFetch` attaches the applicant's own bearer token — the
 * Worker derives ownership entirely from that token, never from anything
 * in this request body. Reusable by any future attachment (not just
 * Direct Deposit's voided check) — nothing here is Direct-Deposit-specific.
 */
export async function uploadFile(picked: PickedFile): Promise<UploadFileResult> {
  const body = new FormData();
  // React Native's FormData accepts this {uri, name, type} shape for a file
  // part — the RN bridge streams the file at `uri` directly; this is not a
  // real Blob/File instance the way a browser's FormData.append would take.
  body.append('file', { uri: picked.uri, name: picked.name, type: picked.type } as unknown as Blob);

  let res: Response;
  try {
    res = await authenticatedFetch(`${env.apiBaseUrl}/api/uploads`, { method: 'POST', body });
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }

  const json = await res.json().catch(() => undefined);

  if (!res.ok) {
    return { ok: false, error: toAppError(res.status, json as { error?: string } | undefined, 'upload') };
  }

  const payload = json as { objectKey: string; fileName: string; fileSize: number; uploadedAt: string };
  return {
    ok: true,
    data: {
      name: payload.fileName,
      size: payload.fileSize,
      type: picked.type,
      objectKey: payload.objectKey,
      uploadedAt: payload.uploadedAt,
    },
  };
}

export type DeleteUploadResult = { ok: true } | { ok: false; error: AppError };

/**
 * `DELETE /api/uploads` (M13 hardening §3/§7) — deletes an object the
 * caller themselves uploaded. Used for two distinct cases: an explicit
 * applicant Remove/Replace action (via SessionContext.removeDocument,
 * which goes through the session-slot delete route instead so the
 * session's own reference is cleared first — see useDirectDepositForm.ts),
 * and best-effort orphan cleanup here directly when a freshly uploaded
 * object fails to ever get associated with a session at all. Failures are
 * swallowed by design at call sites that treat this as best-effort — this
 * function itself still reports them accurately.
 */
export async function deleteUpload(objectKey: string): Promise<DeleteUploadResult> {
  try {
    const res = await authenticatedFetch(`${env.apiBaseUrl}/api/uploads`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectKey }),
    });
    if (!res.ok) {
      const json = await res.json().catch(() => undefined);
      return { ok: false, error: toAppError(res.status, json as { error?: string } | undefined, 'upload') };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: networkFailureToAppError(err) };
  }
}
