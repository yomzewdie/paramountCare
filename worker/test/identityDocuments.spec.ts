import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { completePacketExceptReview, fakeFile, patch, submit, type TestSession } from './submissionFixtures';
import { adminApi, attach, attachOk, auth, clinicianIdForEmail, corrections, decide, inProgress, review, type SessionState } from './workflowFixtures';

// Paramount Care's Identity Documents (Driver's License, Social Security
// Card): its own onboarding requirement, separate from the federal I-9
// document selection, which may reuse those uploads only by the applicant's
// own explicit, legally applicable choice.

const VERIFICATIONS = ['background_check', 'reference_verification', 'i9_verification', 'w4_verification'] as const;
const file = (name: string) => fakeFile(name, 'image/jpeg', 120);

function reuse(token: string, s: TestSession, docType: string, body: Record<string, unknown>) {
  return SELF.fetch(`${BASE}/api/sessions/${s.sessionId}/documents/${docType}/reuse`, {
    method: 'PUT', headers: auth(token), body: JSON.stringify({ revision: s.revision, ...body }),
  });
}

function stopReusing(token: string, s: TestSession, docType: string) {
  return SELF.fetch(`${BASE}/api/sessions/${s.sessionId}/documents/${docType}/reuse`, {
    method: 'DELETE', headers: auth(token), body: JSON.stringify({ revision: s.revision }),
  });
}

async function ok(res: Response | Promise<Response>): Promise<SessionState> {
  const r = await res;
  const body = await r.json();
  expect(r.status, JSON.stringify(body)).toBe(200);
  return body as SessionState;
}

const DL_AS_LIST_B = { source: 'drivers_license' };
const SSC_AS_LIST_C = { source: 'social_security_card', confirmUnrestricted: true };

/** A packet completed except Review, then switched to reusing the Identity
 * Documents uploads as List B + List C (its separate List A removed). */
async function readyReusingIdentityDocuments(label: string) {
  const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  let s: TestSession = await completePacketExceptReview(accessToken, 'icu_rn');
  s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));
  s = await ok(reuse(accessToken, s, 'list_c', SSC_AS_LIST_C));
  s = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}/documents/list_a`, { method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: s.revision }) }));
  return { accessToken, email, session: s, clinicianId: await clinicianIdForEmail(email) };
}

describe('the Identity Documents step', () => {
  it("takes a Driver's License (front and back) and a Social Security Card through the existing upload routes, and completes only with both", async () => {
    const { accessToken, session } = await inProgress('idocs-step');
    let s = await attachOk(accessToken, session, 'drivers_license', file('dl-front.jpg'));
    s = await attachOk(accessToken, s, 'drivers_license', file('dl-back.jpg'), { mode: 'add' });
    expect((s.formData.documentAttachments as Record<string, { name: string }[]>).drivers_license.map((f) => f.name)).toEqual(['dl-front.jpg', 'dl-back.jpg']);

    const early = await patch(accessToken, s.sessionId, s.revision, { stepStates: { identity_documents: 'completed' } });
    expect(early.status).toBe(422);

    s = await attachOk(accessToken, s, 'social_security_card', file('ss-card.jpg'));
    const done = await patch(accessToken, s.sessionId, s.revision, { stepStates: { identity_documents: 'completed' } });
    expect(done.status).toBe(200);
    // Uploading them never fills the I-9: the Documents step still needs its own selection.
    const documents = await patch(accessToken, s.sessionId, ((await done.json()) as TestSession).revision, { stepStates: { documents: 'completed' } });
    expect(documents.status).toBe(422);
  });

  it('a session without them cannot be submitted', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('idocs-required'));
    let s: TestSession = await completePacketExceptReview(accessToken, 'icu_rn');
    s = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}/documents/social_security_card`, { method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: s.revision }) }));
    const res = await submit(accessToken, s.sessionId, s.revision);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { incompleteSteps: { id: string }[] }).incompleteSteps.map((x) => x.id)).toContain('identity_documents');
  });
});

describe('reusing an Identity Documents upload for the I-9', () => {
  it('List B = the Driver\'s License and List C = the Social Security card satisfy the I-9 and submit, with each file stored once', async () => {
    const { accessToken, session, clinicianId } = await readyReusingIdentityDocuments('reuse-submit');
    expect(session.formData.i9DocumentReuse).toEqual({
      list_b: { source: 'drivers_license', selectedAt: expect.any(String) },
      list_c: { source: 'social_security_card', selectedAt: expect.any(String), unrestrictedConfirmed: true },
    });
    const res = await submit(accessToken, session.sessionId, session.revision);
    expect(res.status).toBe(201);
    const { applicationId } = (await res.json()) as { applicationId: string };

    const docTypes = (await env.DB.prepare('SELECT doc_type FROM application_documents WHERE application_id = ? AND doc_type IS NOT NULL ORDER BY doc_type')
      .bind(applicationId).all<{ doc_type: string }>()).results.map((r) => r.doc_type);
    expect(docTypes.filter((t) => t === 'drivers_license' || t === 'social_security_card')).toEqual(['drivers_license', 'social_security_card']);
    expect(docTypes.filter((t) => t.startsWith('list_'))).toEqual([]);

    // Admin: Identity Documents and the I-9 are separate reviews; the I-9
    // shows the reused files and says so.
    const cookie = await loginAsAdmin();
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(review(detail, 'drivers_license')).toMatchObject({ required: true, label: "Driver's License" });
    expect(review(detail, 'social_security_card')).toMatchObject({ required: true, label: 'Social Security Card' });
    const i9 = review(detail, 'i9_identity');
    expect(i9.files.map((f) => f.docType)).toEqual(['drivers_license', 'social_security_card']);
    expect((i9 as unknown as { reusedFor: unknown }).reusedFor).toEqual([{ slot: 'list_b', source: 'drivers_license' }, { slot: 'list_c', source: 'social_security_card' }]);
    expect(JSON.stringify(detail)).not.toMatch(/uploads\/|objectKey|r2\.dev/);
  });

  it('only the legal pairings, List C only with the restriction confirmed, and only once the document is uploaded', async () => {
    const { accessToken, session } = await inProgress('reuse-rules');
    expect((await reuse(accessToken, session, 'list_b', DL_AS_LIST_B)).status).toBe(409); // nothing uploaded yet
    let s = await attachOk(accessToken, session, 'drivers_license', file('dl.jpg'));
    s = await attachOk(accessToken, s, 'social_security_card', file('ss.jpg'));

    expect((await reuse(accessToken, s, 'list_a', DL_AS_LIST_B)).status).toBe(422);
    expect((await reuse(accessToken, s, 'list_b', { source: 'social_security_card', confirmUnrestricted: true })).status).toBe(422);
    expect((await reuse(accessToken, s, 'list_c', { source: 'drivers_license', confirmUnrestricted: true })).status).toBe(422);
    expect((await reuse(accessToken, s, 'list_c', { source: 'social_security_card' })).status).toBe(422);
    expect((await reuse(accessToken, s, 'list_c', { source: 'social_security_card', confirmUnrestricted: false })).status).toBe(422);
    expect((await reuse(accessToken, s, 'cpr_cert', DL_AS_LIST_B)).status).toBe(422);
    expect((await reuse(accessToken, s, 'constructor', DL_AS_LIST_B)).status).toBe(422);
    const unchanged = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, { headers: auth(accessToken) }));
    expect(unchanged.formData.i9DocumentReuse).toBeUndefined();

    s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));
    s = await ok(reuse(accessToken, s, 'list_c', SSC_AS_LIST_C));
    expect(Object.keys(s.formData.i9DocumentReuse as object)).toEqual(['list_b', 'list_c']);
  });

  it('a file of its own replaces a reused upload, choosing reuse retires a file of its own, and clearing removes it', async () => {
    const { accessToken, session } = await inProgress('reuse-switch');
    let s = await attachOk(accessToken, session, 'drivers_license', file('dl.jpg'));
    s = await attachOk(accessToken, s, 'list_b', file('state-id.jpg'));
    const ownKey = (s.formData.uploadedDocuments as { listB: { objectKey: string } }).listB.objectKey;

    s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));
    expect((s.formData.uploadedDocuments as { listB: unknown }).listB).toBeNull();
    expect(await env.UPLOADS_BUCKET.head(ownKey)).toBeNull(); // never submitted: cleaned up

    s = await attachOk(accessToken, s, 'list_b', file('state-id-2.jpg'));
    expect(s.formData.i9DocumentReuse).toBeUndefined();

    s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));
    s = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}/documents/list_b`, { method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: s.revision }) }));
    expect(s.formData.i9DocumentReuse).toBeUndefined();

    s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));
    s = await ok(stopReusing(accessToken, s, 'list_b'));
    expect(s.formData.i9DocumentReuse).toBeUndefined();
    // The Identity Documents upload itself is untouched throughout.
    expect((s.formData.uploadedDocuments as { driversLicense: { name: string } }).driversLicense.name).toBe('dl.jpg');
  });

  it('is server-owned: the generic PATCH can neither set nor change it', async () => {
    const { accessToken, session } = await inProgress('reuse-patch');
    let s = await attachOk(accessToken, session, 'drivers_license', file('dl.jpg'));
    const forged = { list_b: { source: 'drivers_license', selectedAt: 'x' }, list_c: { source: 'social_security_card', selectedAt: 'x', unrestrictedConfirmed: true } };
    let res = await patch(accessToken, s.sessionId, s.revision, { formData: { ...s.formData, i9DocumentReuse: forged } });
    expect(res.status).toBe(200);
    s = (await res.json()) as SessionState;
    expect(s.formData.i9DocumentReuse).toBeUndefined();

    s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));
    res = await patch(accessToken, s.sessionId, s.revision, { formData: { ...s.formData, i9DocumentReuse: forged } });
    expect(((await res.json()) as SessionState).formData.i9DocumentReuse).toEqual({ list_b: expect.objectContaining({ source: 'drivers_license' }) });
  });
});

describe('reuse: ownership and IDOR', () => {
  it("another applicant, or no one, can't set or clear a reuse on someone else's session", async () => {
    const owner = await inProgress('reuse-idor-owner');
    const stranger = await inProgress('reuse-idor-stranger');
    let s = await attachOk(owner.accessToken, owner.session, 'drivers_license', file('dl.jpg'));

    expect((await reuse(stranger.accessToken, s, 'list_b', DL_AS_LIST_B)).status).toBe(404);
    expect((await stopReusing(stranger.accessToken, s, 'list_b')).status).toBe(404);
    const anonymous = await SELF.fetch(`${BASE}/api/sessions/${s.sessionId}/documents/list_b/reuse`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: s.revision, ...DL_AS_LIST_B }) });
    expect(anonymous.status).toBe(401);

    s = await ok(reuse(owner.accessToken, s, 'list_b', DL_AS_LIST_B));
    expect((await stopReusing(stranger.accessToken, s, 'list_b')).status).toBe(404);
    const still = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, { headers: auth(owner.accessToken) }));
    expect(still.formData.i9DocumentReuse).toEqual({ list_b: expect.objectContaining({ source: 'drivers_license' }) });
  });

  it("a reuse only ever resolves to the applicant's own session: another applicant's upload, or an object key, can't be named", async () => {
    const owner = await inProgress('reuse-cross-owner');
    const other = await inProgress('reuse-cross-other');
    const ownerSession = await attachOk(owner.accessToken, owner.session, 'drivers_license', file('owner-dl.jpg'));
    const ownerKey = (ownerSession.formData.uploadedDocuments as { driversLicense: { objectKey: string } }).driversLicense.objectKey;

    // The other applicant has no license of their own: refused, whatever the body says.
    expect((await reuse(other.accessToken, other.session, 'list_b', DL_AS_LIST_B)).status).toBe(409);
    expect((await reuse(other.accessToken, other.session, 'list_b', { source: ownerKey })).status).toBe(422);
    expect((await reuse(other.accessToken, other.session, 'list_b', { ...DL_AS_LIST_B, objectKey: ownerKey, sessionId: ownerSession.sessionId })).status).toBe(409);

    // Nor can the owner's file be attached to the other session directly.
    expect((await attach(other.accessToken, other.session, 'list_b', file('x.jpg'), { objectKey: ownerKey })).status).toBe(403);
    const otherNow = await ok(SELF.fetch(`${BASE}/api/sessions/${other.session.sessionId}`, { headers: auth(other.accessToken) }));
    expect(JSON.stringify(otherNow.formData)).not.toContain(ownerKey);

    // The admin view of the other clinician holds nothing of the owner's.
    const cookie = await loginAsAdmin();
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${other.clinicianId}`));
    expect(review(detail, 'i9_identity').files).toEqual([]);
    expect(review(detail, 'drivers_license').files).toEqual([]);
  });
});

describe('after final submission', () => {
  it('reuse is locked like every other document unless the I-9 correction is open; a license correction reopens only the license', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, clinicianId } = await readyReusingIdentityDocuments('after-reuse');
    expect((await submit(accessToken, session.sessionId, session.revision)).status).toBe(201);
    let s = await ok(SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: auth(accessToken) }));

    expect((await stopReusing(accessToken, s, 'list_b')).status).toBe(409);
    expect((await attach(accessToken, s, 'drivers_license', file('dl-new.jpg'))).status).toBe(409);

    // A Driver's License correction reopens the license only — not the I-9
    // slots, not the Social Security card.
    await decide(cookie, clinicianId, 'drivers_license', 'needs_correction', 'Expired license');
    expect((await corrections(accessToken, s.sessionId)).map((c) => [c.requirement, c.docTypes])).toEqual([['drivers_license', ['drivers_license']]]);
    expect((await stopReusing(accessToken, s, 'list_b')).status).toBe(409);
    expect((await attach(accessToken, s, 'social_security_card', file('ss-new.jpg'))).status).toBe(409);
    expect((await attach(accessToken, s, 'list_b', file('state-id.jpg'))).status).toBe(409);

    // The applicant fixes the license; the I-9 document reusing it changed too,
    // so the I-9 review is flagged for another look.
    await decide(cookie, clinicianId, 'i9_identity', 'accepted');
    const oldKey = (s.formData.uploadedDocuments as { driversLicense: { objectKey: string } }).driversLicense.objectKey;
    s = await attachOk(accessToken, s, 'drivers_license', file('dl-renewed.jpg'), { replaceObjectKey: oldKey });
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(review(detail, 'drivers_license')).toMatchObject({ status: 'pending', correctionOpen: true });
    expect(review(detail, 'i9_identity')).toMatchObject({ status: 'pending', changedAfterReview: true });
    expect(review(detail, 'i9_identity').files.map((f) => f.fileName)).toContain('dl-renewed.jpg');
    expect(await env.UPLOADS_BUCKET.head(oldKey)).not.toBeNull(); // submitted: kept, superseded

    // An I-9 correction reopens the I-9 slots: the applicant may switch List B
    // to a separate upload, and the Identity Documents stay locked.
    await decide(cookie, clinicianId, 'drivers_license', 'accepted');
    await decide(cookie, clinicianId, 'i9_identity', 'needs_correction', 'Use a different List B document');
    s = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, { headers: auth(accessToken) }));
    s = await attachOk(accessToken, s, 'list_b', file('state-id.jpg'));
    expect(s.formData.i9DocumentReuse).toEqual({ list_c: expect.objectContaining({ source: 'social_security_card' }) });
    expect((await attach(accessToken, s, 'social_security_card', file('ss-new.jpg'))).status).toBe(409);
  });
});

describe('clearance', () => {
  it("the Driver's License and Social Security Card must be Accepted, like any other required document", async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail('idocs-clear'));
    const s = await completePacketExceptReview(accessToken, 'icu_rn');
    expect((await submit(accessToken, s.sessionId, s.revision)).status).toBe(201);
    const clinicianId = await clinicianIdForEmail(email);

    let detail = await api.ok(api.get(`/${clinicianId}`));
    for (const req of detail.documentReviews.requirements.filter((r) => r.required && r.requirement !== 'social_security_card')) {
      detail = await api.ok(api.put(`/${clinicianId}/document-reviews/${req.requirement}`, { status: 'accepted', expectedUpdatedAt: req.updatedAt }));
    }
    for (const kind of VERIFICATIONS) detail = await api.ok(api.put(`/${clinicianId}/verifications/${kind}`, { status: 'complete' }));
    expect(detail.clearance.ready).toBe(false);
    expect(detail.clearance.checklist.find((i) => i.key === 'documents')!.detail).toEqual(['Social Security Card']);
    expect((await api.post(`/${clinicianId}/clearance`, {})).status).toBe(409);

    detail = await decide(cookie, clinicianId, 'social_security_card', 'needs_correction', 'Blurry');
    expect(detail.clearance.ready).toBe(false);
    detail = await decide(cookie, clinicianId, 'social_security_card', 'accepted');
    expect(detail.clearance.ready).toBe(true);
  });
});

describe('applications submitted before Identity Documents existed', () => {
  it('stay readable, 100% complete, and clearable without them; nothing in them is rewritten', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail('idocs-historical'));
    const s = await completePacketExceptReview(accessToken, 'icu_rn');
    const submitted = await submit(accessToken, s.sessionId, s.revision);
    expect(submitted.status).toBe(201);
    const { applicationId } = (await submitted.json()) as { applicationId: string };
    const clinicianId = await clinicianIdForEmail(email);

    // As it was stored before the step existed: no identity documents, no step state.
    const row = await env.DB.prepare('SELECT form_data_json, step_states_json FROM onboarding_sessions WHERE session_id = ?').bind(s.sessionId).first<{ form_data_json: string; step_states_json: string }>();
    const formData = JSON.parse(row!.form_data_json);
    delete formData.uploadedDocuments.driversLicense;
    delete formData.uploadedDocuments.socialSecurityCard;
    const stepStates = JSON.parse(row!.step_states_json);
    delete stepStates.identity_documents;
    const historicalForm = JSON.stringify(formData);
    const historicalSteps = JSON.stringify(stepStates);
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ?, step_states_json = ? WHERE session_id = ?').bind(historicalForm, historicalSteps, s.sessionId).run();
    await env.DB.prepare(`DELETE FROM application_documents WHERE application_id = ? AND doc_type IN ('drivers_license', 'social_security_card')`).bind(applicationId).run();

    const mine = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, { headers: auth(accessToken) }));
    expect(mine.completionPercent).toBe(100);

    let detail = await api.ok(api.get(`/${clinicianId}`));
    expect(detail.documentReviews.requirements.map((r) => r.requirement)).not.toContain('drivers_license');
    expect(detail.documentReviews.requirements.map((r) => r.requirement)).not.toContain('social_security_card');
    for (const req of detail.documentReviews.requirements.filter((r) => r.required)) {
      detail = await api.ok(api.put(`/${clinicianId}/document-reviews/${req.requirement}`, { status: 'accepted', expectedUpdatedAt: req.updatedAt }));
    }
    for (const kind of VERIFICATIONS) detail = await api.ok(api.put(`/${clinicianId}/verifications/${kind}`, { status: 'complete' }));
    expect(detail.clearance.ready).toBe(true);

    const after = await env.DB.prepare('SELECT form_data_json, step_states_json FROM onboarding_sessions WHERE session_id = ?').bind(s.sessionId).first<{ form_data_json: string; step_states_json: string }>();
    expect(after).toEqual({ form_data_json: historicalForm, step_states_json: historicalSteps });
  });
});

describe('editing before and after final submission', () => {
  it('before submission every completed section stays editable; after it, answers and documents are locked', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('edit-lifecycle'));
    let s: TestSession = await completePacketExceptReview(accessToken, 'icu_rn');
    expect(s.stepStates.personal_info).toBe('completed');

    // Change an answer in a completed section, and replace a completed document.
    const res = await patch(accessToken, s.sessionId, s.revision, {
      formData: { ...s.formData, personalInfo: { ...(s.formData.personalInfo as object), city: 'Pasadena' } },
    });
    expect(res.status).toBe(200);
    s = (await res.json()) as TestSession;
    expect((s.formData.personalInfo as { city: string }).city).toBe('Pasadena');
    expect(s.stepStates.personal_info).toBe('completed');
    s = await attachOk(accessToken, s, 'social_security_card', file('ss-retake.jpg'));
    s = await ok(reuse(accessToken, s, 'list_b', DL_AS_LIST_B));

    expect((await submit(accessToken, s.sessionId, s.revision)).status).toBe(201);
    s = await ok(SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, { headers: auth(accessToken) }));
    const locked = await patch(accessToken, s.sessionId, s.revision, { formData: { ...s.formData, personalInfo: { ...(s.formData.personalInfo as object), city: 'Burbank' } } });
    expect(locked.status).toBe(409);
    expect((await patch(accessToken, s.sessionId, s.revision, { stepStates: { personal_info: 'in_progress' } })).status).toBe(409);
    expect((await attach(accessToken, s, 'social_security_card', file('ss-3.jpg'))).status).toBe(409);
    expect((await reuse(accessToken, s, 'list_c', SSC_AS_LIST_C)).status).toBe(409);
    expect((await stopReusing(accessToken, s, 'list_b')).status).toBe(409);
  });
});
