import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { createTestSession, fakeFile, patch, removeDoc, uploadFile, type TestSession } from './submissionFixtures';
import { RESUME_DOC_BASE64, RESUME_DOCX_BASE64, fromBase64 } from './fixtures/wordFixtures';
import type { OnboardingSummary } from '../src/services/clinicians';

// Recruiters viewing what an applicant still onboarding has uploaded, before
// final submission: by upload-ledger id, scoped to the session, through the
// same preview/download rules as a submitted application's documents.

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function applicant(label: string) {
  const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  return { accessToken, session: await createTestSession(accessToken, 'general_rn') };
}

/** Uploads a file and attaches it to a document, as the app does. */
async function attach(accessToken: string, session: TestSession, docType: string, file: File, mode?: 'add'): Promise<TestSession> {
  const objectKey = await uploadFile(accessToken, file);
  const res = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/${docType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ objectKey, revision: session.revision, ...(mode ? { mode } : {}) }),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function summaryOf(sessionId: string, cookie: string): Promise<OnboardingSummary> {
  const res = await SELF.fetch(`${BASE}/api/admin/sessions/${sessionId}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

const fileUrl = (sessionId: string, uploadId: number | string, kind: 'preview' | 'download') => `${BASE}/api/admin/sessions/${sessionId}/documents/${uploadId}/${kind}`;
const get = (url: string, headers: Record<string, string> = {}) => SELF.fetch(url, { headers });

const lastActive = async (sessionId: string) =>
  (await env.DB.prepare('SELECT updated_at FROM onboarding_sessions WHERE session_id = ?').bind(sessionId).first<{ updated_at: string }>())!.updated_at;

describe('viewing an in-progress applicant\'s documents', () => {
  it('previews a PDF, JPEG and PNG inline, and downloads them as attachments', async () => {
    const { accessToken, session } = await applicant('session-docs-types');
    let current = await attach(accessToken, session, 'applicant_resume', fakeFile('resume.pdf', 'application/pdf', 300));
    current = await attach(accessToken, current, 'list_a', fakeFile('passport.jpg', 'image/jpeg', 200));
    current = await attach(accessToken, current, 'cpr_cert', fakeFile('cpr.png', 'image/png', 150));
    const cookie = await loginAsAdmin();

    const { documents } = await summaryOf(current.sessionId, cookie);
    expect(documents.map((d) => [d.docType, d.fileName])).toEqual([
      ['applicant_resume', 'resume.pdf'], ['list_a', 'passport.jpg'], ['cpr_cert', 'cpr.png'],
    ]);

    for (const [doc, type] of [[documents[0], 'application/pdf'], [documents[1], 'image/jpeg'], [documents[2], 'image/png']] as const) {
      const preview = await get(fileUrl(current.sessionId, doc.id, 'preview'), { cookie });
      expect(preview.status).toBe(200);
      expect(preview.headers.get('content-type')).toBe(type);
      expect(preview.headers.get('content-disposition')).toMatch(new RegExp(`^inline; filename="${doc.fileName}"`));
      expect(preview.headers.get('cache-control')).toBe('private, no-store');
      expect(preview.headers.get('x-content-type-options')).toBe('nosniff');
      expect((await preview.arrayBuffer()).byteLength).toBe(doc.fileSize);

      const download = await get(fileUrl(current.sessionId, doc.id, 'download'), { cookie });
      expect(download.status).toBe(200);
      expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
      await download.arrayBuffer();
    }
  });

  it.each([
    ['DOC', 'application/msword', 'resume.doc', RESUME_DOC_BASE64],
    ['DOCX', DOCX, 'resume.docx', RESUME_DOCX_BASE64],
  ])('a %s resume is previewed as sandboxed HTML, and the original stays downloadable', async (_label, type, fileName, b64) => {
    const { accessToken, session } = await applicant('session-docs-word');
    const bytes = fromBase64(b64);
    const current = await attach(accessToken, session, 'applicant_resume', new File([bytes], fileName, { type }));
    const cookie = await loginAsAdmin();
    const [resume] = (await summaryOf(current.sessionId, cookie)).documents;

    const preview = await get(fileUrl(current.sessionId, resume.id, 'preview'), { cookie });
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(preview.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    const html = await preview.text();
    expect(html).toContain('Jane Nurse');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/uploads\/|r2\.dev|https?:\/\//);

    // The applicant who uploaded it can't use the recruiter's preview.
    expect((await get(fileUrl(current.sessionId, resume.id, 'preview'), { Authorization: `Bearer ${accessToken}` })).status).toBe(403);

    const download = await get(fileUrl(current.sessionId, resume.id, 'download'), { cookie });
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe(type);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(bytes));
  });

  it('lists every attachment of a multi-file requirement in the applicant\'s order, each viewable', async () => {
    const { accessToken, session } = await applicant('session-docs-group');
    let current = await attach(accessToken, session, 'cpr_cert', fakeFile('cpr-front.jpg', 'image/jpeg', 100));
    current = await attach(accessToken, current, 'cpr_cert', fakeFile('cpr-back.png', 'image/png', 110), 'add');
    const cookie = await loginAsAdmin();

    const summary = await summaryOf(current.sessionId, cookie);
    const cpr = summary.documents.filter((d) => d.docType === 'cpr_cert');
    expect(cpr.map((d) => d.fileName)).toEqual(['cpr-front.jpg', 'cpr-back.png']);
    expect(summary.requiredDocuments.find((r) => r.key === 'cpr_cert')).toMatchObject({ satisfied: true, attachmentCount: 2 });
    for (const doc of cpr) {
      const res = await get(fileUrl(current.sessionId, doc.id, 'preview'), { cookie });
      expect(res.status).toBe(200);
      await res.arrayBuffer();
    }
  });

  it("an upload from another session, or one never attached, cannot be viewed through this session", async () => {
    const first = await applicant('session-docs-a');
    const second = await applicant('session-docs-b');
    const firstCurrent = await attach(first.accessToken, first.session, 'list_a', fakeFile('a.jpg', 'image/jpeg', 100));
    const cookie = await loginAsAdmin();
    const [theirs] = (await summaryOf(firstCurrent.sessionId, cookie)).documents;

    expect((await get(fileUrl(second.session.sessionId, theirs.id, 'preview'), { cookie })).status).toBe(404);
    expect((await get(fileUrl(second.session.sessionId, theirs.id, 'download'), { cookie })).status).toBe(404);

    // Uploaded by the applicant but never attached to the session.
    const looseKey = await uploadFile(second.accessToken, fakeFile('loose.pdf', 'application/pdf', 50));
    const loose = await env.DB.prepare('SELECT id FROM uploaded_documents WHERE object_key = ?').bind(looseKey).first<{ id: number }>();
    expect((await get(fileUrl(second.session.sessionId, loose!.id, 'download'), { cookie })).status).toBe(404);
    expect((await summaryOf(second.session.sessionId, cookie)).documents).toEqual([]);
  });

  it('a removed upload is no longer available', async () => {
    const { accessToken, session } = await applicant('session-docs-removed');
    const current = await attach(accessToken, session, 'cpr_cert', fakeFile('cpr.pdf', 'application/pdf', 100));
    const cookie = await loginAsAdmin();
    const [cpr] = (await summaryOf(current.sessionId, cookie)).documents;
    const before = await get(fileUrl(current.sessionId, cpr.id, 'preview'), { cookie });
    expect(before.status).toBe(200);
    await before.arrayBuffer();

    expect((await removeDoc(accessToken, current.sessionId, 'cpr_cert', current.revision)).status).toBe(200);
    expect((await get(fileUrl(current.sessionId, cpr.id, 'preview'), { cookie })).status).toBe(404);
    expect((await get(fileUrl(current.sessionId, cpr.id, 'download'), { cookie })).status).toBe(404);
    expect((await summaryOf(current.sessionId, cookie)).documents).toEqual([]);
  });

  it('a vaccination proof is hidden once the applicant switches that vaccine to a declination', async () => {
    const { accessToken, session } = await applicant('session-docs-vaccine');
    const providing = (await (await patch(accessToken, session.sessionId, session.revision, {
      formData: { acknowledgements: { hep_b_declination: { decision: 'providing_proof' } } },
    })).json()) as TestSession;
    const withProof = await attach(accessToken, providing, 'hep_b_vaccination_proof', fakeFile('hepb.pdf', 'application/pdf', 90));
    const cookie = await loginAsAdmin();
    const [proof] = (await summaryOf(withProof.sessionId, cookie)).documents;
    expect(proof.docType).toBe('hep_b_vaccination_proof');

    await patch(accessToken, withProof.sessionId, withProof.revision, {
      formData: { ...withProof.formData, acknowledgements: { hep_b_declination: { decision: 'declining' } } },
    });
    expect((await summaryOf(withProof.sessionId, cookie)).documents).toEqual([]);
    expect((await get(fileUrl(withProof.sessionId, proof.id, 'preview'), { cookie })).status).toBe(404);
  });

  it('applicants are refused (403), even for their own session, and anonymous callers are unauthorized (401)', async () => {
    const { accessToken, session } = await applicant('session-docs-auth');
    const current = await attach(accessToken, session, 'list_a', fakeFile('a.jpg', 'image/jpeg', 100));
    const [doc] = (await summaryOf(current.sessionId, await loginAsAdmin())).documents;
    for (const kind of ['preview', 'download'] as const) {
      expect((await get(fileUrl(current.sessionId, doc.id, kind), { Authorization: `Bearer ${accessToken}` })).status).toBe(403);
      expect((await get(fileUrl(current.sessionId, doc.id, kind))).status).toBe(401);
    }
  });

  it('a malformed upload id is rejected, and an unknown session is not found', async () => {
    const cookie = await loginAsAdmin();
    expect((await get(fileUrl('any-session', 'abc', 'preview'), { cookie })).status).toBe(400);
    expect((await get(fileUrl('no-such-session', 1, 'preview'), { cookie })).status).toBe(404);
  });

  it('never exposes a storage key in the summary, the file responses, or errors', async () => {
    const { accessToken, session } = await applicant('session-docs-keys');
    const current = await attach(accessToken, session, 'list_a', fakeFile('a.jpg', 'image/jpeg', 100));
    const cookie = await loginAsAdmin();
    const summary = await summaryOf(current.sessionId, cookie);
    const body = JSON.stringify(summary);
    expect(body).not.toContain('uploads/');
    expect(body).not.toContain('objectKey');
    expect(Object.keys(summary.documents[0]).sort()).toEqual(['docType', 'fileName', 'fileSize', 'id', 'uploadedAt']);

    const res = await get(fileUrl(current.sessionId, summary.documents[0].id, 'preview'), { cookie });
    for (const [, value] of res.headers) expect(value).not.toContain('uploads/');
    await res.arrayBuffer();
    const missing = await get(fileUrl(current.sessionId, 999999, 'preview'), { cookie });
    expect(JSON.stringify(await missing.json())).not.toContain('uploads/');
  });

  it("viewing and downloading never move the applicant's Last Active", async () => {
    const { accessToken, session } = await applicant('session-docs-last-active');
    const current = await attach(accessToken, session, 'list_a', fakeFile('a.pdf', 'application/pdf', 100));
    // A distinct, older applicant timestamp, so any write to it would show.
    await env.DB.prepare(`UPDATE onboarding_sessions SET updated_at = '2026-01-02 03:04:05' WHERE session_id = ?`).bind(current.sessionId).run();
    const revision = (await env.DB.prepare('SELECT revision FROM onboarding_sessions WHERE session_id = ?').bind(current.sessionId).first<{ revision: number }>())!.revision;
    const cookie = await loginAsAdmin();

    const [doc] = (await summaryOf(current.sessionId, cookie)).documents;
    for (const kind of ['preview', 'download'] as const) await (await get(fileUrl(current.sessionId, doc.id, kind), { cookie })).arrayBuffer();

    expect(await lastActive(current.sessionId)).toBe('2026-01-02 03:04:05');
    expect((await env.DB.prepare('SELECT revision FROM onboarding_sessions WHERE session_id = ?').bind(current.sessionId).first<{ revision: number }>())!.revision).toBe(revision);
    const listed = (await (await get(`${BASE}/api/admin/clinicians?search=${encodeURIComponent(current.sessionId)}`, { cookie })).json()) as { data: { lastActiveAt: string }[] };
    expect(listed.data[0].lastActiveAt).toBe('2026-01-02T03:04:05.000Z');
  });
});
