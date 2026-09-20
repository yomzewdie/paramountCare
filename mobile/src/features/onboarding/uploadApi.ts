import { File } from 'expo-file-system';
import { env } from '../../config/env';
import { authenticatedFetch, UPLOAD_TIMEOUT_MS } from '../../services/apiClient';
import { toAppError, networkFailureToAppError, appError, type AppError } from '../../utils/errors';
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
 * Confirmed root cause (physical UAT diagnostic, Build #6 — later verified
 * fixed on physical hardware in Build #7): this app's global `fetch` is
 * Expo SDK 57's own WinterCG-compliant implementation, installed as the
 * global `fetch` by expo/src/winter/runtime.native.ts unless
 * `EXPO_PUBLIC_USE_RN_FETCH` is set (grepped — this project never sets it).
 * Its multipart serializer (expo/src/winter/fetch/convertFormData.ts) only
 * accepts a FormData part that is a string, a real `Blob` instance, or an
 * object exposing `.bytes()` — anything else hits its final
 * `throw new Error('Unsupported FormDataPart implementation')`, which is
 * exactly what a physical device hit. The legacy React Native
 * `{uri, name, type}` shape previously appended below matched none of those
 * three. (React Native's own `FormData.append` is separately monkey-patched
 * by expo/src/winter/FormData.ts to keep accepting that `{uri,...}` shape
 * for its own historical proprietary part kind, but that patch has no
 * effect on what Expo's *own* serializer will later accept — it just stores
 * the value verbatim, and lets it fail at serialization.)
 *
 * Fix: read the file through expo-file-system's `File` (already a direct
 * dependency at ~57.0.7, already used elsewhere in this app) and wrap it in
 * the `Blob`-shaped object convertFormData already has a dedicated branch
 * for. A bare `File` instance's own `.name`/`.type` getters derive from the
 * URI's on-disk basename / native-detected MIME type, which is not
 * guaranteed to match the applicant-facing filename/MIME `uploadFile`
 * already carries as `picked.name`/`picked.type` (e.g. a picker-generated
 * cache filename, or a HEIC source normalized to a differently-named `.jpg`
 * output) — and FormData.append's optional 3rd `filename` argument does
 * NOT override it either (installFormDataPatch's `normalizeArgs` only
 * applies that override when the appended value is `instanceof Blob`,
 * which a `File` instance never is — verified directly against the
 * installed SDK's source, not assumed). So this wrapper owns `name`/`type`
 * explicitly rather than deferring to the File's own getters, while still
 * delegating the actual byte read to the File's native implementation —
 * never manually decoding into JS memory, and never hand-building a `Blob`
 * from raw bytes, which React Native's own `Blob` cannot do without a
 * private Expo-internal native bridge call (see
 * expo/src/winter/fetch/createBlob.ts's own comment on exactly this).
 *
 * No cast is used or needed: this object structurally satisfies the `Blob`
 * interface TypeScript already expects for `FormData.append`'s 2nd
 * parameter, so `body.append('file', part)` type-checks as a real `Blob`
 * on its own.
 */
export function toUploadFormDataPart(uri: string, name: string, type: string) {
  const file = new File(uri);
  return {
    name,
    type,
    get size(): number { return file.size; },
    arrayBuffer: (): Promise<ArrayBuffer> => file.arrayBuffer(),
    bytes: (): Promise<Uint8Array<ArrayBuffer>> => file.bytes(),
    text: (): Promise<string> => file.text(),
    slice: (start?: number, end?: number, contentType?: string): Blob => file.slice(start, end, contentType),
    stream: (): ReadableStream<Uint8Array<ArrayBuffer>> => file.stream(),
  };
}

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
  let body: FormData;
  try {
    body = new FormData();
    body.append('file', toUploadFormDataPart(picked.uri, picked.name, picked.type));
  } catch {
    // FormData construction/append runs entirely on-device, before any
    // network activity — a synchronous throw here is a local file-
    // preparation failure, not a network failure, so it must not be
    // reported as "Unable to reach Paramount Care" (that would send the
    // applicant chasing their connection for a problem their connection
    // had nothing to do with). Kept wrapped rather than left to propagate:
    // useFileAttachment.doUpload has no try/catch of its own around this
    // call, so an uncaught throw here would leave attachment state stuck
    // at 'uploading' forever instead of surfacing a retryable failure.
    return { ok: false, error: appError('unknown') };
  }

  let res: Response;
  try {
    // A longer timeout than the default request ceiling (see apiClient.ts's
    // own doc comment) — a multi-MB photo (a lossless PNG especially) can
    // legitimately still be uploading past the default 15s on a real,
    // merely-slow connection; using the short ceiling here was
    // misclassifying a genuinely-still-in-flight upload as unreachable.
    res = await authenticatedFetch(`${env.apiBaseUrl}/api/uploads`, { method: 'POST', body }, UPLOAD_TIMEOUT_MS);
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
