import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import {
  findApplicationById,
  listApplications,
  type ApplicationListRow,
} from '../db/queries/applications';
import { findDocumentsByApplicationId } from '../db/queries/documents';
import { findAuditLogsByApplicationId } from '../db/queries/auditLogs';

export const admin = new Hono<AppEnv>();

// All routes require a valid admin JWT.
admin.use('*', requireAuth);

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
