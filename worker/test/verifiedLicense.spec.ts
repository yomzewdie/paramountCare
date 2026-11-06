import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin, withStorageKeys } from './helpers';
import { associateDoc, fakeFile, deleteUpload, removeDoc, submittedSession, uploadFile, createTestSession } from './submissionFixtures';

// The Admin Portal's own Verified License: recruiter-provided, stored beside
// the applicant's upload, and unreachable through any applicant route.

const url = (applicationId: string) => `${BASE}/api/admin/application/${applicationId}/verified-license`;

function adminUpload(applicationId: string, headers: Record<string, string>, file: File = fakeFile('verified.pdf', 'application/pdf', 500)) {
  const body = new FormData();
  body.append('file', file);
  return SELF.fetch(url(applicationId), { method: 'POST', headers, body });
}

interface Detail {
  documents: { id: number; docType: string | null; objectKey: string; fileName: string }[];
  auditLogs: { action: string; metadata: Record<string, unknown> | null }[];
}

async function detailOf(applicationId: string, cookie: string): Promise<Detail> {
  const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as Detail;
  return { ...detail, documents: await withStorageKeys(detail.documents) };
}

describe('Verified License — admin upload', () => {
  it('stores it privately on the application, separate from the applicant license, with an audit entry', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-ok'));
    const { applicationId } = await submittedSession(accessToken);
    const cookie = await loginAsAdmin();

    const before = (await detailOf(applicationId, cookie)).documents.find((d) => d.docType === 'nursing_license')!;
    const res = await adminUpload(applicationId, { cookie });
    expect(res.status).toBe(201);
    const created = (await res.json()) as Record<string, unknown>;
    expect(created).toMatchObject({ docType: 'verified_license', fileName: 'verified.pdf' });
    expect(created.objectKey).toBeUndefined(); // no raw storage key in the response

    const detail = await detailOf(applicationId, cookie);
    const verified = detail.documents.filter((d) => d.docType === 'verified_license');
    expect(verified).toHaveLength(1);
    expect(verified[0].objectKey.startsWith('verified-licenses/')).toBe(true);
    expect(await env.UPLOADS_BUCKET.head(verified[0].objectKey)).not.toBeNull();

    // The applicant's original is untouched and still coexists.
    const after = detail.documents.find((d) => d.docType === 'nursing_license')!;
    expect(after).toEqual(before);
    expect(await env.UPLOADS_BUCKET.head(after.objectKey)).not.toBeNull();

    const audit = detail.auditLogs.find((l) => l.action === 'verified_license_uploaded');
    expect(audit?.metadata).toMatchObject({ adminId: expect.any(Number), fileName: 'verified.pdf' });
    expect(JSON.stringify(audit?.metadata)).not.toContain('verified-licenses/');
  });

  it('a second upload adds a document rather than overwriting the first', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-second'));
    const { applicationId } = await submittedSession(accessToken);
    const cookie = await loginAsAdmin();
    await adminUpload(applicationId, { cookie });
    await adminUpload(applicationId, { cookie }, fakeFile('renewed.pdf', 'application/pdf', 500));
    const verified = (await detailOf(applicationId, cookie)).documents.filter((d) => d.docType === 'verified_license');
    expect(verified.map((d) => d.fileName)).toEqual(['verified.pdf', 'renewed.pdf']);
  });

  it('is downloadable only through the protected admin route', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-download'));
    const { applicationId } = await submittedSession(accessToken);
    const cookie = await loginAsAdmin();
    await adminUpload(applicationId, { cookie });
    const doc = (await detailOf(applicationId, cookie)).documents.find((d) => d.docType === 'verified_license')!;
    const download = `${BASE}/api/admin/application/${applicationId}/documents/${doc.id}/download`;

    const ok = await SELF.fetch(download, { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect(ok.headers.get('content-disposition')).toContain('attachment');
    await ok.arrayBuffer();

    expect((await SELF.fetch(download)).status).toBe(401);
    expect((await SELF.fetch(download, { headers: { Authorization: `Bearer ${accessToken}` } })).status).toBe(403);
  });

  it('restricts file type and rejects an unknown application', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-rules'));
    const { applicationId } = await submittedSession(accessToken);
    const cookie = await loginAsAdmin();
    expect((await adminUpload(applicationId, { cookie }, fakeFile('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10))).status).toBe(415);
    expect((await adminUpload(applicationId, { cookie }, fakeFile('huge.pdf', 'application/pdf', 10 * 1024 * 1024 + 1))).status).toBe(413);
    expect((await adminUpload('PCS-0000-NONE', { cookie })).status).toBe(404);
  });
});

describe('Verified License — applicants have no access', () => {
  it('an applicant token cannot upload one, and an anonymous caller cannot either', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-applicant'));
    const { applicationId } = await submittedSession(accessToken);
    expect((await adminUpload(applicationId, { Authorization: `Bearer ${accessToken}` })).status).toBe(403);
    expect((await adminUpload(applicationId, {})).status).toBe(401);
  });

  it('it is not an applicant document type: no association, and no removal', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-slot'));
    const session = await createTestSession(accessToken, 'general_rn');
    const file = await uploadFile(accessToken);
    expect((await associateDoc(accessToken, session.sessionId, 'verified_license', file, session.revision)).status).toBe(422);
    expect((await removeDoc(accessToken, session.sessionId, 'verified_license', session.revision)).status).toBe(422);
  });

  it('an applicant cannot delete it by object key', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-delete'));
    const { applicationId } = await submittedSession(accessToken);
    const cookie = await loginAsAdmin();
    await adminUpload(applicationId, { cookie });
    const doc = (await detailOf(applicationId, cookie)).documents.find((d) => d.docType === 'verified_license')!;
    expect((await deleteUpload(accessToken, doc.objectKey)).status).toBe(404);
    expect(await env.UPLOADS_BUCKET.head(doc.objectKey)).not.toBeNull();
  });

  it('the applicant session never carries it', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('verified-session'));
    const { applicationId, session } = await submittedSession(accessToken);
    await adminUpload(applicationId, { cookie: await loginAsAdmin() });
    const body = await (await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).text();
    expect(body).not.toContain('verified');
  });
});

describe('Verified License — admin replace and remove', () => {
  function replace(applicationId: string, documentId: number, headers: Record<string, string>, file: File = fakeFile('corrected.pdf', 'application/pdf', 600)) {
    const body = new FormData();
    body.append('file', file);
    return SELF.fetch(`${url(applicationId)}/${documentId}`, { method: 'PUT', headers, body });
  }
  const remove = (applicationId: string, documentId: number, headers: Record<string, string>) =>
    SELF.fetch(`${url(applicationId)}/${documentId}`, { method: 'DELETE', headers });

  async function withVerifiedLicense(label: string) {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
    const { applicationId } = await submittedSession(accessToken);
    const cookie = await loginAsAdmin();
    await adminUpload(applicationId, { cookie });
    const detail = await detailOf(applicationId, cookie);
    return {
      accessToken, applicationId, cookie,
      verified: detail.documents.find((d) => d.docType === 'verified_license')!,
      applicantLicense: detail.documents.find((d) => d.docType === 'nursing_license')!,
    };
  }

  it('replace swaps the document and its file, and audits both file names', async () => {
    const { applicationId, cookie, verified, applicantLicense } = await withVerifiedLicense('verified-replace');
    const res = await replace(applicationId, verified.id, { cookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ docType: 'verified_license', fileName: 'corrected.pdf' });
    expect(body.objectKey).toBeUndefined();

    const detail = await detailOf(applicationId, cookie);
    const now = detail.documents.filter((d) => d.docType === 'verified_license');
    expect(now.map((d) => d.fileName)).toEqual(['corrected.pdf']);
    expect(await env.UPLOADS_BUCKET.head(verified.objectKey)).toBeNull();
    expect(await env.UPLOADS_BUCKET.head(now[0].objectKey)).not.toBeNull();
    expect(detail.auditLogs.find((l) => l.action === 'verified_license_replaced')?.metadata)
      .toMatchObject({ adminId: expect.any(Number), fileName: 'corrected.pdf', replacedFileName: 'verified.pdf' });

    // The replacement downloads through the same protected route; the old id is gone.
    const download = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${now[0].id}/download`, { headers: { cookie } });
    expect(download.status).toBe(200);
    await download.arrayBuffer();
    expect((await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${verified.id}/download`, { headers: { cookie } })).status).toBe(404);

    expect(detail.documents.find((d) => d.id === applicantLicense.id)).toEqual(applicantLicense);
    expect(await env.UPLOADS_BUCKET.head(applicantLicense.objectKey)).not.toBeNull();
  });

  it('an invalid replacement changes nothing', async () => {
    const { applicationId, cookie, verified } = await withVerifiedLicense('verified-replace-invalid');
    const res = await replace(applicationId, verified.id, { cookie }, fakeFile('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10));
    expect(res.status).toBe(415);
    const docs = (await detailOf(applicationId, cookie)).documents.filter((d) => d.docType === 'verified_license');
    expect(docs.map((d) => d.id)).toEqual([verified.id]);
    expect(await env.UPLOADS_BUCKET.head(verified.objectKey)).not.toBeNull();
  });

  it('remove deletes the document and its file, keeping an audit record', async () => {
    const { applicationId, cookie, verified, applicantLicense } = await withVerifiedLicense('verified-remove');
    const res = await remove(applicationId, verified.id, { cookie });
    expect(res.status).toBe(200);
    await res.json();

    const detail = await detailOf(applicationId, cookie);
    expect(detail.documents.some((d) => d.docType === 'verified_license')).toBe(false);
    expect(await env.UPLOADS_BUCKET.head(verified.objectKey)).toBeNull();
    expect(detail.auditLogs.find((l) => l.action === 'verified_license_removed')?.metadata)
      .toMatchObject({ adminId: expect.any(Number), fileName: 'verified.pdf' });
    expect(detail.auditLogs.some((l) => l.action === 'verified_license_uploaded')).toBe(true);

    expect(detail.documents.find((d) => d.id === applicantLicense.id)).toEqual(applicantLicense);
    expect(await env.UPLOADS_BUCKET.head(applicantLicense.objectKey)).not.toBeNull();
  });

  it('removing twice is a 404, with a single audit entry', async () => {
    const { applicationId, cookie, verified } = await withVerifiedLicense('verified-remove-twice');
    expect((await remove(applicationId, verified.id, { cookie })).status).toBe(200);
    expect((await remove(applicationId, verified.id, { cookie })).status).toBe(404);
    const audits = (await detailOf(applicationId, cookie)).auditLogs.filter((l) => l.action === 'verified_license_removed');
    expect(audits).toHaveLength(1);
  });

  it("neither action can touch the applicant's own license, even by its document id", async () => {
    const { applicationId, cookie, applicantLicense } = await withVerifiedLicense('verified-not-applicant');
    expect((await replace(applicationId, applicantLicense.id, { cookie })).status).toBe(404);
    expect((await remove(applicationId, applicantLicense.id, { cookie })).status).toBe(404);
    const detail = await detailOf(applicationId, cookie);
    expect(detail.documents.find((d) => d.id === applicantLicense.id)).toEqual(applicantLicense);
    expect(await env.UPLOADS_BUCKET.head(applicantLicense.objectKey)).not.toBeNull();
  });

  it('a document id from another application is not found', async () => {
    const first = await withVerifiedLicense('verified-cross-a');
    const second = await withVerifiedLicense('verified-cross-b');
    expect((await remove(second.applicationId, first.verified.id, { cookie: second.cookie })).status).toBe(404);
    expect((await replace(second.applicationId, first.verified.id, { cookie: second.cookie })).status).toBe(404);
    expect(await env.UPLOADS_BUCKET.head(first.verified.objectKey)).not.toBeNull();
  });

  it('a malformed document id is not found', async () => {
    const { applicationId, cookie } = await withVerifiedLicense('verified-bad-id');
    const res = await SELF.fetch(`${url(applicationId)}/abc`, { method: 'DELETE', headers: { cookie } });
    expect(res.status).toBe(404);
  });

  it('an applicant cannot replace or remove it, and neither can an anonymous caller', async () => {
    const { accessToken, applicationId, cookie, verified } = await withVerifiedLicense('verified-applicant-actions');
    const applicant = { Authorization: `Bearer ${accessToken}` };
    expect((await replace(applicationId, verified.id, applicant)).status).toBe(403);
    expect((await remove(applicationId, verified.id, applicant)).status).toBe(403);
    expect((await replace(applicationId, verified.id, {})).status).toBe(401);
    expect((await remove(applicationId, verified.id, {})).status).toBe(401);
    const docs = (await detailOf(applicationId, cookie)).documents.filter((d) => d.docType === 'verified_license');
    expect(docs.map((d) => d.id)).toEqual([verified.id]);
    expect(await env.UPLOADS_BUCKET.head(verified.objectKey)).not.toBeNull();
  });
});
