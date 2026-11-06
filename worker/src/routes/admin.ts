import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import {
  findApplicationById,
  listApplications,
  type ApplicationListRow,
} from '../db/queries/applications';
import {
  findDocumentsByApplicationId,
  findDocumentByIdForApplication,
  insertAdminDocumentStmt,
  insertVerifiedLicenseIfExistsStmt,
  insertVerifiedLicenseAuditIfExistsStmt,
  deleteVerifiedLicenseStmt,
  type DocumentRow,
} from '../db/queries/documents';
import { findAuditLogsByApplicationId, insertAuditLogStmt } from '../db/queries/auditLogs';
import { MAX_UPLOAD_SIZE_BYTES } from './uploads';
import { serveStoredFile } from '../services/storedFiles';
import { publicAuditMetadata } from '../services/auditDisplay';
import { payloadReferences, withoutStorageKeys } from '../services/applicationDetail';
import { buildContentDisposition } from '../utils/contentDisposition';
import { generateVerifiedLicenseObjectKey } from '../utils/objectKey';
import { POSITION_OPTIONS, SPECIALTY_OPTIONS, VERIFIED_LICENSE_DOC_TYPE, isOptionValue } from '@pcs/shared';
import { loadClinicianSession, loadClinicianSources } from '../db/queries/clinicians';
import { VERIFICATION_KINDS, VERIFICATION_STATUSES, findClinicianRecordByUserId, type VerificationKind, type VerificationStatus } from '../db/queries/clinicianRecords';
import { REVIEW_STATUSES, findReviewsForClinician, type ReviewStatus } from '../db/queries/documentReviews';
import { clinicianAdmin } from './adminClinicians';
import {
  CLINICIAN_SORTS,
  ONBOARDING_QUEUES,
  buildClinicians,
  onboardingSummary,
  queryClinicians,
  visibleSessionUploads,
  type ClinicianQuery,
  type ClinicianSort,
  type DateRange,
  type OnboardingQueue,
} from '../services/clinicians';

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

// ── GET /api/admin/clinicians ─────────────────────────────────────────────────
//
// Every clinician from invitation through submitted application, with the
// calculated onboarding queue, completion and required documents (see
// services/clinicians.ts). Search, filters and sort apply to the complete set
// before paging. Query parameters: page, pageSize, search, sort
// (recent | name_asc | name_desc), queue, position, specialty, and
// startedFrom/startedTo, lastActiveFrom/lastActiveTo, completedFrom/completedTo
// as YYYY-MM-DD (UTC, inclusive).

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_PARAM.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

type ParsedClinicianQuery = { ok: true; query: ClinicianQuery } | { ok: false; error: string };

function parseClinicianQuery(c: Context<AppEnv>): ParsedClinicianQuery {
  const param = (name: string) => c.req.query(name)?.trim() || undefined;

  const sort = (param('sort') ?? 'recent') as ClinicianSort;
  if (!CLINICIAN_SORTS.includes(sort)) return { ok: false, error: 'Unknown sort' };
  const queue = param('queue') as OnboardingQueue | undefined;
  if (queue && !ONBOARDING_QUEUES.includes(queue)) return { ok: false, error: 'Unknown queue' };
  const position = param('position');
  if (position && !isOptionValue(POSITION_OPTIONS, position)) return { ok: false, error: 'Unknown position' };
  const specialty = param('specialty');
  if (specialty && !isOptionValue(SPECIALTY_OPTIONS, specialty)) return { ok: false, error: 'Unknown specialty' };

  const ranges: Record<'started' | 'lastActive' | 'completed', DateRange> = { started: {}, lastActive: {}, completed: {} };
  for (const field of ['started', 'lastActive', 'completed'] as const) {
    for (const end of ['from', 'to'] as const) {
      const value = param(`${field}${end === 'from' ? 'From' : 'To'}`);
      if (!value) continue;
      if (!isCalendarDate(value)) return { ok: false, error: `Invalid date: ${field}${end === 'from' ? 'From' : 'To'}` };
      ranges[field][end] = value;
    }
  }

  // Internal verification filters: backgroundCheck, referenceVerification,
  // i9Verification, w4Verification — each a verification status.
  const verifications: Partial<Record<VerificationKind, VerificationStatus>> = {};
  for (const kind of VERIFICATION_KINDS) {
    const value = param(kind.replace(/_([a-z0-9])/g, (_, ch: string) => ch.toUpperCase())) as VerificationStatus | undefined;
    if (!value) continue;
    if (!VERIFICATION_STATUSES.includes(value)) return { ok: false, error: `Unknown status for ${kind}` };
    verifications[kind] = value;
  }
  const documentReview = param('documentReview') as ReviewStatus | undefined;
  if (documentReview && !REVIEW_STATUSES.includes(documentReview)) return { ok: false, error: 'Unknown document review status' };
  const recentlyOnboarded = param('recentlyOnboarded');
  if (recentlyOnboarded && recentlyOnboarded !== 'true') return { ok: false, error: 'recentlyOnboarded must be true' };

  return {
    ok: true,
    query: {
      search: param('search'),
      queue,
      position,
      specialty,
      ...ranges,
      recentlyOnboarded: recentlyOnboarded === 'true',
      verifications,
      documentReview,
      sort,
      page: Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '20', 10) || 20)),
    },
  };
}

admin.get('/clinicians', async (c) => {
  const parsed = parseClinicianQuery(c);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const clinicians = buildClinicians(await loadClinicianSources(c.env.DB));
  return c.json(queryClinicians(clinicians, parsed.query));
});

// ── GET /api/admin/sessions/:sessionId ───────────────────────────────────────
//
// Read-only onboarding summary for a clinician who has started but may not
// have submitted: their list row, step progress, required documents, and the
// files attached so far (by upload id — viewed through the session document
// routes below). No answers — a submitted clinician's full record is the
// application.
admin.get('/sessions/:sessionId', async (c) => {
  const loaded = await loadClinicianSession(c.env.DB, c.req.param('sessionId'));
  if (!loaded) return c.json({ error: 'Onboarding session not found' }, 404);
  const record = loaded.session.user_id !== null ? await findClinicianRecordByUserId(c.env.DB, loaded.session.user_id) : null;
  const reviews = record ? await findReviewsForClinician(c.env.DB, record.id) : [];
  return c.json(onboardingSummary(loaded.session, loaded.application, loaded.invites, loaded.uploads, record, reviews));
});

// ── /api/admin/clinicians/:id/* — the recruiter workflow ─────────────────────
// New Applicants, On Hold, verification, document review and clearance (see
// routes/adminClinicians.ts), behind this router's auth and role checks.
admin.route('/clinicians', clinicianAdmin);

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

  // The clinician whose session submitted this application (none for a
  // historical web submission), for the recruiter workflow on this page.
  const clinician = await db
    .prepare(`SELECT c.id FROM clinicians c JOIN onboarding_sessions s ON s.user_id = c.user_id WHERE s.application_id = ? LIMIT 1`)
    .bind(id)
    .first<{ id: number }>();

  let payload: unknown = null;
  if (app.payload_json) {
    try { payload = JSON.parse(app.payload_json); } catch { payload = null; }
  }
  const references = payloadReferences(payload);

  return c.json({
    id:          app.application_id,
    status:      app.status,
    firstName:   app.first_name,
    lastName:    app.last_name,
    email:       app.email,
    phone:       app.phone,
    submittedAt: app.submitted_at,
    clinicianRecordId: clinician?.id ?? null,
    // The submitted snapshot, as submitted — minus storage locations.
    payload: withoutStorageKeys(payload),
    documents: docs.map((d) => ({
      id:         d.id,
      docType:    d.doc_type ?? null,
      // The snapshot field that references this file, if any (labels older files).
      payloadRef: references.get(d.object_key) ?? null,
      fileName:   d.file_name,
      fileSize:   d.file_size,
      uploadedAt: d.uploaded_at,
      supersededAt: d.superseded_at ?? null,
    })),
    auditLogs: logs.map((l) => ({
      id:        l.id,
      action:    l.action,
      metadata:  publicAuditMetadata(l.metadata_json),
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

// ── GET /api/admin/application/:id/w4-pdf ─────────────────────────────────────
//
// Mirrors the I-9 download route exactly — same auth (router-level
// requireAuth + requireRole above), same deterministic R2 key derivation
// (never a client-supplied key), same private/no-store streaming, no public
// R2 URL anywhere. The generated W-4 PDF contains the applicant's full SSN
// (see services/w4pdf.ts's own doc comment on why that's correct for this
// form, unlike I-9's masked one) — this route is the only way to retrieve
// it, gated the same as every other PII-bearing admin route.
admin.get('/application/:id/w4-pdf', async (c) => {
  const id        = c.req.param('id');
  const objectKey = `w4/${id}/w4-2026-signed.pdf`;

  const obj = await c.env.UPLOADS_BUCKET.get(objectKey);
  if (!obj) return c.json({ error: 'Signed W-4 PDF not found for this application' }, 404);

  const headers = new Headers();
  headers.set('Content-Type',        'application/pdf');
  headers.set('Content-Disposition', `attachment; filename="W4-${id}.pdf"`);
  headers.set('Cache-Control',       'private, no-store');

  return new Response(obj.body, { headers });
});

const parseDocumentId = (value: string | undefined) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

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
/** The application's document named by the URL, served as a download or an
 * inline preview (GET .../documents/:documentId/preview, for viewing inside
 * the Admin Portal). */
async function serveApplicationDocument(c: Context<AppEnv>, mode: 'download' | 'preview'): Promise<Response> {
  const documentId = parseDocumentId(c.req.param('documentId'));
  if (documentId === null) return c.json({ error: 'Invalid document id' }, 400);

  const doc = await findDocumentByIdForApplication(c.env.DB, documentId, c.req.param('id')!);
  if (!doc) return c.json({ error: 'Document not found for this application' }, 404);
  return serveStoredFile(c, doc.object_key, doc.file_name, mode);
}

admin.get('/application/:id/documents/:documentId/download', (c) => serveApplicationDocument(c, 'download'));
admin.get('/application/:id/documents/:documentId/preview', (c) => serveApplicationDocument(c, 'preview'));

// ── GET /api/admin/sessions/:sessionId/documents/:uploadId/(download|preview) ─
//
// A file an applicant still onboarding has attached, by its upload-ledger id —
// so recruiters can review documents before final submission. Only a file the
// onboarding summary lists can be fetched: a live upload attached to this
// session by the session's own applicant, for a document the session still
// counts (a vaccination proof whose answer is now a declination is not). An
// id belonging to any other session, a deleted upload, or anything else is
// simply not found. Read-only: nothing about the session or ledger changes,
// so the applicant's Last Active is untouched.
async function serveSessionDocument(c: Context<AppEnv>, mode: 'download' | 'preview'): Promise<Response> {
  const uploadId = parseDocumentId(c.req.param('uploadId'));
  if (uploadId === null) return c.json({ error: 'Invalid document id' }, 400);

  const loaded = await loadClinicianSession(c.env.DB, c.req.param('sessionId')!);
  const upload = loaded ? visibleSessionUploads(loaded.session, loaded.uploads).find((u) => u.id === uploadId) : undefined;
  if (!upload) return c.json({ error: 'Document not found for this onboarding session' }, 404);
  return serveStoredFile(c, upload.object_key, upload.file_name, mode);
}

admin.get('/sessions/:sessionId/documents/:uploadId/download', (c) => serveSessionDocument(c, 'download'));
admin.get('/sessions/:sessionId/documents/:uploadId/preview', (c) => serveSessionDocument(c, 'preview'));

// ── Verified License ─────────────────────────────────────────────────────────
//
// A recruiter's own license verification, stored beside (never over) whatever
// the applicant uploaded. Authorized by the router-level requireAuth +
// requireRole above; no applicant route can reach it — `verified_license` is
// not an applicant document type, and the object has no row in the applicant
// upload ledger, so applicant association and delete both refuse it.
const VERIFIED_LICENSE_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png']);

type StoredVerifiedLicense =
  | { ok: true; file: File; objectKey: string; uploadedAt: string }
  | { ok: false; response: Response };

/** Validates the request's file and writes it to private R2. */
async function storeVerifiedLicenseFile(c: Context<AppEnv>, applicationId: string): Promise<StoredVerifiedLicense> {
  let formData: FormData;
  try {
    formData = await c.req.raw.formData();
  } catch {
    return { ok: false, response: c.json({ error: 'Expected multipart/form-data.' }, 400) };
  }

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, response: c.json({ error: 'Missing or invalid field: file.' }, 400) };
  if (!VERIFIED_LICENSE_CONTENT_TYPES.has(file.type)) {
    return { ok: false, response: c.json({ error: 'A verified license must be a PDF, JPG, or PNG file.' }, 415) };
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) return { ok: false, response: c.json({ error: 'File exceeds the 10 MB size limit.' }, 413) };

  const objectKey = generateVerifiedLicenseObjectKey(applicationId, file.name);
  try {
    await c.env.UPLOADS_BUCKET.put(objectKey, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type, contentDisposition: buildContentDisposition(file.name) },
    });
  } catch (e) {
    console.error('[admin] verified license R2 put failed:', e);
    return { ok: false, response: c.json({ error: 'Storage error. Please try again.' }, 500) };
  }
  return { ok: true, file, objectKey, uploadedAt: new Date().toISOString() };
}

/** Best-effort: the record is already gone, so a failure here only leaves an
 * unreferenced private object behind, which is logged and never reported as a
 * failed request. */
async function deleteVerifiedLicenseObject(c: Context<AppEnv>, objectKey: string): Promise<void> {
  try {
    await c.env.UPLOADS_BUCKET.delete(objectKey);
  } catch (e) {
    console.error('[admin] verified license R2 delete failed:', e);
  }
}

/** The Verified License named by the URL. An id belonging to another
 * application, or to any other kind of document, simply isn't found. */
async function findVerifiedLicense(c: Context<AppEnv>, applicationId: string): Promise<DocumentRow | null> {
  const documentId = Number(c.req.param('documentId'));
  if (!Number.isInteger(documentId) || documentId <= 0) return null;
  const doc = await findDocumentByIdForApplication(c.env.DB, documentId, applicationId);
  return doc?.doc_type === VERIFIED_LICENSE_DOC_TYPE ? doc : null;
}

const VERIFIED_LICENSE_NOT_FOUND = { error: 'Verified license not found for this application' };

// ── POST /api/admin/application/:id/verified-license ─────────────────────────
//
// Each upload is a new document, so earlier verifications remain on record.
admin.post('/application/:id/verified-license', async (c) => {
  const applicationId = c.req.param('id');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const app = await findApplicationById(c.env.DB, applicationId);
  if (!app) return c.json({ error: 'Application not found' }, 404);

  const stored = await storeVerifiedLicenseFile(c, applicationId);
  if (!stored.ok) return stored.response;
  const { file, objectKey, uploadedAt } = stored;

  try {
    await c.env.DB.batch([
      insertAdminDocumentStmt(c.env.DB, {
        applicationId,
        objectKey,
        fileName: file.name,
        fileSize: file.size,
        uploadedAt,
        docType: VERIFIED_LICENSE_DOC_TYPE,
      }),
      insertAuditLogStmt(c.env.DB, {
        applicationId,
        action: 'verified_license_uploaded',
        metadataJson: JSON.stringify({ adminId: payload.uid, fileName: file.name }),
        createdAt: uploadedAt,
      }),
    ]);
  } catch (e) {
    console.error('[admin] verified license record insert failed:', e);
    await deleteVerifiedLicenseObject(c, objectKey);
    return c.json({ error: 'Storage error. Please try again.' }, 500);
  }

  return c.json({ docType: VERIFIED_LICENSE_DOC_TYPE, fileName: file.name, fileSize: file.size, uploadedAt }, 201);
});

// ── PUT /api/admin/application/:id/verified-license/:documentId — replace ────
//
// The new record replaces the old one in a single batch, so the application is
// never left with neither. Only then is the old object deleted.
admin.put('/application/:id/verified-license/:documentId', async (c) => {
  const applicationId = c.req.param('id');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const existing = await findVerifiedLicense(c, applicationId);
  if (!existing) return c.json(VERIFIED_LICENSE_NOT_FOUND, 404);

  const stored = await storeVerifiedLicenseFile(c, applicationId);
  if (!stored.ok) return stored.response;
  const { file, objectKey, uploadedAt } = stored;

  const ref = { documentId: existing.id, applicationId };
  let won: boolean;
  try {
    const results = await c.env.DB.batch([
      insertVerifiedLicenseAuditIfExistsStmt(c.env.DB, ref, {
        action: 'verified_license_replaced',
        metadataJson: JSON.stringify({ adminId: payload.uid, fileName: file.name, replacedFileName: existing.file_name }),
        createdAt: uploadedAt,
      }),
      insertVerifiedLicenseIfExistsStmt(c.env.DB, ref, {
        applicationId,
        objectKey,
        fileName: file.name,
        fileSize: file.size,
        uploadedAt,
        docType: VERIFIED_LICENSE_DOC_TYPE,
      }),
      deleteVerifiedLicenseStmt(c.env.DB, ref),
    ]);
    won = (results[results.length - 1].meta.changes ?? 0) > 0;
  } catch (e) {
    console.error('[admin] verified license replace failed:', e);
    await deleteVerifiedLicenseObject(c, objectKey);
    return c.json({ error: 'Storage error. Please try again.' }, 500);
  }

  if (!won) {
    // Another request replaced or removed it first; nothing here was recorded.
    await deleteVerifiedLicenseObject(c, objectKey);
    return c.json(VERIFIED_LICENSE_NOT_FOUND, 404);
  }

  await deleteVerifiedLicenseObject(c, existing.object_key);
  return c.json({ docType: VERIFIED_LICENSE_DOC_TYPE, fileName: file.name, fileSize: file.size, uploadedAt }, 200);
});

// ── DELETE /api/admin/application/:id/verified-license/:documentId — remove ──
//
// For a mistaken upload. The audit log keeps the record that it existed.
admin.delete('/application/:id/verified-license/:documentId', async (c) => {
  const applicationId = c.req.param('id');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const existing = await findVerifiedLicense(c, applicationId);
  if (!existing) return c.json(VERIFIED_LICENSE_NOT_FOUND, 404);

  const ref = { documentId: existing.id, applicationId };
  let won: boolean;
  try {
    const results = await c.env.DB.batch([
      insertVerifiedLicenseAuditIfExistsStmt(c.env.DB, ref, {
        action: 'verified_license_removed',
        metadataJson: JSON.stringify({ adminId: payload.uid, fileName: existing.file_name }),
        createdAt: new Date().toISOString(),
      }),
      deleteVerifiedLicenseStmt(c.env.DB, ref),
    ]);
    won = (results[results.length - 1].meta.changes ?? 0) > 0;
  } catch (e) {
    console.error('[admin] verified license remove failed:', e);
    return c.json({ error: 'Storage error. Please try again.' }, 500);
  }

  if (!won) return c.json(VERIFIED_LICENSE_NOT_FOUND, 404);
  await deleteVerifiedLicenseObject(c, existing.object_key);
  return c.json({ success: true }, 200);
});

// Re-exported for existing callers/tests; lives in utils so the upload route
// can apply the same sanitizing to the metadata it stores.
export { buildContentDisposition };
