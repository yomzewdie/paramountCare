import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ALLOWED_TYPES as ALLOWED_UPLOAD_CONTENT_TYPES } from '../routes/uploads';
import { buildContentDisposition, buildInlineContentDisposition } from '../utils/contentDisposition';

// Serving a private R2 object to an admin: by a key the server looked up
// itself (never one a client supplied), under the protected-file headers.

/** Serves a stored file under the protected-file headers. The content type
 * is the one recorded when the file was stored, and only if it is still on
 * the upload allowlist — anything else is an opaque download. A preview is
 * inline and only for a PDF, JPEG or PNG — judged by that recorded type,
 * never the file name; anything else (Word resumes, files with no recorded
 * type) is refused with 415 and stays download-only. */
export async function serveStoredFile(c: Context<AppEnv>, objectKey: string, fileName: string, mode: 'download' | 'preview'): Promise<Response> {
  const obj = await c.env.UPLOADS_BUCKET.get(objectKey);
  if (!obj) return c.json({ error: 'Document file not found in storage' }, 404);

  // Never trust whatever content-type happens to be stored on the R2
  // object's own metadata beyond the same allowlist uploads were accepted
  // under in the first place — an unexpected/unrecognized type is served as
  // a forced download (application/octet-stream) rather than something a
  // browser might try to render inline.
  const storedContentType = obj.httpMetadata?.contentType ?? '';
  const contentType = ALLOWED_UPLOAD_CONTENT_TYPES.has(storedContentType)
    ? storedContentType
    : 'application/octet-stream';

  if (mode === 'preview' && !INLINE_PREVIEW_CONTENT_TYPES.has(contentType)) {
    await obj.body.cancel();
    return c.json({ error: 'Preview is not available for this file type.' }, 415);
  }

  const headers = new Headers();
  headers.set('Content-Type',           contentType);
  headers.set('Content-Disposition',    mode === 'preview' ? buildInlineContentDisposition(fileName) : buildContentDisposition(fileName));
  headers.set('Cache-Control',          'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(obj.body, { headers });
}

export const INLINE_PREVIEW_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png']);

