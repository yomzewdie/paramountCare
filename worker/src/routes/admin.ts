import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import {
  findApplicationById,
  listApplications,
  type ApplicationListRow,
} from '../db/queries/applications';
import { findDocumentsByApplicationId, findDocumentByIdForApplication } from '../db/queries/documents';
import { findAuditLogsByApplicationId } from '../db/queries/auditLogs';
import { ALLOWED_TYPES as ALLOWED_UPLOAD_CONTENT_TYPES } from './uploads';

export const admin = new Hono<AppEnv>();

// All routes require a valid admin JWT AND an admin/super_admin role.
//
// The role check matters more than it used to: requireAuth now accepts any
// validly-signed token, including applicant tokens (see
// middleware/requireAuth.ts) — without this requireRole call, a valid
// applicant access token would satisfy requireAuth and reach these
// PII-bearing routes. This closes that gap.
admin.use('*', requireAuth);
admin.use('*', requireRole('admin', 'super_admin'));

// ── GET /api/admin/applications ───────────────────────────────────────────────

admin.get('/applications', async (c) => {
  const db = c.env.DB;
  const page     = Math.max(1, parseInt(c.req.query('page')     ?? '1',  10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '20', 10) || 20));
  const search   = c.req.query('search')?.trim() || undefined;
  const status   = c.req.query('status')?.trim() || undefined;

  const { applications, total } = await listApplications(db, { page, pageSize, search, status });

  return c.json({
    data: applications.map((a: ApplicationListRow) => ({
      applicationId:  a.application_id,
      firstName:      a.first_name,
      lastName:       a.last_name,
      email:          a.email,
      status:         a.status,
      submittedAt:    a.submitted_at,
      documentCount:  a.document_count,
    })),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

// ── GET /api/admin/application/:id ────────────────────────────────────────────

admin.get('/application/:id', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  const [app, docs, logs] = await Promise.all([
    findApplicationById(db, id),
    findDocumentsByApplicationId(db, id),
    findAuditLogsByApplicationId(db, id),
  ]);

  if (!app) return c.json({ error: 'Application not found' }, 404);

  let payload: unknown = null;
  if (app.payload_json) {
    try { payload = JSON.parse(app.payload_json); } catch { payload = null; }
  }

  return c.json({
    id:          app.application_id,
    status:      app.status,
    firstName:   app.first_name,
    lastName:    app.last_name,
    email:       app.email,
    phone:       app.phone,
    submittedAt: app.submitted_at,
    payload,
    documents: docs.map((d) => ({
      id:         d.id,
      objectKey:  d.object_key,
      fileName:   d.file_name,
      fileSize:   d.file_size,
      uploadedAt: d.uploaded_at,
    })),
    auditLogs: logs.map((l) => ({
      id:        l.id,
      action:    l.action,
      metadata:  l.metadata_json
        ? (() => { try { return JSON.parse(l.metadata_json!); } catch { return null; } })()
        : null,
      createdAt: l.created_at,
    })),
  });
});

// ── GET /api/admin/application/:id/i9-pdf ─────────────────────────────────────

admin.get('/application/:id/i9-pdf', async (c) => {
  const id        = c.req.param('id');
  const objectKey = `i9/${id}/i9-section1-signed.pdf`;

  const obj = await c.env.UPLOADS_BUCKET.get(objectKey);
  if (!obj) return c.json({ error: 'Signed I-9 PDF not found for this application' }, 404);

  const headers = new Headers();
  headers.set('Content-Type',        'application/pdf');
  headers.set('Content-Disposition', `attachment; filename="I9-Section1-${id}.pdf"`);
  headers.set('Cache-Control',       'private, no-store');

  return new Response(obj.body, { headers });
});

// ── GET /api/admin/application/:id/documents/:documentId/download ────────────
//
// Official Forms Audit finding: the voided check, vaccine-proof uploads, and
// identity/credential documents were all captured and stored correctly but
// had NO retrieval mechanism at all — the admin UI showed filename/size/date
// metadata only, with no way to view the actual file content. This route
// closes that gap generically (one route for every uploaded document type)
// rather than adding a second dedicated route per document kind the way
// i9-pdf's own route is.
//
// Ownership is enforced by construction, not by a separate check: the
// caller supplies a small integer `documentId`, never an R2 object key
// directly, and findDocumentByIdForApplication's own query requires
// application_id to match the `:id` in the URL — a documentId that exists
// but belongs to a different application matches no row at all, so this can
// never be used to fetch another application's file by guessing/incrementing
// an id.
admin.get('/application/:id/documents/:documentId/download', async (c) => {
  const applicationId = c.req.param('id');
  const documentId = Number(c.req.param('documentId'));

  if (!Number.isInteger(documentId) || documentId <= 0) {
    return c.json({ error: 'Invalid document id' }, 400);
  }

  const doc = await findDocumentByIdForApplication(c.env.DB, documentId, applicationId);
  if (!doc) return c.json({ error: 'Document not found for this application' }, 404);

  const obj = await c.env.UPLOADS_BUCKET.get(doc.object_key);
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

  const headers = new Headers();
  headers.set('Content-Type',           contentType);
  headers.set('Content-Disposition',    buildContentDisposition(doc.file_name));
  headers.set('Cache-Control',          'private, no-store');
  headers.set('X-Content-Type-Options', 'nosniff');

  return new Response(obj.body, { headers });
});

/**
 * `file_name` originates from an applicant-supplied filename at upload time
 * (routes/uploads.ts's `entry.name`) — never safe to interpolate directly
 * into a header. Strips CR/LF and other control characters (the header-
 * injection vector) and provides both a quoted ASCII fallback and an
 * RFC 5987 `filename*` UTF-8 form so non-ASCII names still round-trip
 * correctly in browsers that support it.
 */
export function buildContentDisposition(rawFileName: string): string {
  // Deliberately matching control characters (CR/LF included) is the whole
  // point of this header-injection sanitizer, not an accidental regex mistake.
  // eslint-disable-next-line no-control-regex
  const cleaned = rawFileName.replace(/[\r\n\x00-\x1f]/g, '').trim() || 'document';
  const asciiFallback = cleaned.replace(/["\\]/g, '_').replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(cleaned);
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}
