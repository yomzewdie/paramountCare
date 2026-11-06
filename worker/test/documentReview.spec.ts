import { SELF, env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { fakeFile, patch, submittedSession, uploadFile } from './submissionFixtures';
import { adminApi, attach, attachOk, auditActions, auth, clinicianIdForEmail, corrections, decide, inProgress, review } from './workflowFixtures';

// Admin review of each LOGICAL document requirement, and the correction flow
// it drives — before submission, and as a targeted reopening after it.

describe('document review', () => {
  it('lists each logical requirement once, Pending until reviewed, with its files', async () => {
    const { accessToken, session, clinicianId } = await inProgress('review-list');
    let current = await attachOk(accessToken, session, 'nursing_license', fakeFile('front.jpg', 'image/jpeg', 100));
    current = await attachOk(accessToken, current, 'nursing_license', fakeFile('back.jpg', 'image/jpeg', 100), { mode: 'add' });
    current = await attachOk(accessToken, current, 'list_b', fakeFile('license-b.jpg', 'image/jpeg', 100));
    await attachOk(accessToken, current, 'list_c', fakeFile('ssn-c.jpg', 'image/jpeg', 100));

    const detail = await adminApi(await loginAsAdmin()).ok(adminApi(await loginAsAdmin()).get(`/${clinicianId}`));
    expect(detail.documentReviews.source).toBe('session');
    const license = review(detail, 'nursing_license');
    expect(license).toMatchObject({ required: false, status: 'pending', hasFiles: true, label: 'Professional license / certification' });
    expect(license.files.map((f) => f.fileName)).toEqual(['front.jpg', 'back.jpg']);
    // List B + List C are one I-9 identity requirement.
    const identity = review(detail, 'i9_identity');
    expect(identity.files.map((f) => f.fileName)).toEqual(['license-b.jpg', 'ssn-c.jpg']);
    expect(detail.documentReviews.requirements.filter((r) => r.requirement === 'list_b' || r.requirement === 'list_c')).toEqual([]);
    // Required but not uploaded yet: listed, no files, cannot be accepted.
    expect(review(detail, 'cpr_cert')).toMatchObject({ required: true, hasFiles: false, files: [] });
    expect(JSON.stringify(detail)).not.toContain('uploads/');
  });

  it('accepts a whole multi-file requirement once; Needs Correction requires a reason', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, clinicianId } = await inProgress('review-decide');
    const current = await attachOk(accessToken, session, 'nursing_license', fakeFile('front.jpg', 'image/jpeg', 100));
    await attachOk(accessToken, current, 'nursing_license', fakeFile('back.jpg', 'image/jpeg', 100), { mode: 'add' });
    const api = adminApi(cookie);

    expect((await api.put(`/${clinicianId}/document-reviews/nursing_license`, { status: 'needs_correction', expectedUpdatedAt: null })).status).toBe(422);
    expect((await api.put(`/${clinicianId}/document-reviews/nursing_license`, { status: 'needs_correction', note: '  ', expectedUpdatedAt: null })).status).toBe(422);
    expect((await api.put(`/${clinicianId}/document-reviews/nursing_license`, { status: 'approved' })).status).toBe(422);
    expect((await api.put(`/${clinicianId}/document-reviews/cpr_cert`, { status: 'accepted', expectedUpdatedAt: null })).status).toBe(409); // no files yet
    expect((await api.put(`/${clinicianId}/document-reviews/mmr_proof`, { status: 'accepted' })).status).toBe(404);

    const accepted = await decide(cookie, clinicianId, 'nursing_license', 'accepted');
    expect(review(accepted, 'nursing_license')).toMatchObject({ status: 'accepted', note: null, changedAfterReview: false });
    expect(accepted.clinician.documentReview).toEqual({ pending: 0, accepted: 1, needsCorrection: 0 });
    const corrected = await decide(cookie, clinicianId, 'nursing_license', 'needs_correction', 'Back side is blurry');
    expect(review(corrected, 'nursing_license')).toMatchObject({ status: 'needs_correction', note: 'Back side is blurry', correctionOpen: true });

    const actions = (await auditActions(clinicianId)).filter((a) => a.action.startsWith('document_'));
    expect(actions.map((a) => [a.action, a.metadata.requirement])).toEqual([
      ['document_accepted', 'nursing_license'], ['document_correction_requested', 'nursing_license'],
    ]);
    expect(actions[1].metadata).toMatchObject({ note: 'Back side is blurry', previousStatus: 'accepted' });
  });

  it('a decision made against documents that changed since is refused', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, clinicianId } = await inProgress('review-stale');
    const current = await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));
    const api = adminApi(cookie);
    const seen = review(await api.ok(api.get(`/${clinicianId}`)), 'cpr_cert');
    await decide(cookie, clinicianId, 'cpr_cert', 'accepted');
    await attachOk(accessToken, current, 'cpr_cert', fakeFile('cpr-2.jpg', 'image/jpeg', 100), { mode: 'add' });
    const stale = await api.put(`/${clinicianId}/document-reviews/cpr_cert`, { status: 'accepted', expectedUpdatedAt: seen.updatedAt });
    expect(stale.status).toBe(409);
  });

  it('a file added, replaced or removed after review resets Accepted to Pending, marked and audited', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, clinicianId } = await inProgress('review-reset');
    let current = await attachOk(accessToken, session, 'list_a', fakeFile('passport.jpg', 'image/jpeg', 100));
    await decide(cookie, clinicianId, 'i9_identity', 'accepted');

    current = await attachOk(accessToken, current, 'list_a', fakeFile('passport-2.jpg', 'image/jpeg', 100), { mode: 'add' });
    const after = review(await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`)), 'i9_identity');
    expect(after).toMatchObject({ status: 'pending', changedAfterReview: true });
    const reset = (await auditActions(clinicianId)).find((a) => a.action === 'document_review_reset')!;
    expect(reset.metadata).toMatchObject({ requirement: 'i9_identity', previousStatus: 'accepted', reason: 'applicant_changed_files' });

    // Re-accepting clears the mark; removing a file resets it again.
    await decide(cookie, clinicianId, 'i9_identity', 'accepted');
    const remove = await SELF.fetch(`${BASE}/api/sessions/${current.sessionId}/documents/list_a`, {
      method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: current.revision, objectKey: (current.formData.documentAttachments as Record<string, { objectKey: string }[]>).list_a[1].objectKey }),
    });
    expect(remove.status).toBe(200);
    expect(review(await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`)), 'i9_identity')).toMatchObject({ status: 'pending', changedAfterReview: true });
  });

  it('an applicant can neither change a review nor write review data through the session', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, clinicianId } = await inProgress('review-applicant');
    const current = await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));
    await decide(cookie, clinicianId, 'cpr_cert', 'needs_correction', 'Expired card');

    const res = await SELF.fetch(`${BASE}/api/admin/clinicians/${clinicianId}/document-reviews/cpr_cert`, { method: 'PUT', headers: auth(accessToken), body: JSON.stringify({ status: 'accepted' }) });
    expect(res.status).toBe(403);
    await patch(accessToken, current.sessionId, current.revision, { formData: { ...current.formData, documentReviews: { cpr_cert: 'accepted' }, corrections: [] } });
    const row = await env.DB.prepare('SELECT status, note FROM document_reviews WHERE clinician_id = ? AND requirement = ?').bind(clinicianId, 'cpr_cert').first();
    expect(row).toEqual({ status: 'needs_correction', note: 'Expired card' });
  });
});

describe('correction before submission', () => {
  it('the applicant sees which document needs attention and why; fixing it sends it back for review', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, clinicianId } = await inProgress('correct-before');
    let current = await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));
    current = await attachOk(accessToken, current, 'list_a', fakeFile('passport.jpg', 'image/jpeg', 100));
    await decide(cookie, clinicianId, 'cpr_cert', 'needs_correction', 'Card is expired');
    await decide(cookie, clinicianId, 'i9_identity', 'accepted');

    // Only the requested document is listed.
    expect(await corrections(accessToken, current.sessionId)).toEqual([
      { requirement: 'cpr_cert', label: 'CPR / BLS certification', docTypes: ['cpr_cert'], status: 'needs_correction', note: 'Card is expired', requestedAt: expect.any(String) },
    ]);

    const fixed = await attachOk(accessToken, current, 'cpr_cert', fakeFile('cpr-new.jpg', 'image/jpeg', 100), { replaceObjectKey: (current.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey });
    expect(fixed.status).toBe('active');
    expect(await corrections(accessToken, current.sessionId)).toEqual([expect.objectContaining({ requirement: 'cpr_cert', status: 'pending', note: 'Card is expired' })]);
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(review(detail, 'cpr_cert')).toMatchObject({ status: 'pending', changedAfterReview: true, correctionOpen: true });
    expect(review(detail, 'i9_identity').status).toBe('accepted');
    expect((await auditActions(clinicianId)).map((a) => a.action)).toContain('document_correction_uploaded');

    // Reviewing again closes the correction.
    await decide(cookie, clinicianId, 'cpr_cert', 'accepted');
    expect(await corrections(accessToken, current.sessionId)).toEqual([]);
  });

  it('another applicant cannot read someone else\'s corrections', async () => {
    const { session } = await inProgress('correct-owner');
    const other = await registerVerifyAndLoginApplicant(uniqueEmail('correct-other'));
    expect((await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/corrections`, { headers: auth(other.accessToken) })).status).toBe(404);
  });
});

describe('correction after submission', () => {
  async function submitted(label: string) {
    const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
    const result = await submittedSession(accessToken);
    return { accessToken, email, clinicianId: await clinicianIdForEmail(email), ...result };
  }

  const generatedForms = async (applicationId: string) => (await env.DB.prepare(
    `SELECT object_key, file_size FROM application_documents WHERE application_id = ? AND (file_name LIKE 'I9-Section1-%' OR object_key LIKE 'w4/%') ORDER BY id`,
  ).bind(applicationId).all()).results;

  it('reopens only the requested requirement; everything else stays locked', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, clinicianId, latest, applicationId } = await submitted('after-locked');
    await decide(cookie, clinicianId, 'cpr_cert', 'needs_correction', 'Upload the back of the card too');

    // Another document, and the generic answers PATCH, stay locked.
    const other = await attach(accessToken, latest, 'list_a', fakeFile('passport.jpg', 'image/jpeg', 100));
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ reason: 'submitted' });
    const answers = await patch(accessToken, latest.sessionId, latest.revision, { formData: { ...latest.formData, personalInfo: { firstName: 'Changed' } } });
    expect(answers.status).toBe(409);
    const removeOther = await SELF.fetch(`${BASE}/api/sessions/${latest.sessionId}/documents/applicant_resume`, { method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: latest.revision }) });
    expect(removeOther.status).toBe(409);
    const submit = await SELF.fetch(`${BASE}/api/sessions/${latest.sessionId}/submit`, { method: 'POST', headers: auth(accessToken), body: JSON.stringify({ revision: latest.revision }) });
    expect((await submit.json()) as { applicationId: string }).toMatchObject({ applicationId });
    const apps = await env.DB.prepare('SELECT COUNT(*) AS n FROM applications WHERE application_id = ?').bind(applicationId).first<{ n: number }>();
    expect(apps!.n).toBe(1);
  });

  it('the corrected file joins the same application, the old one is kept as superseded, and the review returns to Pending', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, clinicianId, latest, applicationId } = await submitted('after-fix');
    const formsBefore = await generatedForms(applicationId);
    const oldKey = (latest.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey;
    await decide(cookie, clinicianId, 'cpr_cert', 'needs_correction', 'Card is expired');
    expect(await corrections(accessToken, latest.sessionId)).toEqual([expect.objectContaining({ requirement: 'cpr_cert', note: 'Card is expired' })]);

    // Replace, then Upload More — both allowed while the correction is open.
    let current = await attachOk(accessToken, latest, 'cpr_cert', fakeFile('cpr-front.jpg', 'image/jpeg', 120), { replaceObjectKey: oldKey });
    current = await attachOk(accessToken, current, 'cpr_cert', fakeFile('cpr-back.jpg', 'image/jpeg', 130), { mode: 'add' });
    expect(current.status).toBe('submitted');

    const docs = await env.DB.prepare(`SELECT object_key, file_name, doc_type, superseded_at FROM application_documents WHERE application_id = ? AND doc_type = 'cpr_cert' ORDER BY id`).bind(applicationId).all<{ object_key: string; file_name: string; superseded_at: string | null }>();
    expect(docs.results.map((d) => [d.file_name, d.superseded_at !== null])).toEqual([['cpr_cert.jpg', true], ['cpr-front.jpg', false], ['cpr-back.jpg', false]]);
    // The submitted original is kept (never deleted), just no longer current.
    expect(await env.UPLOADS_BUCKET.head(oldKey)).not.toBeNull();

    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(detail.documentReviews.source).toBe('application');
    expect(review(detail, 'cpr_cert')).toMatchObject({ status: 'pending', changedAfterReview: true, correctionOpen: true });
    expect(review(detail, 'cpr_cert').files.map((f) => f.fileName)).toEqual(['cpr-front.jpg', 'cpr-back.jpg']);
    const app = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { documents: { fileName: string; supersededAt: string | null }[] };
    expect(app.documents.filter((d) => d.supersededAt).map((d) => d.fileName)).toEqual(['cpr_cert.jpg']);

    // Same application, no regenerated I-9 or W-4.
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM applications WHERE application_id = ?').bind(applicationId).first<{ n: number }>())!.n).toBe(1);
    expect(await generatedForms(applicationId)).toEqual(formsBefore);
    const audit = (await auditActions(clinicianId)).filter((a) => a.action === 'document_correction_uploaded');
    expect(audit[0].metadata).toMatchObject({ requirement: 'cpr_cert' });

    // Once reviewed again, the requirement locks.
    await decide(cookie, clinicianId, 'cpr_cert', 'accepted');
    expect((await attach(accessToken, current, 'cpr_cert', fakeFile('cpr-3.jpg', 'image/jpeg', 100), { mode: 'add' })).status).toBe(409);
  });

  it('a correction never leaves a required document empty, but an optional one may be removed', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, clinicianId, latest } = await submitted('after-remove');
    await decide(cookie, clinicianId, 'cpr_cert', 'needs_correction', 'Expired');
    const removeCpr = await SELF.fetch(`${BASE}/api/sessions/${latest.sessionId}/documents/cpr_cert`, { method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: latest.revision }) });
    expect(removeCpr.status).toBe(422);

    await decide(cookie, clinicianId, 'nursing_license', 'needs_correction', 'Wrong license');
    const removeLicense = await SELF.fetch(`${BASE}/api/sessions/${latest.sessionId}/documents/nursing_license`, { method: 'DELETE', headers: auth(accessToken), body: JSON.stringify({ revision: latest.revision }) });
    expect(removeLicense.status).toBe(200);
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    // Removed: no longer reviewable, and no longer in the way of clearance.
    expect(detail.documentReviews.requirements.some((r) => r.requirement === 'nursing_license')).toBe(false);
    expect(detail.clearance.checklist.find((i) => i.key === 'documents')!.detail).not.toContain('Professional license / certification (correction requested)');
  });

  it('recovers when adding the corrected file to the application failed part-way, without a re-upload or duplicates', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, clinicianId, latest, applicationId } = await submitted('after-recover');
    const oldKey = (latest.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey;
    await decide(cookie, clinicianId, 'cpr_cert', 'needs_correction', 'Expired');
    const fixed = await attachOk(accessToken, latest, 'cpr_cert', fakeFile('cpr-new.jpg', 'image/jpeg', 100), { replaceObjectKey: oldKey });
    const newKey = (fixed.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey;
    const rows = async () => (await env.DB.prepare(
      `SELECT object_key, superseded_at FROM application_documents WHERE application_id = ? AND doc_type = 'cpr_cert' ORDER BY id`,
    ).bind(applicationId).all<{ object_key: string; superseded_at: string | null }>()).results.map((r) => [r.object_key, r.superseded_at !== null]);
    const expected = [[oldKey, true], [newKey, false]];
    expect(await rows()).toEqual(expected);

    // The session saved, but the application step never happened.
    const simulateFailure = async () => {
      await env.DB.prepare('DELETE FROM application_documents WHERE object_key = ?').bind(newKey).run();
      await env.DB.prepare('UPDATE application_documents SET superseded_at = NULL WHERE object_key = ?').bind(oldKey).run();
    };

    await simulateFailure();
    const repaired = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(review(repaired, 'cpr_cert').files.map((f) => f.fileName)).toEqual(['cpr-new.jpg']);
    expect(await rows()).toEqual(expected);
    await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(await rows()).toEqual(expected); // again: nothing changes

    // The applicant opening the app repairs it too.
    await simulateFailure();
    await corrections(accessToken, latest.sessionId);
    expect(await rows()).toEqual(expected);

    // Retrying the same file's association is safe: no duplicate record or audit entry.
    const retry = await SELF.fetch(`${BASE}/api/sessions/${latest.sessionId}/documents/cpr_cert`, {
      method: 'POST', headers: auth(accessToken), body: JSON.stringify({ objectKey: newKey, revision: fixed.revision, mode: 'add' }),
    });
    expect(retry.status).toBe(200);
    expect(await rows()).toEqual(expected);
    expect((await auditActions(clinicianId)).filter((a) => a.action === 'document_correction_uploaded')).toHaveLength(1);
    expect(review(await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`)), 'cpr_cert')).toMatchObject({ status: 'pending', changedAfterReview: true });
  });

  it('cross-applicant attempts are rejected during a correction', async () => {
    const cookie = await loginAsAdmin();
    const victim = await submitted('after-victim');
    await decide(cookie, victim.clinicianId, 'cpr_cert', 'needs_correction', 'Blurry');
    const attacker = await registerVerifyAndLoginApplicant(uniqueEmail('after-attacker'));

    // Not their session.
    expect((await attach(attacker.accessToken, victim.latest, 'cpr_cert', fakeFile('x.jpg', 'image/jpeg', 100))).status).toBe(404);
    // Not their file: the victim can't attach someone else's upload either.
    const foreignKey = await uploadFile(attacker.accessToken, fakeFile('foreign.jpg', 'image/jpeg', 100));
    const res = await SELF.fetch(`${BASE}/api/sessions/${victim.latest.sessionId}/documents/cpr_cert`, {
      method: 'POST', headers: auth(victim.accessToken), body: JSON.stringify({ objectKey: foreignKey, revision: victim.latest.revision, mode: 'add' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('correction notifications', () => {
  let sent: { to: string; subject: string; text: string }[] = [];

  beforeEach(() => {
    sent = [];
    fetchMock.activate();
    fetchMock.disableNetConnect();
    fetchMock
      .get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(200, (opts) => {
        sent.push(JSON.parse(String(opts.body)));
        return { id: 'email_test' };
      })
      .persist();
  });

  afterEach(() => {
    fetchMock.deactivate();
  });

  const correctionEmails = () => sent.filter((e) => e.subject === 'Action needed: please update a document');

  it('emails the document name and reason, nothing from the document itself', async () => {
    const cookie = await loginAsAdmin();
    const { accessToken, session, email, clinicianId } = await inProgress('notify');
    await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr-card.jpg', 'image/jpeg', 100));
    const decided = await adminApi(cookie).call('PUT', `/${clinicianId}/document-reviews/cpr_cert`, { status: 'needs_correction', note: 'Card is expired', expectedUpdatedAt: null });
    expect(((await decided.json()) as { correctionNotification: string }).correctionNotification).toBe('sent');

    expect(correctionEmails()).toHaveLength(1);
    const [message] = correctionEmails();
    expect(message.to).toBe(email);
    expect(message.text).toContain('CPR / BLS certification');
    expect(message.text).toContain('Card is expired');
    expect(message.text).toContain('Open the Paramount Care app');
    expect(message.text.startsWith('Hi ')).toBe(true);
    for (const s of ['cpr-card.jpg', 'uploads/', 'objectKey']) expect(message.text).not.toContain(s);
  });

  it('On Hold saves the correction and shows it in the app, but holds the email until onboarding resumes', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, session, clinicianId } = await inProgress('notify-hold');
    await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));
    await api.ok(api.post(`/${clinicianId}/hold`, { reason: 'Leave of absence' }));

    const decided = await api.call('PUT', `/${clinicianId}/document-reviews/cpr_cert`, { status: 'needs_correction', note: 'Card is expired', expectedUpdatedAt: null });
    expect(((await decided.json()) as { correctionNotification: string }).correctionNotification).toBe('suppressed_on_hold');
    expect(correctionEmails()).toHaveLength(0);
    expect(await corrections(accessToken, session.sessionId)).toEqual([expect.objectContaining({ requirement: 'cpr_cert', note: 'Card is expired' })]);

    const resumed = await api.ok(api.post(`/${clinicianId}/resume-onboarding`));
    expect(resumed.correctionNoticesSent).toBe(1);
    expect(correctionEmails()).toHaveLength(1);
    expect(correctionEmails()[0].text).toContain('Card is expired');

    // Already sent: a later hold/resume does not send it twice.
    await api.ok(api.post(`/${clinicianId}/hold`, {}));
    expect((await api.ok(api.post(`/${clinicianId}/resume-onboarding`))).correctionNoticesSent).toBe(0);
    expect(correctionEmails()).toHaveLength(1);
  });

  it('a correction already fixed before resuming is not emailed', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, session, clinicianId } = await inProgress('notify-fixed');
    const current = await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));
    await api.ok(api.post(`/${clinicianId}/hold`, {}));
    await api.ok(api.put(`/${clinicianId}/document-reviews/cpr_cert`, { status: 'needs_correction', note: 'Blurry', expectedUpdatedAt: null }));
    await attachOk(accessToken, current, 'cpr_cert', fakeFile('cpr-2.jpg', 'image/jpeg', 100), { mode: 'add' });
    expect((await api.ok(api.post(`/${clinicianId}/resume-onboarding`))).correctionNoticesSent).toBe(0);
    expect(correctionEmails()).toHaveLength(0);
  });
});

