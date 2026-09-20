import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { generateObjectKey } from '../utils/objectKey';
import { requireAuth } from '../middleware/requireAuth';
import { requireApplicant } from '../middleware/requireApplicant';
import { insertUploadedDocument } from '../db/queries/uploadedDocuments';
import { deleteOwnedUpload } from '../services/documents';

// Exported so other routes that serve already-uploaded files back (the
// generic admin document download route in routes/admin.ts) can validate
// against the exact same allowlist a file was accepted under, rather than
// duplicating it.
export const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

const uploads = new Hono<AppEnv>();

// M13: this route was previously reachable with no credentials at all —
// anyone could upload arbitrary files to R2 with no association to any
// applicant. Same requireAuth + requireApplicant pairing as sessions.ts
// (an admin's valid token must not be usable here either — defense in
// depth, not just "any authenticated caller").
uploads.use('*', requireAuth);
uploads.use('*', requireApplicant);

uploads.post('/', async (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) {
    // requireAuth/requireApplicant already guarantee this is unreachable —
    // fail honestly rather than proceed with an undefined owner, matching
    // the same defensive pattern sessions.ts uses.
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  let formData: FormData;
  try {
    formData = await c.req.raw.formData();
  } catch {
    return c.json({ success: false, error: 'Expected multipart/form-data.' }, 400);
  }

  const entry = formData.get('file');
  if (!(entry instanceof File)) {
    return c.json({ success: false, error: 'Missing or invalid field: file.' }, 400);
  }

  if (!ALLOWED_TYPES.has(entry.type)) {
    return c.json(
      { success: false, error: `Unsupported file type '${entry.type}'. Allowed: PDF, JPG, PNG.` },
      415,
    );
  }

  if (entry.size > MAX_SIZE) {
    return c.json({ success: false, error: 'File exceeds the 10 MB size limit.' }, 413);
  }

  const objectKey = generateObjectKey(payload.uid, entry.name);
  const uploadedAt = new Date().toISOString();

  try {
    await c.env.UPLOADS_BUCKET.put(objectKey, await entry.arrayBuffer(), {
      httpMetadata: {
        contentType: entry.type,
        contentDisposition: `attachment; filename="${entry.name}"`,
      },
    });
  } catch (e) {
    console.error('[uploads] R2 put failed:', e);
    return c.json({ success: false, error: 'Storage error. Please try again.' }, 500);
  }

  // M13 hardening: record who actually uploaded this object, at the moment
  // it happens — the durable record every later association/delete request
  // is checked against, not the objectKey string's own shape. If this write
  // fails, the object in R2 would otherwise be a live, unowned artifact no
  // authorization check could ever legitimately grant access to (not even
  // its own uploader) — so the upload as a whole must not be reported
  // successful, and the orphaned R2 bytes are cleaned up immediately rather
  // than left behind.
  try {
    await insertUploadedDocument(c.env.DB, {
      objectKey,
      userId: payload.uid,
      fileName: entry.name,
      fileSize: entry.size,
      contentType: entry.type,
      uploadedAt,
    });
  } catch (e) {
    console.error('[uploads] ownership record insert failed:', e);
    try {
      await c.env.UPLOADS_BUCKET.delete(objectKey);
    } catch (cleanupErr) {
      console.error('[uploads] cleanup of unrecorded upload failed:', cleanupErr);
    }
    return c.json({ success: false, error: 'Storage error. Please try again.' }, 500);
  }

  return c.json(
    {
      success: true,
      objectKey,
      fileName: entry.name,
      fileSize: entry.size,
      uploadedAt,
    },
    201,
  );
});

const deleteUploadSchema = z.object({
  objectKey: z.string().min(1, 'objectKey is required'),
});

// ── DELETE /api/uploads — the one authenticated delete capability (M13 §3) ──
//
// Deliberately narrow: deletes exactly one object the caller themselves
// uploaded, identified by the exact objectKey the earlier POST returned to
// them. Not a general file-management API — there is no listing, no
// browsing, no path other than "delete something I own and can already
// name precisely."
uploads.delete('/', async (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ success: false, error: 'Unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON' }, 400);
  }

  const parsed = deleteUploadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, error: 'Validation failed' }, 422);
  }

  const result = await deleteOwnedUpload(c.env, { objectKey: parsed.data.objectKey, userId: payload.uid });

  if (!result.ok) {
    if (result.reason === 'not_found') {
      // Non-disclosing, matching sessions.ts's ownership-mismatch
      // convention: a caller with no legitimate claim to this objectKey
      // cannot distinguish "belongs to someone else" from "never existed"
      // from "already deleted."
      return c.json({ success: false, error: 'File not found.' }, 404);
    }
    if (result.reason === 'promoted') {
      // M16 hardening: this object is referenced by a submitted
      // application's document manifest (services/documents.ts's
      // isObjectPromoted) — never retryable, so a distinct 409 rather
      // than the retry-suggesting 500 below (retrying a promoted-file
      // deletion would just fail identically forever).
      return c.json({ success: false, error: 'This file is part of a submitted application and can no longer be deleted.' }, 409);
    }
    // Raw R2/D1 errors are never exposed — see services/documents.ts.
    return c.json({ success: false, error: 'Storage error. Please try again.' }, 500);
  }

  return c.json({ success: true }, 200);
});

export { uploads };
