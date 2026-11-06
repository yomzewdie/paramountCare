import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { insertAdminDocumentStmt } from '../src/db/queries/documents';
import { seedApplication } from './clinicianFixtures';
import { RESUME_DOC_BASE64, RESUME_DOCX_BASE64, fromBase64 } from './fixtures/wordFixtures';

// The Admin document viewer's protected preview: the same lookup and
// authorization as the download, served inline only for a PDF, JPEG or PNG
// recorded when the file was stored, and rendered to sanitized HTML for a Word
// document. Everything else stays download-only.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const BYTES = new Uint8Array([37, 80, 68, 70, 1, 2, 3]);

async function applicationWithDocument(label: string, doc: { fileName: string; contentType: string | null; docType?: string; storeObject?: boolean; bytes?: Uint8Array }) {
  const applicationId = await seedApplication({ firstName: 'Pre', lastName: 'View', email: uniqueEmail(label), submittedAt: new Date().toISOString() });
  const objectKey = `uploads/test/${crypto.randomUUID()}-${doc.fileName}`;
  if (doc.storeObject !== false) {
    await env.UPLOADS_BUCKET.put(objectKey, doc.bytes ?? BYTES, doc.contentType ? { httpMetadata: { contentType: doc.contentType } } : undefined);
  }
  const inserted = await insertAdminDocumentStmt(env.DB, {
    applicationId, objectKey, fileName: doc.fileName, fileSize: (doc.bytes ?? BYTES).byteLength, uploadedAt: new Date().toISOString(), docType: doc.docType ?? 'cpr_cert',
  }).run();
  return { applicationId, objectKey, documentId: inserted.meta.last_row_id };
}

const preview = (applicationId: string, documentId: number | string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${documentId}/preview`, { headers });
const download = (applicationId: string, documentId: number | string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${documentId}/download`, { headers });

describe('GET /api/admin/application/:id/documents/:documentId/preview', () => {
  it.each([
    ['application/pdf', 'cpr-card.pdf'],
    ['image/jpeg', 'license-front.jpg'],
    ['image/png', 'license-back.png'],
  ])('previews %s inline, with the stored content type', async (contentType, fileName) => {
    const cookie = await loginAsAdmin();
    const { applicationId, documentId, objectKey } = await applicationWithDocument('preview-ok', { fileName, contentType });

    const res = await preview(applicationId, documentId, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(contentType);
    expect(res.headers.get('content-disposition')).toMatch(new RegExp(`^inline; filename="${fileName}"`));
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(Array.from(BYTES));
    for (const [, value] of res.headers) expect(value).not.toContain(objectKey);
  });

  it('the download of the same document is still an attachment', async () => {
    const cookie = await loginAsAdmin();
    const { applicationId, documentId } = await applicationWithDocument('preview-download', { fileName: 'cpr.pdf', contentType: 'application/pdf' });
    const res = await download(applicationId, documentId, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="cpr.pdf"/);
    await res.arrayBuffer();
  });

  it.each([
    ['DOC', 'application/msword', 'resume.doc', RESUME_DOC_BASE64],
    ['DOCX', DOCX, 'resume.docx', RESUME_DOCX_BASE64],
  ])('a %s resume is rendered in the portal as sandboxed HTML, and the original stays downloadable', async (_label, contentType, fileName, b64) => {
    const cookie = await loginAsAdmin();
    const bytes = fromBase64(b64);
    const { applicationId, documentId, objectKey } = await applicationWithDocument('preview-word', { fileName, contentType, docType: 'applicant_resume', bytes });

    const res = await preview(applicationId, documentId, { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
    expect(res.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const html = await res.text();
    expect(html).toContain('Jane Nurse');
    expect(html).toContain('ICU specialist');
    expect(html).toContain('Mercy Hospital, ICU, 2020–2024');
    // The document's own text is escaped, never markup.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    // No storage key or file URL anywhere in the response.
    const everything = html + JSON.stringify([...res.headers]);
    expect(everything).not.toContain(objectKey);
    expect(everything).not.toMatch(/uploads\/|r2\.dev|r2\.cloudflarestorage|https?:\/\//);

    const file = await download(applicationId, documentId, { cookie });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(contentType);
    expect(file.headers.get('content-disposition')).toMatch(new RegExp(`^attachment; filename="${fileName}"`));
    expect(file.headers.get('content-security-policy')).toBeNull();
    expect(Array.from(new Uint8Array(await file.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it.each([
    ['DOC', 'application/msword', 'broken.doc'],
    ['DOCX', DOCX, 'broken.docx'],
  ])('an unreadable %s explains itself, and the original stays downloadable', async (_label, contentType, fileName) => {
    const cookie = await loginAsAdmin();
    const { applicationId, documentId } = await applicationWithDocument('preview-word-broken', { fileName, contentType, docType: 'applicant_resume' });

    const res = await preview(applicationId, documentId, { cookie });
    expect(res.status).toBe(422);
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(await res.json()).toEqual({ error: 'This Word document could not be displayed. Download the original to open it.' });

    const file = await download(applicationId, documentId, { cookie });
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe(contentType);
    await file.arrayBuffer();
  });

  it('a Word preview is refused to applicants and anonymous callers, and to another application', async () => {
    const cookie = await loginAsAdmin();
    const a = await applicationWithDocument('preview-word-a', { fileName: 'a.docx', contentType: DOCX, docType: 'applicant_resume', bytes: fromBase64(RESUME_DOCX_BASE64) });
    const b = await applicationWithDocument('preview-word-b', { fileName: 'b.doc', contentType: 'application/msword', docType: 'applicant_resume', bytes: fromBase64(RESUME_DOC_BASE64) });
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preview-word-applicant'));

    expect((await preview(a.applicationId, a.documentId)).status).toBe(401);
    expect((await preview(a.applicationId, a.documentId, { Authorization: `Bearer ${accessToken}` })).status).toBe(403);
    expect((await preview(a.applicationId, b.documentId, { cookie })).status).toBe(404);
    expect((await preview(a.applicationId, 987654321, { cookie })).status).toBe(404);
    expect((await preview(a.applicationId, 'nope', { cookie })).status).toBe(400);
  });

  it.each([
    ['HTML', 'text/html', 'page.pdf'],
    ['SVG', 'image/svg+xml', 'logo.png'],
    ['JavaScript', 'application/javascript', 'scan.jpg'],
    ['no recorded type (legacy)', null, 'old-scan.pdf'],
  ])('%s is not rendered, whatever the file name says', async (_label, contentType, fileName) => {
    const cookie = await loginAsAdmin();
    const { applicationId, documentId } = await applicationWithDocument('preview-unsupported', { fileName, contentType });
    expect((await preview(applicationId, documentId, { cookie })).status).toBe(415);

    // Still a protected, opaque download.
    const file = await download(applicationId, documentId, { cookie });
    expect(file.headers.get('content-type')).toBe('application/octet-stream');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment;/);
    await file.arrayBuffer();
  });

  it('a document id from another application is not found', async () => {
    const cookie = await loginAsAdmin();
    const first = await applicationWithDocument('preview-cross-a', { fileName: 'a.pdf', contentType: 'application/pdf' });
    const second = await applicationWithDocument('preview-cross-b', { fileName: 'b.pdf', contentType: 'application/pdf' });
    expect((await preview(second.applicationId, first.documentId, { cookie })).status).toBe(404);
  });

  it('a document whose stored file is gone is not found', async () => {
    const cookie = await loginAsAdmin();
    const { applicationId, documentId } = await applicationWithDocument('preview-missing', { fileName: 'gone.pdf', contentType: 'application/pdf', storeObject: false });
    const res = await preview(applicationId, documentId, { cookie });
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain('uploads/');
  });

  it('a malformed document id is rejected', async () => {
    const cookie = await loginAsAdmin();
    expect((await preview('PCS-0000-ZZZZ', 'abc', { cookie })).status).toBe(400);
  });

  it('an applicant is refused (403) and an anonymous caller is unauthorized (401)', async () => {
    const { applicationId, documentId } = await applicationWithDocument('preview-auth', { fileName: 'a.pdf', contentType: 'application/pdf' });
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('preview-applicant'));
    expect((await preview(applicationId, documentId, { Authorization: `Bearer ${accessToken}` })).status).toBe(403);
    expect((await preview(applicationId, documentId)).status).toBe(401);
  });

  it('every attachment of a multi-file requirement is listed and previewable on its own', async () => {
    const cookie = await loginAsAdmin();
    const { applicationId } = await applicationWithDocument('preview-group', { fileName: 'front.jpg', contentType: 'image/jpeg', docType: 'nursing_license' });
    const backKey = `uploads/test/${crypto.randomUUID()}-back.png`;
    await env.UPLOADS_BUCKET.put(backKey, BYTES, { httpMetadata: { contentType: 'image/png' } });
    await insertAdminDocumentStmt(env.DB, { applicationId, objectKey: backKey, fileName: 'back.png', fileSize: 7, uploadedAt: new Date().toISOString(), docType: 'nursing_license' }).run();

    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { documents: { id: number; docType: string; fileName: string }[] };
    const group = detail.documents.filter((d) => d.docType === 'nursing_license');
    expect(group.map((d) => d.fileName)).toEqual(['front.jpg', 'back.png']);
    for (const doc of group) {
      const res = await preview(applicationId, doc.id, { cookie });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
    }
  });

  it('the applicant-provided license and an admin Verified License preview through the same route', async () => {
    const cookie = await loginAsAdmin();
    const { applicationId, documentId: applicantLicense } = await applicationWithDocument('preview-licenses', { fileName: 'license.jpg', contentType: 'image/jpeg', docType: 'nursing_license' });

    const form = new FormData();
    form.append('file', new File([BYTES], 'board-printout.pdf', { type: 'application/pdf' }));
    expect((await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/verified-license`, { method: 'POST', headers: { cookie }, body: form })).status).toBe(201);
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { documents: { id: number; docType: string }[] };
    const verified = detail.documents.find((d) => d.docType === 'verified_license')!;

    for (const [id, type] of [[applicantLicense, 'image/jpeg'], [verified.id, 'application/pdf']] as const) {
      const res = await preview(applicationId, id, { cookie });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe(type);
      expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
      await res.arrayBuffer();
    }

    // Once removed, the Verified License can no longer be viewed.
    expect((await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/verified-license/${verified.id}`, { method: 'DELETE', headers: { cookie } })).status).toBe(200);
    expect((await preview(applicationId, verified.id, { cookie })).status).toBe(404);
  });
});
