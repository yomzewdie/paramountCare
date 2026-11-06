import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { ALLOWED_TYPES as ALLOWED_UPLOAD_CONTENT_TYPES } from '../routes/uploads';
import { buildContentDisposition, buildInlineContentDisposition } from '../utils/contentDisposition';
import { RENDERED_PAGE_CSP, WORD_CONTENT_TYPES, renderWordDocument } from './wordPreview';

// Serving a private R2 object to an admin: by a key the server looked up
// itself (never one a client supplied), under the protected-file headers.

/** Serves a stored file under the protected-file headers. The content type
 * is the one recorded when the file was stored, and only if it is still on
 * the upload allowlist — anything else is an opaque download. A preview,
 * judged by that recorded type and never the file name, is:
 *  - a PDF, JPEG or PNG: the file itself, inline;
 *  - a Word document (.doc, .docx): rendered here into a sanitized,
 *    script-free page (services/wordPreview.ts) under a sandboxing CSP — 422
 *    if it can't be read, when the original stays downloadable;
 *  - anything else (files with no recorded type): refused with 415. */
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

  if (mode === 'preview' && WORD_CONTENT_TYPES.has(contentType)) {
    const html = await renderWordDocument(new Uint8Array(await obj.arrayBuffer()), contentType, fileName);
    if (!html) return c.json({ error: 'This Word document could not be displayed. Download the original to open it.' }, 422);
    const headers = new Headers();
    headers.set('Content-Type',            'text/html; charset=utf-8');
    headers.set('Content-Disposition',     buildInlineContentDisposition(fileName));
    headers.set('Content-Security-Policy', RENDERED_PAGE_CSP);
    headers.set('Cache-Control',           'private, no-store');
    headers.set('X-Content-Type-Options',  'nosniff');
    return new Response(html, { headers });
  }

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

