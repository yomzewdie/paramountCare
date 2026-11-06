import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { MAX_ATTACHMENTS_PER_DOCUMENT, documentAttachmentsFor } from '@pcs/shared';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin, withStorageKeys } from './helpers';
import {
  associateDoc, completePacketExceptReview, createTestSession, fakeFile, patch, submit, uploadFile, type TestSession,
} from './submissionFixtures';

// A document requirement as a group of attachments, on the existing D1 schema:
// N ledger rows per (session_id, doc_type), promoted to N application_documents
// rows. One attachment stays exactly the shape it has always been.

const LICENSE = 'nursing_license';

function send(accessToken: string, session: { sessionId: string }, docType: string, method: 'POST' | 'DELETE', body: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/${docType}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
}

async function add(accessToken: string, session: TestSession, docType: string, objectKey: string): Promise<TestSession> {
  const res = await send(accessToken, session, docType, 'POST', { objectKey, revision: session.revision, mode: 'add' });
  expect(res.status).toBe(200);
  return res.json();
}

async function ledger(objectKey: string) {
  return env.DB.prepare('SELECT session_id, doc_type, deleted_at FROM uploaded_documents WHERE object_key = ?')
    .bind(objectKey).first<{ session_id: string | null; doc_type: string | null; deleted_at: string | null }>();
}

const keys = (session: TestSession, docType = LICENSE) => documentAttachmentsFor(session.formData, docType).map((f) => f.objectKey);

async function applicantWithSession(label: string) {
  const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  const session = await createTestSession(accessToken, 'general_rn');
  return { accessToken, session };
}

describe('document requirement — multiple attachments', () => {
  it('adding keeps the existing attachment: both files stay attached and in R2', async () => {
    const { accessToken, session } = await applicantWithSession('group-add');
    const front = await uploadFile(accessToken, fakeFile('front.jpg', 'image/jpeg', 100));
    const back = await uploadFile(accessToken, fakeFile('back.jpg', 'image/jpeg', 100));

    const afterFront = await add(accessToken, session, LICENSE, front);
    const afterBack = await add(accessToken, afterFront, LICENSE, back);

    expect(keys(afterBack)).toEqual([front, back]);
    // The requirement's own field still holds the first attachment, so
    // everything reading it keeps working.
    expect((afterBack.formData.uploadedDocuments as { nursingLicense: { objectKey: string } }).nursingLicense.objectKey).toBe(front);
    expect(await env.UPLOADS_BUCKET.head(front)).not.toBeNull();
    expect(await ledger(front)).toMatchObject({ doc_type: LICENSE, deleted_at: null });
    expect(await ledger(back)).toMatchObject({ doc_type: LICENSE, deleted_at: null });
  });

  it('one attachment stays the existing single-file shape, with no attachment list stored', async () => {
    const { accessToken, session } = await applicantWithSession('group-single');
    const only = await uploadFile(accessToken);
    const after = await add(accessToken, session, LICENSE, only);
    expect(after.formData.documentAttachments).toBeUndefined();
    expect(keys(after)).toEqual([only]);
  });

  it('an existing single attachment behaves as a one-item group when another is added', async () => {
    const { accessToken, session } = await applicantWithSession('group-legacy');
    const original = await uploadFile(accessToken);
    // How every session stored a file before attachment groups: no `mode`.
    const legacyRes = await associateDoc(accessToken, session.sessionId, LICENSE, original, session.revision);
    const legacy = (await legacyRes.json()) as TestSession;
    const more = await uploadFile(accessToken);
    const after = await add(accessToken, legacy, LICENSE, more);
    expect(keys(after)).toEqual([original, more]);
  });

  it('a retried add of the same file is a no-op, not a duplicate', async () => {
    const { accessToken, session } = await applicantWithSession('group-retry');
    const file = await uploadFile(accessToken);
    const first = await add(accessToken, session, LICENSE, file);
    const second = await add(accessToken, first, LICENSE, file);
    expect(keys(second)).toEqual([file]);
  });

  it('removes one attachment without touching the others', async () => {
    const { accessToken, session } = await applicantWithSession('group-remove-one');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    const c = await uploadFile(accessToken);
    let current = await add(accessToken, session, LICENSE, a);
    current = await add(accessToken, current, LICENSE, b);
    current = await add(accessToken, current, LICENSE, c);

    const res = await send(accessToken, current, LICENSE, 'DELETE', { revision: current.revision, objectKey: a });
    expect(res.status).toBe(200);
    const after = (await res.json()) as TestSession;
    expect(keys(after)).toEqual([b, c]);
    // The first attachment went, so the single-file field moves to the next one.
    expect((after.formData.uploadedDocuments as { nursingLicense: { objectKey: string } }).nursingLicense.objectKey).toBe(b);
    expect(await env.UPLOADS_BUCKET.head(a)).toBeNull();
    expect(await ledger(a)).toMatchObject({ deleted_at: expect.any(String) });
    expect(await env.UPLOADS_BUCKET.head(b)).not.toBeNull();
  });

  it('removing down to one attachment returns to the single-file shape', async () => {
    const { accessToken, session } = await applicantWithSession('group-remove-to-one');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    let current = await add(accessToken, session, LICENSE, a);
    current = await add(accessToken, current, LICENSE, b);
    const after = (await (await send(accessToken, current, LICENSE, 'DELETE', { revision: current.revision, objectKey: b })).json()) as TestSession;
    expect(after.formData.documentAttachments).toBeUndefined();
    expect(keys(after)).toEqual([a]);
  });

  it('replaces one attachment in place, leaving the others', async () => {
    const { accessToken, session } = await applicantWithSession('group-replace-one');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    let current = await add(accessToken, session, LICENSE, a);
    current = await add(accessToken, current, LICENSE, b);
    const replacement = await uploadFile(accessToken);

    const res = await send(accessToken, current, LICENSE, 'POST', { objectKey: replacement, revision: current.revision, replaceObjectKey: a });
    expect(res.status).toBe(200);
    expect(keys((await res.json()) as TestSession)).toEqual([replacement, b]);
    expect(await env.UPLOADS_BUCKET.head(a)).toBeNull();
    expect(await env.UPLOADS_BUCKET.head(b)).not.toBeNull();
  });

  it('refuses to replace an attachment that is not in the requirement, changing nothing', async () => {
    const { accessToken, session } = await applicantWithSession('group-replace-missing');
    const a = await uploadFile(accessToken);
    const current = await add(accessToken, session, LICENSE, a);
    const replacement = await uploadFile(accessToken);
    const res = await send(accessToken, current, LICENSE, 'POST', { objectKey: replacement, revision: current.revision, replaceObjectKey: 'uploads/1/not-here.jpg' });
    expect(res.status).toBe(404);
    expect(await env.UPLOADS_BUCKET.head(a)).not.toBeNull();
  });

  it('a request with no mode keeps its original meaning for installed app builds: the file becomes the only attachment', async () => {
    const { accessToken, session } = await applicantWithSession('group-old-client');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    let current = await add(accessToken, session, LICENSE, a);
    current = await add(accessToken, current, LICENSE, b);
    const c = await uploadFile(accessToken);

    const res = await associateDoc(accessToken, current.sessionId, LICENSE, c, current.revision);
    expect(res.status).toBe(200);
    const after = (await res.json()) as TestSession;
    expect(keys(after)).toEqual([c]);
    expect(after.formData.documentAttachments).toBeUndefined();
    expect(await env.UPLOADS_BUCKET.head(a)).toBeNull();
    expect(await env.UPLOADS_BUCKET.head(b)).toBeNull();
  });

  it('a remove with no objectKey clears the whole requirement', async () => {
    const { accessToken, session } = await applicantWithSession('group-remove-all');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    let current = await add(accessToken, session, LICENSE, a);
    current = await add(accessToken, current, LICENSE, b);
    const after = (await (await send(accessToken, current, LICENSE, 'DELETE', { revision: current.revision })).json()) as TestSession;
    expect(keys(after)).toEqual([]);
    expect(await env.UPLOADS_BUCKET.head(a)).toBeNull();
    expect(await env.UPLOADS_BUCKET.head(b)).toBeNull();
  });

  it('every requirement except the resume accepts multiple attachments', async () => {
    for (const docType of ['list_a', 'cpr_cert', 'direct_deposit_voided_check', 'hep_b_vaccination_proof']) {
      const { accessToken, session } = await applicantWithSession(`group-${docType}`.replace(/_/g, '-'));
      const a = await uploadFile(accessToken);
      const b = await uploadFile(accessToken);
      const current = await add(accessToken, session, docType, a);
      expect(keys(await add(accessToken, current, docType, b), docType)).toEqual([a, b]);
    }
  });

  it('the resume stays a single file', async () => {
    const { accessToken, session } = await applicantWithSession('group-resume');
    const pdf = await uploadFile(accessToken, fakeFile('resume.pdf', 'application/pdf', 100));
    const res = await send(accessToken, session, 'applicant_resume', 'POST', { objectKey: pdf, revision: session.revision, mode: 'add' });
    expect(res.status).toBe(422);
  });

  it(`enforces the limit of ${MAX_ATTACHMENTS_PER_DOCUMENT} attachments per requirement`, async () => {
    const { accessToken, session } = await applicantWithSession('group-limit');
    const existing = Array.from({ length: MAX_ATTACHMENTS_PER_DOCUMENT }, (_, i) => ({ name: `${i}.jpg`, size: 1, type: 'image/jpeg', objectKey: `uploads/x/${i}.jpg` }));
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?')
      .bind(JSON.stringify({ documentAttachments: { [LICENSE]: existing }, uploadedDocuments: { nursingLicense: existing[0] } }), session.sessionId).run();
    const file = await uploadFile(accessToken);
    const res = await send(accessToken, session, LICENSE, 'POST', { objectKey: file, revision: session.revision, mode: 'add' });
    expect(res.status).toBe(422);
  });
});

describe('attachment groups — security', () => {
  it("another applicant's file can never be added to a requirement", async () => {
    const owner = await applicantWithSession('group-sec-owner');
    const attacker = await applicantWithSession('group-sec-attacker');
    const ownersFile = await uploadFile(owner.accessToken);
    const res = await send(attacker.accessToken, attacker.session, LICENSE, 'POST', { objectKey: ownersFile, revision: attacker.session.revision, mode: 'add' });
    expect(res.status).toBe(403);
    expect(await ledger(ownersFile)).toMatchObject({ session_id: null, deleted_at: null });
  });

  it("another applicant cannot add to, replace in, or remove from someone else's session", async () => {
    const owner = await applicantWithSession('group-sec-session-owner');
    const attacker = await applicantWithSession('group-sec-session-attacker');
    const ownersFile = await uploadFile(owner.accessToken);
    const current = await add(owner.accessToken, owner.session, LICENSE, ownersFile);
    const attackersFile = await uploadFile(attacker.accessToken);

    const adding = await send(attacker.accessToken, current, LICENSE, 'POST', { objectKey: attackersFile, revision: current.revision, mode: 'add' });
    const replacing = await send(attacker.accessToken, current, LICENSE, 'POST', { objectKey: attackersFile, revision: current.revision, replaceObjectKey: ownersFile });
    const removing = await send(attacker.accessToken, current, LICENSE, 'DELETE', { revision: current.revision, objectKey: ownersFile });

    expect([adding.status, replacing.status, removing.status]).toEqual([404, 404, 404]);
    expect(await env.UPLOADS_BUCKET.head(ownersFile)).not.toBeNull();
  });

  it('an attachment list sent through the generic PATCH is discarded — it can never be forged', async () => {
    const { accessToken, session } = await applicantWithSession('group-sec-forge');
    const forged = { [LICENSE]: [{ name: 'x', size: 1, type: 'image/jpeg', objectKey: 'uploads/999/not-mine.jpg' }, { name: 'y', size: 1, type: 'image/jpeg', objectKey: 'uploads/999/also-not.jpg' }] };
    const res = await patch(accessToken, session.sessionId, session.revision, { formData: { documentAttachments: forged } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TestSession).formData.documentAttachments).toBeUndefined();
  });

  it('a stored attachment list survives a client re-sending stale formData', async () => {
    const { accessToken, session } = await applicantWithSession('group-sec-stale');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    let current = await add(accessToken, session, LICENSE, a);
    current = await add(accessToken, current, LICENSE, b);
    const res = await patch(accessToken, current.sessionId, current.revision, { formData: { ...current.formData, documentAttachments: {} } });
    expect(keys((await res.json()) as TestSession)).toEqual([a, b]);
  });

  it('a file attached to one requirement cannot also be added to another', async () => {
    const { accessToken, session } = await applicantWithSession('group-sec-cross-slot');
    const file = await uploadFile(accessToken);
    const current = await add(accessToken, session, LICENSE, file);
    const res = await send(accessToken, current, 'cpr_cert', 'POST', { objectKey: file, revision: current.revision, mode: 'add' });
    expect(res.status).toBe(422);
  });

  it('file-type restrictions still apply to every added attachment', async () => {
    const { accessToken, session } = await applicantWithSession('group-sec-type');
    const word = await uploadFile(accessToken, fakeFile('letter.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 100));
    const res = await send(accessToken, session, LICENSE, 'POST', { objectKey: word, revision: session.revision, mode: 'add' });
    expect(res.status).toBe(415);
  });

  it('a stale revision adds nothing', async () => {
    const { accessToken, session } = await applicantWithSession('group-sec-revision');
    const a = await uploadFile(accessToken);
    const current = await add(accessToken, session, LICENSE, a);
    const b = await uploadFile(accessToken);
    const res = await send(accessToken, current, LICENSE, 'POST', { objectKey: b, revision: session.revision, mode: 'add' });
    expect(res.status).toBe(409);
  });
});

describe('attachment groups — final submission and Admin', () => {
  it('every attachment is promoted to the application; removed and replaced ones are not', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('group-submit'));
    let current = await completePacketExceptReview(accessToken, 'icu_rn');
    const initialLicense = keys(current)[0];

    const back = await uploadFile(accessToken);
    current = await add(accessToken, current, LICENSE, back);
    const dropped = await uploadFile(accessToken);
    current = await add(accessToken, current, LICENSE, dropped);
    current = (await (await send(accessToken, current, LICENSE, 'DELETE', { revision: current.revision, objectKey: dropped })).json()) as TestSession;

    const submitted = await submit(accessToken, current.sessionId, current.revision);
    expect(submitted.status).toBe(201);
    const { applicationId } = (await submitted.json()) as { applicationId: string };

    const cookie = await loginAsAdmin();
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as {
      documents: { id: number; docType: string; objectKey: string }[];
      payload: { documentAttachments: Record<string, { objectKey: string }[]> };
    };
    const licenseDocs = await withStorageKeys(detail.documents.filter((d) => d.docType === LICENSE));
    expect(licenseDocs.map((d) => d.objectKey)).toEqual([initialLicense, back]);
    // The snapshot keeps the order; its storage keys stay inside the Worker.
    const snapshot = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const attachments = (JSON.parse(snapshot!.payload_json) as { documentAttachments: Record<string, { objectKey: string }[]> }).documentAttachments;
    expect(attachments[LICENSE].map((f) => f.objectKey)).toEqual([initialLicense, back]);
    expect(JSON.stringify(detail)).not.toContain(initialLicense);
    for (const doc of licenseDocs) {
      const download = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${doc.id}/download`, { headers: { cookie } });
      expect(download.status).toBe(200);
      await download.arrayBuffer();
    }
  });

  it("a declined vaccine's attachments are excluded from the application, however many there were", async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('group-declined'));
    // general_rn's walk declines every vaccine; these proofs were uploaded before that answer.
    let current = await completePacketExceptReview(accessToken, 'general_rn');
    const a = await uploadFile(accessToken);
    const b = await uploadFile(accessToken);
    current = await add(accessToken, current, 'hep_b_vaccination_proof', a);
    current = await add(accessToken, current, 'hep_b_vaccination_proof', b);

    const submitted = await submit(accessToken, current.sessionId, current.revision);
    expect(submitted.status).toBe(201);
    const { applicationId } = (await submitted.json()) as { applicationId: string };

    const docs = await env.DB.prepare('SELECT doc_type FROM application_documents WHERE application_id = ?').bind(applicationId).all<{ doc_type: string | null }>();
    expect(docs.results.some((d) => d.doc_type === 'hep_b_vaccination_proof')).toBe(false);
    const app = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const payload = JSON.parse(app!.payload_json) as { documentAttachments?: Record<string, unknown> };
    expect(payload.documentAttachments?.hep_b_vaccination_proof).toBeUndefined();
  });

  it('no attachment can be added, replaced or removed once the application is submitted', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('group-immutable'));
    const current = await completePacketExceptReview(accessToken, 'icu_rn');
    const licenseKey = keys(current)[0];
    expect((await submit(accessToken, current.sessionId, current.revision)).status).toBe(201);
    const latest = (await (await SELF.fetch(`${BASE}/api/sessions/${current.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json()) as TestSession;

    const file = await uploadFile(accessToken);
    const statuses = await Promise.all([
      send(accessToken, latest, LICENSE, 'POST', { objectKey: file, revision: latest.revision, mode: 'add' }),
      send(accessToken, latest, LICENSE, 'POST', { objectKey: file, revision: latest.revision, replaceObjectKey: licenseKey }),
      send(accessToken, latest, LICENSE, 'DELETE', { revision: latest.revision, objectKey: licenseKey }),
    ]);
    expect(statuses.map((r) => r.status)).toEqual([409, 409, 409]);
    expect(await env.UPLOADS_BUCKET.head(licenseKey!)).not.toBeNull();
  });
});
