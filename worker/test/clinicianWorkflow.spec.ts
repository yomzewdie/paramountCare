import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { createTestSession, fakeFile, submittedSession, uploadFile, type TestSession } from './submissionFixtures';
import { isRecentlyOnboarded, onboardingQueue, type ClinicianPage } from '../src/services/clinicians';
import { clearClinician, loadClinicianContext } from '../src/services/clinicianWorkflow';
import { seedApplication } from './clinicianFixtures';
import {
  adminApi, auditActions, clinicianIdForEmail, loginAsSuperAdmin, registerInvited, uploadCandidateResume, type Detail,
} from './workflowFixtures';
import { RESUME_DOCX_BASE64, fromBase64 } from './fixtures/wordFixtures';

// The recruiter's clinician workflow: New Applicants before an invitation,
// On Hold, internal verification, clearance — keyed by the clinician record.

const DAY = 24 * 60 * 60 * 1000;
const VERIFICATIONS = ['background_check', 'reference_verification', 'i9_verification', 'w4_verification'] as const;

async function newCandidate(cookie: string, label: string, extra: Record<string, unknown> = {}): Promise<Detail> {
  return adminApi(cookie).ok(adminApi(cookie).post('', { firstName: 'Cara', lastName: 'Candidate', email: uniqueEmail(label), phone: '5551230000', position: 'RN', ...extra }), 201);
}

async function list(cookie: string, params: Record<string, string> = {}): Promise<ClinicianPage> {
  const res = await SELF.fetch(`${BASE}/api/admin/clinicians?${new URLSearchParams(params)}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

/** A submitted applicant and their clinician id. */
async function submittedClinician(label: string) {
  const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  const submitted = await submittedSession(accessToken);
  return { accessToken, email, clinicianId: await clinicianIdForEmail(email), ...submitted };
}

/** Accepts every required document and completes every verification. */
async function makeClearable(cookie: string, clinicianId: number) {
  const api = adminApi(cookie);
  let detail = await api.ok(api.get(`/${clinicianId}`));
  for (const req of detail.documentReviews.requirements.filter((r) => r.required)) {
    detail = await api.ok(api.put(`/${clinicianId}/document-reviews/${req.requirement}`, { status: 'accepted', expectedUpdatedAt: req.updatedAt }));
  }
  for (const kind of VERIFICATIONS) detail = await api.ok(api.put(`/${clinicianId}/verifications/${kind}`, { status: 'complete' }));
  return detail;
}

describe('queue precedence', () => {
  const started = { submitted: false, started: true, completionPercent: 50, documentsRemaining: 3 };
  it('On Hold outranks everything, Cleared outranks Application Completed', () => {
    expect(onboardingQueue({ ...started, submitted: true, cleared: true, onHold: true })).toBe('on_hold');
    expect(onboardingQueue({ ...started, submitted: true, cleared: true })).toBe('cleared');
    expect(onboardingQueue({ ...started, submitted: true })).toBe('application_completed');
  });
  it('a clinician never invited is a New Applicant; invited but not started is Invited', () => {
    expect(onboardingQueue({ submitted: false, started: false, completionPercent: null, documentsRemaining: null, invited: false })).toBe('new_applicant');
    expect(onboardingQueue({ submitted: false, started: false, completionPercent: null, documentsRemaining: null, invited: true })).toBe('invited');
    expect(onboardingQueue({ submitted: false, started: false, completionPercent: null, documentsRemaining: null, invited: false, onHold: true })).toBe('on_hold');
  });
});

describe('Recently Onboarded', () => {
  const now = Date.parse('2026-11-20T12:00:00.000Z');
  const ago = (days: number) => new Date(now - days * DAY).toISOString();
  it('includes 13 days and exactly 14 days, excludes 15 days', () => {
    expect(isRecentlyOnboarded(ago(13), now)).toBe(true);
    expect(isRecentlyOnboarded(ago(14), now)).toBe(true);
    expect(isRecentlyOnboarded(new Date(now - 14 * DAY - 1).toISOString(), now)).toBe(false);
    expect(isRecentlyOnboarded(ago(15), now)).toBe(false);
    expect(isRecentlyOnboarded(null, now)).toBe(false);
  });
  it('filters the list by cleared date (SQLite and ISO timestamps alike)', async () => {
    const cookie = await loginAsAdmin();
    const recent = await newCandidate(cookie, 'recent-13');
    const old = await newCandidate(cookie, 'old-15');
    const sqliteTime = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
    await env.DB.prepare('UPDATE clinicians SET cleared_at = ?, cleared_by = 1 WHERE id = ?').bind(sqliteTime(Date.now() - 13 * DAY), recent.clinician.clinicianRecordId).run();
    await env.DB.prepare('UPDATE clinicians SET cleared_at = ?, cleared_by = 1 WHERE id = ?').bind(new Date(Date.now() - 15 * DAY).toISOString(), old.clinician.clinicianRecordId).run();
    const page = await list(cookie, { recentlyOnboarded: 'true' });
    expect(page.data.map((c) => c.clinicianRecordId)).toEqual([recent.clinician.clinicianRecordId]);
    expect(page.data[0].queue).toBe('cleared');
  });
});

describe('New Applicants', () => {
  it('creates a candidate before any invitation: New Applicant queue, audited', async () => {
    const cookie = await loginAsAdmin();
    const detail = await newCandidate(cookie, 'new-candidate', { recruiterNotes: 'Strong ICU background', interviewStatus: 'pending' });
    expect(detail.candidate).toMatchObject({ firstName: 'Cara', lastName: 'Candidate', phone: '5551230000', position: 'RN', recruiterNotes: 'Strong ICU background', interviewStatus: 'pending', resume: null });
    expect(detail.clinician).toMatchObject({ queue: 'new_applicant', firstName: 'Cara', position: 'RN', invitation: null, sessionId: null });
    expect(detail.invitation).toBeNull();
    const audit = await auditActions(detail.clinician.clinicianRecordId!);
    expect(audit.map((a) => a.action)).toEqual(['candidate_created']);
    // Notes aren't copied into the audit log.
    expect(JSON.stringify(audit)).not.toContain('Strong ICU background');

    const queue = await list(cookie, { queue: 'new_applicant' });
    expect(queue.data.map((c) => c.clinicianRecordId)).toContain(detail.clinician.clinicianRecordId);
  });

  it('validates the candidate and refuses a duplicate email safely', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    expect((await api.post('', { firstName: 'A', lastName: 'B', email: 'not-an-email' })).status).toBe(422);
    expect((await api.post('', { firstName: '', lastName: 'B', email: uniqueEmail('x') })).status).toBe(422);
    expect((await api.post('', { firstName: 'A', lastName: 'B', email: uniqueEmail('x'), position: 'Doctor' })).status).toBe(422);
    expect((await api.post('', { firstName: 'A', lastName: 'B', email: uniqueEmail('x'), interviewStatus: 'scheduled' })).status).toBe(422);

    const first = await newCandidate(cookie, 'dupe');
    const again = await api.post('', { firstName: 'Other', lastName: 'Person', email: first.candidate.email.toUpperCase() });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ clinicianId: first.clinician.clinicianRecordId });
    expect((await env.DB.prepare('SELECT COUNT(*) AS n FROM clinicians WHERE email = ?').bind(first.candidate.email).first<{ n: number }>())!.n).toBe(1);

    // An applicant who already registered is already a clinician.
    const { email } = await registerVerifyAndLoginApplicant(uniqueEmail('already-registered'));
    expect((await api.post('', { firstName: 'A', lastName: 'B', email })).status).toBe(409);
  });

  it('records interview status and recruiter details, audited', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, 'interview');
    const id = clinician.clinicianRecordId!;
    const updated = await api.ok(api.patch(`/${id}`, { interviewStatus: 'completed', phone: '5559990000', recruiterNotes: 'Interviewed Tuesday' }));
    expect(updated.candidate).toMatchObject({ interviewStatus: 'completed', phone: '5559990000', recruiterNotes: 'Interviewed Tuesday' });
    expect(updated.clinician.interviewStatus).toBe('completed');
    expect((await api.patch(`/${id}`, { interviewStatus: 'scheduled' })).status).toBe(422);
    expect((await api.patch(`/${id}`, { email: 'not-an-email' })).status).toBe(422);
    expect((await api.patch(`/${id}`, { nickname: 'x' })).status).toBe(422);
    const changed = (await auditActions(id)).find((a) => a.action === 'candidate_updated')!;
    expect(changed.metadata.changed).toMatchObject({ interview_status: 'completed', phone: '5559990000', recruiter_notes: '19 characters' });
  });

  it('the email can be corrected before an invitation, and is locked once one is sent', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, 'email-edit');
    const id = clinician.clinicianRecordId!;
    const before = await api.ok(api.get(`/${id}`));
    expect(before.candidate.emailEditable).toBe(true);

    const fixed = uniqueEmail('email-fixed');
    const updated = await api.ok(api.patch(`/${id}`, { email: fixed.toUpperCase() }));
    expect(updated.candidate.email).toBe(fixed);
    const audit = (await auditActions(id)).find((a) => a.action === 'candidate_updated')!;
    expect(audit.metadata.changed).toMatchObject({ email: { from: before.candidate.email, to: fixed } });

    // Another clinician's (or an account's) email is refused.
    const other = await newCandidate(cookie, 'email-taken');
    expect((await api.patch(`/${id}`, { email: other.candidate.email })).status).toBe(409);
    const { email: registered } = await registerVerifyAndLoginApplicant(uniqueEmail('email-account'));
    await env.DB.prepare('DELETE FROM clinicians WHERE email = ?').bind(registered).run();
    expect((await api.patch(`/${id}`, { email: registered })).status).toBe(409);

    await api.ok(api.post(`/${id}/invitation`, {}));
    const locked = await api.ok(api.get(`/${id}`));
    expect(locked.candidate.emailEditable).toBe(false);
    const refused = await api.patch(`/${id}`, { email: uniqueEmail('too-late') });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain('an invitation is out');
    // Other details stay editable, and the same email is not a change.
    await api.ok(api.patch(`/${id}`, { email: fixed, phone: '5550001111' }));
    expect((await env.DB.prepare('SELECT email FROM clinicians WHERE id = ?').bind(id).first<{ email: string }>())!.email).toBe(fixed);
  });

  it('when every invitation was revoked, the email unlocks and a new invitation can be sent; acceptance locks it for good', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, 'email-revoked');
    const id = clinician.clinicianRecordId!;
    const invited = await api.ok(api.post(`/${id}/invitation`, {}));
    expect(invited.candidate.emailEditable).toBe(false);
    await SELF.fetch(`${BASE}/api/admin/invites/${invited.invitation!.id}/revoke`, { method: 'POST', headers: { cookie } });

    const reopened = await api.ok(api.get(`/${id}`));
    expect(reopened.candidate.emailEditable).toBe(true);
    const corrected = uniqueEmail('email-corrected');
    expect((await api.ok(api.patch(`/${id}`, { email: corrected }))).candidate.email).toBe(corrected);

    const reinvited = await api.ok(api.post(`/${id}/invitation`, {}));
    expect(reinvited.invitation).toMatchObject({ status: 'pending' });
    expect(reinvited.clinician.queue).toBe('invited');
    expect(reinvited.candidate.emailEditable).toBe(false);
    expect((await api.patch(`/${id}`, { email: uniqueEmail('too-late') })).status).toBe(409);

    // Accepted: an account exists, and the email stays locked even if the
    // (now used) invitation can't be revoked.
    await registerInvited(reinvited.invitation!.id);
    const registered = await api.ok(api.get(`/${id}`));
    expect(registered.candidate.emailEditable).toBe(false);
    expect((await api.patch(`/${id}`, { email: uniqueEmail('after-register') })).status).toBe(409);
    expect((await env.DB.prepare('SELECT email FROM clinicians WHERE id = ?').bind(id).first<{ email: string }>())!.email).toBe(corrected);
  });

  it('stores the candidate resume privately: view, download, replace, never an applicant upload', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, 'resume');
    const id = clinician.clinicianRecordId!;

    expect((await uploadCandidateResume(cookie, id, new File([new Uint8Array([1])], 'resume.exe', { type: 'application/x-msdownload' }))).status).toBe(415);
    expect((await uploadCandidateResume(cookie, id, new File([new Uint8Array([1])], 'resume.pdf', { type: 'application/msword' }))).status).toBe(415);
    const stored = await api.ok(uploadCandidateResume(cookie, id));
    expect(stored.candidate.resume).toMatchObject({ fileName: 'candidate-resume.pdf', contentType: 'application/pdf' });
    expect(stored.clinician.hasCandidateResume).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('candidates/');

    const preview = await api.get(`/${id}/resume/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers.get('content-disposition')).toMatch(/^inline;/);
    await preview.arrayBuffer();
    const download = await api.get(`/${id}/resume/download`);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    await download.arrayBuffer();

    const key = (await env.DB.prepare('SELECT resume_object_key AS k FROM clinicians WHERE id = ?').bind(id).first<{ k: string }>())!.k;
    expect(key).toMatch(new RegExp(`^candidates/${id}/`));
    expect(await env.DB.prepare('SELECT 1 FROM uploaded_documents WHERE object_key = ?').bind(key).first()).toBeNull();

    // A DOCX resume replaces it, and is previewed in the portal as sandboxed HTML.
    const docx = fromBase64(RESUME_DOCX_BASE64);
    await api.ok(uploadCandidateResume(cookie, id, new File([docx], 'resume.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })));
    expect(await env.UPLOADS_BUCKET.head(key)).toBeNull();
    const wordPreview = await api.get(`/${id}/resume/preview`);
    expect(wordPreview.status).toBe(200);
    expect(wordPreview.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(wordPreview.headers.get('content-security-policy')).toMatch(/^sandbox;/);
    const html = await wordPreview.text();
    expect(html).toContain('Jane Nurse');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/candidates\/|uploads\/|https?:\/\//);
    const original = await api.get(`/${id}/resume/download`);
    expect(original.headers.get('content-disposition')).toMatch(/^attachment; filename="resume.docx"/);
    expect(Array.from(new Uint8Array(await original.arrayBuffer()))).toEqual(Array.from(docx));
    expect((await auditActions(id)).filter((a) => a.action === 'candidate_resume_uploaded')).toHaveLength(2);
  });

  it('sends the existing invitation: New Applicant to Invited; registration links the same clinician', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician, candidate } = await newCandidate(cookie, 'invite-flow');
    const id = clinician.clinicianRecordId!;

    const invited = await api.ok(api.post(`/${id}/invitation`, {}));
    expect(invited).toMatchObject({ emailDelivery: 'sent', invitation: { status: 'pending', useCandidateResume: false } });
    expect(invited.clinician.queue).toBe('invited');
    expect((await api.post(`/${id}/invitation`, {})).status).toBe(409);
    expect((await auditActions(id)).map((a) => a.action)).toContain('invitation_sent');

    const { accessToken } = await registerInvited(invited.invitation!.id);
    const rows = await env.DB.prepare('SELECT id, user_id FROM clinicians WHERE email = ?').bind(candidate.email).all<{ id: number; user_id: number | null }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0].id).toBe(id);
    expect(rows.results[0].user_id).not.toBeNull();

    const session = (await (await SELF.fetch(`${BASE}/api/sessions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ packetId: 'general_rn' }),
    })).json()) as TestSession;
    // No resume was offered for onboarding.
    expect(session.formData.resumeDocument).toBeUndefined();
    const after = await api.ok(api.get(`/${id}`));
    expect(after.clinician).toMatchObject({ queue: 'in_progress', sessionId: session.sessionId, firstName: 'Cara' });
  });

  it('the Invitations page invitation also belongs to a clinician', async () => {
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('invitations-page');
    const res = await SELF.fetch(`${BASE}/api/admin/invites`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    expect(res.status).toBe(201);
    const id = await clinicianIdForEmail(email);
    expect((await adminApi(cookie).ok(adminApi(cookie).get(`/${id}`))).clinician.queue).toBe('invited');
  });

  it('"Use existing resume for onboarding" makes it the applicant\'s own Resume upload, with provenance', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, 'promote');
    const id = clinician.clinicianRecordId!;
    expect((await api.post(`/${id}/invitation`, { useCandidateResume: true })).status).toBe(422); // no resume yet
    await api.ok(uploadCandidateResume(cookie, id));
    const invited = await api.ok(api.post(`/${id}/invitation`, { useCandidateResume: true }));
    expect(invited.invitation!.useCandidateResume).toBe(true);

    const { accessToken } = await registerInvited(invited.invitation!.id);
    const session = await createTestSession(accessToken, 'general_rn');
    const resume = session.formData.resumeDocument as { name: string; objectKey: string };
    expect(resume.name).toBe('candidate-resume.pdf');

    // A real ledger-backed upload, owned by the applicant, in their own namespace.
    const userId = (await env.DB.prepare('SELECT user_id FROM clinicians WHERE id = ?').bind(id).first<{ user_id: number }>())!.user_id;
    const ledger = await env.DB.prepare('SELECT id, user_id, session_id, doc_type FROM uploaded_documents WHERE object_key = ?').bind(resume.objectKey).first();
    expect(ledger).toMatchObject({ user_id: userId, session_id: session.sessionId, doc_type: 'applicant_resume' });
    expect(resume.objectKey).toMatch(new RegExp(`^uploads/${userId}/`));
    const candidateKey = (await env.DB.prepare('SELECT resume_object_key AS k FROM clinicians WHERE id = ?').bind(id).first<{ k: string }>())!.k;
    expect(resume.objectKey).not.toBe(candidateKey);
    expect(await env.UPLOADS_BUCKET.head(candidateKey)).not.toBeNull();
    const copy = await env.UPLOADS_BUCKET.get(resume.objectKey);
    expect(Array.from(new Uint8Array(await copy!.arrayBuffer()))).toEqual([37, 80, 68, 70, 9, 8, 7]);

    const promoted = (await auditActions(id)).find((a) => a.action === 'candidate_resume_promoted')!;
    expect(promoted.metadata).toMatchObject({ inviteId: invited.invitation!.id, uploadId: (ledger as { id: number }).id, fileName: 'candidate-resume.pdf' });

    // The applicant can still replace it like any upload; the recruiter's copy is untouched.
    const del = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/applicant_resume`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ revision: session.revision }),
    });
    expect(del.status).toBe(200);
    expect(await env.UPLOADS_BUCKET.head(candidateKey)).not.toBeNull();
  });
});

describe('candidate resume promotion is retry-safe', () => {
  async function promoted(label: string) {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, label);
    const id = clinician.clinicianRecordId!;
    await api.ok(uploadCandidateResume(cookie, id));
    const invited = await api.ok(api.post(`/${id}/invitation`, { useCandidateResume: true }));
    const { accessToken } = await registerInvited(invited.invitation!.id);
    const session = await createTestSession(accessToken, 'general_rn');
    const userId = (await env.DB.prepare('SELECT user_id FROM clinicians WHERE id = ?').bind(id).first<{ user_id: number }>())!.user_id;
    return { id, accessToken, session, userId, objectKey: (session.formData.resumeDocument as { objectKey: string }).objectKey };
  }
  const resumeOf = async (accessToken: string) => {
    const res = await SELF.fetch(`${BASE}/api/sessions/mine`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(200);
    return ((await res.json()) as TestSession).formData.resumeDocument as { objectKey: string } | undefined;
  };
  const counts = async (id: number, userId: number) => ({
    ledger: (await env.DB.prepare(`SELECT COUNT(*) AS n FROM uploaded_documents WHERE user_id = ? AND object_key LIKE '%candidate-resume%'`).bind(userId).first<{ n: number }>())!.n,
    objects: (await env.UPLOADS_BUCKET.list({ prefix: `uploads/${userId}/candidate-resume` })).objects.length,
    audits: (await auditActions(id)).filter((a) => a.action === 'candidate_resume_promoted').length,
  });
  async function dropResumeFromSession(sessionId: string) {
    const row = (await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(sessionId).first<{ form_data_json: string }>())!;
    const formData = JSON.parse(row.form_data_json) as Record<string, unknown>;
    delete formData.resumeDocument;
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ?, revision = revision + 1 WHERE session_id = ?').bind(JSON.stringify(formData), sessionId).run();
  }

  it('finishes on the next visit when the session update failed, reusing the same copy and record', async () => {
    const { id, accessToken, session, userId, objectKey } = await promoted('promote-retry');
    expect(await counts(id, userId)).toEqual({ ledger: 1, objects: 1, audits: 1 });

    // Copied and recorded, but the session never got it (and no audit yet).
    await dropResumeFromSession(session.sessionId);
    await env.DB.prepare('UPDATE uploaded_documents SET session_id = NULL, doc_type = NULL WHERE object_key = ?').bind(objectKey).run();
    await env.DB.prepare(`DELETE FROM audit_logs WHERE clinician_id = ? AND action = 'candidate_resume_promoted'`).bind(id).run();

    expect((await resumeOf(accessToken))?.objectKey).toBe(objectKey);
    expect(await counts(id, userId)).toEqual({ ledger: 1, objects: 1, audits: 1 });
    expect(await env.DB.prepare('SELECT session_id, doc_type FROM uploaded_documents WHERE object_key = ?').bind(objectKey).first())
      .toEqual({ session_id: session.sessionId, doc_type: 'applicant_resume' });

    // A finished promotion is recognised: further visits change nothing.
    await resumeOf(accessToken);
    await resumeOf(accessToken);
    expect(await counts(id, userId)).toEqual({ ledger: 1, objects: 1, audits: 1 });
  });

  it('finishes when only the copy was made, without copying again', async () => {
    const { id, accessToken, session, userId, objectKey } = await promoted('promote-copy-only');
    await dropResumeFromSession(session.sessionId);
    await env.DB.prepare('DELETE FROM uploaded_documents WHERE object_key = ?').bind(objectKey).run();
    const before = (await env.UPLOADS_BUCKET.head(objectKey))!.uploaded;

    expect((await resumeOf(accessToken))?.objectKey).toBe(objectKey);
    expect(await counts(id, userId)).toEqual({ ledger: 1, objects: 1, audits: 1 });
    expect((await env.UPLOADS_BUCKET.head(objectKey))!.uploaded).toEqual(before);
  });

  it('never re-adds a resume the applicant removed, or replaces one they uploaded', async () => {
    const { id, accessToken, session, userId } = await promoted('promote-removed');
    const del = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/applicant_resume`, {
      method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ revision: session.revision }),
    });
    expect(del.status).toBe(200);
    expect(await resumeOf(accessToken)).toBeFalsy();
    expect((await counts(id, userId)).audits).toBe(1);

    const other = await promoted('promote-own');
    const ownKey = await uploadFile(other.accessToken, fakeFile('my-resume.pdf', 'application/pdf', 300));
    const replaced = await SELF.fetch(`${BASE}/api/sessions/${other.session.sessionId}/documents/applicant_resume`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${other.accessToken}` }, body: JSON.stringify({ objectKey: ownKey, revision: other.session.revision }),
    });
    expect(replaced.status).toBe(200);
    expect((await resumeOf(other.accessToken))?.objectKey).toBe(ownKey);
  });
});

describe('On Hold', () => {
  it('places on hold with a reason, keeps progress, and resumes, both audited', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail('hold'));
    const session = await createTestSession(accessToken, 'general_rn');
    const id = await clinicianIdForEmail(email);

    const held = await api.ok(api.post(`/${id}/hold`, { reason: 'Travelling until March' }));
    expect(held.onHold).toMatchObject({ reason: 'Travelling until March', by: 'admin@example.com' });
    expect(held.clinician.queue).toBe('on_hold');
    expect((await api.post(`/${id}/hold`, {})).status).toBe(409);

    // The applicant keeps working; nothing is erased.
    const res = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(200);
    expect((await list(cookie, { queue: 'on_hold' })).data.map((c) => c.clinicianRecordId)).toContain(id);

    const resumed = await api.ok(api.post(`/${id}/resume-onboarding`));
    expect(resumed.onHold).toBeNull();
    expect(resumed.clinician.queue).toBe('in_progress');
    expect((await api.post(`/${id}/resume-onboarding`)).status).toBe(409);
    const audit = await auditActions(id);
    expect(audit.filter((a) => ['placed_on_hold', 'resumed_from_hold'].includes(a.action))).toEqual([
      { action: 'placed_on_hold', metadata: expect.objectContaining({ reason: 'Travelling until March' }) },
      { action: 'resumed_from_hold', metadata: expect.objectContaining({ reason: 'Travelling until March' }) },
    ]);
  });
});

describe('internal verification', () => {
  it.each(VERIFICATIONS)('%s: Not Started by default; changes are validated and audited', async (kind) => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, `verify-${kind}`);
    const id = clinician.clinicianRecordId!;
    expect(clinician.verifications![kind]).toBe('not_started');

    for (const status of ['pending', 'needs_review', 'complete', 'not_started'] as const) {
      expect((await api.ok(api.put(`/${id}/verifications/${kind}`, { status }))).verifications[kind]).toBe(status);
    }
    expect((await api.put(`/${id}/verifications/${kind}`, { status: 'done' })).status).toBe(422);
    expect((await api.put(`/${id}/verifications/${kind}`, {})).status).toBe(422);

    const changes = (await auditActions(id)).filter((a) => a.action === `${kind}_status_changed`);
    expect(changes.map((c) => [c.metadata.from, c.metadata.to])).toEqual([
      ['not_started', 'pending'], ['pending', 'needs_review'], ['needs_review', 'complete'], ['complete', 'not_started'],
    ]);
    // Setting the same status again changes nothing and logs nothing.
    await api.ok(api.put(`/${id}/verifications/${kind}`, { status: 'not_started' }));
    expect((await auditActions(id)).filter((a) => a.action === `${kind}_status_changed`)).toHaveLength(4);
  });

  it('rejects an unknown verification, and filters the list by status', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinician } = await newCandidate(cookie, 'verify-filter');
    const id = clinician.clinicianRecordId!;
    expect((await api.put(`/${id}/verifications/drug_screen`, { status: 'complete' })).status).toBe(404);
    await api.ok(api.put(`/${id}/verifications/background_check`, { status: 'pending' }));
    expect((await list(cookie, { backgroundCheck: 'pending' })).data.map((c) => c.clinicianRecordId)).toEqual([id]);
    expect((await list(cookie, { backgroundCheck: 'complete' })).data).toEqual([]);
    expect((await SELF.fetch(`${BASE}/api/admin/clinicians?i9Verification=done`, { headers: { cookie } })).status).toBe(400);
  });
});

describe('clearance', () => {
  it('is blocked until every requirement is met, and shows exactly what remains', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinicianId } = await submittedClinician('clear-blocked');
    const before = await api.ok(api.get(`/${clinicianId}`));
    expect(before.clearance.ready).toBe(false);
    const unmet = before.clearance.checklist.filter((i) => !i.met).map((i) => i.key);
    expect(unmet).toEqual(['background_check', 'reference_verification', 'i9_verification', 'w4_verification', 'documents']);
    expect(before.clearance.checklist.find((i) => i.key === 'documents')!.detail).toEqual(expect.arrayContaining(['Resume', 'CPR / BLS certification']));

    const refused = await api.post(`/${clinicianId}/clearance`, {});
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { incomplete: { key: string }[] }).incomplete.map((i) => i.key)).toEqual(unmet);

    // Three of four verifications is still not enough.
    for (const kind of VERIFICATIONS.slice(0, 3)) await api.ok(api.put(`/${clinicianId}/verifications/${kind}`, { status: 'complete' }));
    expect((await api.post(`/${clinicianId}/clearance`, {})).status).toBe(409);
  });

  it('clears once all four verifications are Complete and every required document is Accepted, an optional one does not block', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinicianId, applicationId } = await submittedClinician('clear-ok');
    const ready = await makeClearable(cookie, clinicianId);
    // The optional professional license was uploaded but never reviewed.
    expect(ready.documentReviews.requirements.find((r) => r.requirement === 'nursing_license')).toMatchObject({ required: false, status: 'pending' });
    expect(ready.clearance.ready).toBe(true);

    const cleared = await api.ok(api.post(`/${clinicianId}/clearance`, {}));
    expect(cleared.clearance.clearedAt).toBeTruthy();
    expect(cleared.clearance.clearedBy).toBe('admin@example.com');
    expect(cleared.clinician.queue).toBe('cleared');
    expect((await api.post(`/${clinicianId}/clearance`, {})).status).toBe(409);
    expect((await list(cookie, { recentlyOnboarded: 'true' })).data.map((c) => c.clinicianRecordId)).toContain(clinicianId);
    expect((await auditActions(clinicianId)).find((a) => a.action === 'clinician_cleared')!.metadata).toMatchObject({ override: false });
    // The application's own audit history shows it too.
    const app = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { clinicianRecordId: number };
    expect(app.clinicianRecordId).toBe(clinicianId);

    const revoked = await api.ok(api.post(`/${clinicianId}/clearance/revoke`, { reason: 'Background check flagged' }));
    expect(revoked.clearance.clearedAt).toBeNull();
    expect(revoked.clinician.queue).toBe('application_completed');
    expect((await api.post(`/${clinicianId}/clearance/revoke`, {})).status).toBe(409);
    expect((await auditActions(clinicianId)).find((a) => a.action === 'clearance_revoked')!.metadata).toMatchObject({ reason: 'Background check flagged' });
  });

  it('On Hold blocks clearance; a Pending document blocks it', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinicianId } = await submittedClinician('clear-hold');
    await makeClearable(cookie, clinicianId);
    await api.ok(api.post(`/${clinicianId}/hold`, {}));
    const held = await api.post(`/${clinicianId}/clearance`, {});
    expect(held.status).toBe(409);
    expect(((await held.json()) as { incomplete: { key: string }[] }).incomplete.map((i) => i.key)).toEqual(['not_on_hold']);

    await api.ok(api.post(`/${clinicianId}/resume-onboarding`));
    await api.ok(api.put(`/${clinicianId}/document-reviews/cpr_cert`, { status: 'pending' }));
    const pending = await api.post(`/${clinicianId}/clearance`, {});
    expect(((await pending.json()) as { incomplete: { key: string; detail?: string[] }[] }).incomplete).toEqual([
      expect.objectContaining({ key: 'documents', detail: ['CPR / BLS certification'] }),
    ]);
  });

  it('a super_admin may override incomplete requirements with a reason; a regular admin may not', async () => {
    const { clinicianId } = await submittedClinician('clear-override');
    const admin = adminApi(await loginAsAdmin());
    expect((await admin.post(`/${clinicianId}/clearance`, { override: true, reason: 'Urgent start' })).status).toBe(403);

    const superAdmin = adminApi(await loginAsSuperAdmin());
    expect((await superAdmin.post(`/${clinicianId}/clearance`, { override: true })).status).toBe(422);
    expect((await superAdmin.post(`/${clinicianId}/clearance`, { override: true, reason: '   ' })).status).toBe(422);
    const cleared = await superAdmin.ok(superAdmin.post(`/${clinicianId}/clearance`, { override: true, reason: 'Urgent start; checks in progress' }));
    expect(cleared.clearance.clearedAt).toBeTruthy();

    const audit = await auditActions(clinicianId);
    expect(audit.find((a) => a.action === 'clinician_cleared')!.metadata).toMatchObject({ override: true });
    const override = audit.find((a) => a.action === 'clearance_overridden')!.metadata as { adminId: number; reason: string; incomplete: { key: string }[] };
    expect(override.reason).toBe('Urgent start; checks in progress');
    expect(override.incomplete.map((i) => i.key)).toEqual(['background_check', 'reference_verification', 'i9_verification', 'w4_verification', 'documents']);
    expect(typeof override.adminId).toBe('number');
  });

  it('an uploaded optional document sent back for correction blocks clearance until accepted; one never uploaded never blocks', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { clinicianId } = await submittedClinician('clear-optional');
    let detail = await makeClearable(cookie, clinicianId);
    expect(detail.clearance.ready).toBe(true);

    const license = detail.documentReviews.requirements.find((r) => r.requirement === 'nursing_license')!;
    detail = await api.ok(api.put(`/${clinicianId}/document-reviews/nursing_license`, { status: 'needs_correction', note: 'Expired', expectedUpdatedAt: license.updatedAt }));
    expect(detail.clearance.ready).toBe(false);
    expect(detail.clearance.checklist.find((i) => i.key === 'documents')).toMatchObject({
      met: false, detail: ['Professional license / certification (correction requested)'],
    });
    expect((await api.post(`/${clinicianId}/clearance`, {})).status).toBe(409);

    const current = detail.documentReviews.requirements.find((r) => r.requirement === 'nursing_license')!;
    detail = await api.ok(api.put(`/${clinicianId}/document-reviews/nursing_license`, { status: 'accepted', expectedUpdatedAt: current.updatedAt }));
    expect(detail.clearance.ready).toBe(true);
  });

  it('only a super_admin is offered the override', async () => {
    const { clinicianId } = await submittedClinician('clear-permissions');
    expect((await adminApi(await loginAsAdmin()).ok(adminApi(await loginAsAdmin()).get(`/${clinicianId}`))).permissions).toEqual({ overrideClearance: false });
    const superAdmin = adminApi(await loginAsSuperAdmin());
    expect((await superAdmin.ok(superAdmin.get(`/${clinicianId}`))).permissions).toEqual({ overrideClearance: true });
  });

  it('not submitted and On Hold are hard blocks that even a super_admin override cannot bypass', async () => {
    const superAdmin = adminApi(await loginAsSuperAdmin());
    // Not submitted.
    const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail('hard-unsubmitted'));
    await createTestSession(accessToken, 'general_rn');
    const inProgress = await clinicianIdForEmail(email);
    const detail = await superAdmin.ok(superAdmin.get(`/${inProgress}`));
    expect(detail.clearance.overrideAllowed).toBe(false);
    const refused = await superAdmin.post(`/${inProgress}/clearance`, { override: true, reason: 'Urgent' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toContain("can't be overridden");

    // On Hold, even with everything else incomplete-but-overridable.
    const { clinicianId } = await submittedClinician('hard-hold');
    expect((await superAdmin.ok(superAdmin.get(`/${clinicianId}`))).clearance.overrideAllowed).toBe(true);
    await superAdmin.ok(superAdmin.post(`/${clinicianId}/hold`, {}));
    expect((await superAdmin.ok(superAdmin.get(`/${clinicianId}`))).clearance.overrideAllowed).toBe(false);
    expect((await superAdmin.post(`/${clinicianId}/clearance`, { override: true, reason: 'Urgent' })).status).toBe(409);
    for (const id of [inProgress, clinicianId]) {
      expect((await env.DB.prepare('SELECT cleared_at FROM clinicians WHERE id = ?').bind(id).first<{ cleared_at: string | null }>())!.cleared_at).toBeNull();
      expect((await auditActions(id)).some((a) => a.action === 'clinician_cleared')).toBe(false);
    }
  });

  it('clearance decided on facts that changed before the write is refused, not applied', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const clear = async (clinicianId: number, ctx: NonNullable<Awaited<ReturnType<typeof loadClinicianContext>>>) =>
      clearClinician(env.DB, ctx, { adminId: 1, adminRole: 'admin', override: false, reason: undefined });
    const cleared = async (id: number) => (await env.DB.prepare('SELECT cleared_at FROM clinicians WHERE id = ?').bind(id).first<{ cleared_at: string | null }>())!.cleared_at;

    // A verification reopened after the checklist was read.
    const a = await submittedClinician('race-verification');
    await makeClearable(cookie, a.clinicianId);
    let stale = (await loadClinicianContext(env.DB, a.clinicianId))!;
    await api.ok(api.put(`/${a.clinicianId}/verifications/i9_verification`, { status: 'needs_review' }));
    expect(await clear(a.clinicianId, stale)).toMatchObject({ ok: false, status: 409 });
    expect(await cleared(a.clinicianId)).toBeNull();

    // A document review reset after the checklist was read.
    const b = await submittedClinician('race-review');
    await makeClearable(cookie, b.clinicianId);
    stale = (await loadClinicianContext(env.DB, b.clinicianId))!;
    await api.ok(api.put(`/${b.clinicianId}/document-reviews/cpr_cert`, { status: 'pending' }));
    expect(await clear(b.clinicianId, stale)).toMatchObject({ ok: false, status: 409 });
    expect(await cleared(b.clinicianId)).toBeNull();

    // The applicant changed a file (a correction upload) after it was read.
    const c = await submittedClinician('race-applicant');
    let ready = await makeClearable(cookie, c.clinicianId);
    const cpr = ready.documentReviews.requirements.find((r) => r.requirement === 'cpr_cert')!;
    ready = await api.ok(api.put(`/${c.clinicianId}/document-reviews/cpr_cert`, { status: 'needs_correction', note: 'Blurry', expectedUpdatedAt: cpr.updatedAt }));
    const reaccept = ready.documentReviews.requirements.find((r) => r.requirement === 'cpr_cert')!;
    await api.ok(api.put(`/${c.clinicianId}/document-reviews/cpr_cert`, { status: 'accepted', expectedUpdatedAt: reaccept.updatedAt }));
    stale = (await loadClinicianContext(env.DB, c.clinicianId))!;
    await env.DB.prepare('UPDATE onboarding_sessions SET revision = revision + 1 WHERE session_id = ?').bind(c.latest.sessionId).run();
    expect(await clear(c.clinicianId, stale)).toMatchObject({ ok: false, status: 409 });

    // On Hold placed after it was read: refused even though everything else held.
    stale = (await loadClinicianContext(env.DB, c.clinicianId))!;
    await env.DB.prepare(`UPDATE clinicians SET on_hold_at = '2026-11-01T00:00:00.000Z' WHERE id = ?`).bind(c.clinicianId).run();
    expect(await clear(c.clinicianId, stale)).toMatchObject({ ok: false, status: 409 });
    expect(await cleared(c.clinicianId)).toBeNull();
    for (const id of [a.clinicianId, b.clinicianId, c.clinicianId]) expect((await auditActions(id)).some((x) => x.action === 'clinician_cleared')).toBe(false);
  });

  it('a super_admin demoted after signing in can no longer override', async () => {
    const { clinicianId } = await submittedClinician('clear-demoted');
    const cookie = await loginAsSuperAdmin();
    await env.DB.prepare(`UPDATE admin_users SET role = 'admin' WHERE role = 'super_admin'`).run();
    expect((await adminApi(cookie).post(`/${clinicianId}/clearance`, { override: true, reason: 'x' })).status).toBe(403);
  });
});

describe('clinician workflow access', () => {
  it('applicants are refused (403) and anonymous callers are unauthorized (401) for every action', async () => {
    const cookie = await loginAsAdmin();
    const { clinician } = await newCandidate(cookie, 'access');
    const id = clinician.clinicianRecordId!;
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('access-applicant'));
    const requests: [string, string, unknown?][] = [
      ['POST', '', { firstName: 'A', lastName: 'B', email: uniqueEmail('x') }],
      ['GET', `/${id}`], ['PATCH', `/${id}`, { phone: '1' }], ['POST', `/${id}/invitation`, {}],
      ['POST', `/${id}/hold`, {}], ['POST', `/${id}/resume-onboarding`],
      ['PUT', `/${id}/verifications/background_check`, { status: 'complete' }],
      ['PUT', `/${id}/document-reviews/cpr_cert`, { status: 'accepted' }],
      ['POST', `/${id}/clearance`, { override: true, reason: 'x' }], ['POST', `/${id}/clearance/revoke`, {}],
      ['GET', `/${id}/resume/download`],
    ];
    for (const [method, path, body] of requests) {
      const init = (headers: Record<string, string>) => ({ method, headers: { 'Content-Type': 'application/json', ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
      expect((await SELF.fetch(`${BASE}/api/admin/clinicians${path}`, init({ Authorization: `Bearer ${accessToken}` }))).status).toBe(403);
      expect((await SELF.fetch(`${BASE}/api/admin/clinicians${path}`, init({}))).status).toBe(401);
    }
    // Nothing changed.
    expect((await auditActions(id)).map((a) => a.action)).toEqual(['candidate_created']);
  });

  it('an unknown or malformed clinician id is not found', async () => {
    const api = adminApi(await loginAsAdmin());
    expect((await api.get('/999999')).status).toBe(404);
    expect((await api.get('/abc')).status).toBe(404);
  });
});

describe('application detail carries no storage keys', () => {
  it('documents and the submitted snapshot reach the portal by id and snapshot field only', async () => {
    const cookie = await loginAsAdmin();
    const { applicationId } = await submittedClinician('detail-no-keys');
    const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } });
    const text = await res.text();
    expect(text).not.toContain('objectKey');
    expect(text).not.toContain('uploads/');
    expect(text).not.toMatch(/"i9\/|"w4\//);
    const detail = JSON.parse(text) as { payload: { resumeDocument: { name: string } }; documents: { id: number; docType: string | null; payloadRef: string | null; fileName: string }[] };
    // The snapshot keeps its content (only storage locations removed).
    expect(detail.payload.resumeDocument.name).toBe('resume.pdf');
    expect(detail.documents.find((d) => d.docType === 'applicant_resume')).toMatchObject({ payloadRef: 'resumeDocument' });
    expect(detail.documents.find((d) => d.docType === 'cpr_cert')).toMatchObject({ payloadRef: 'uploadedDocuments.cprCertification' });
    expect(detail.documents.find((d) => d.fileName.startsWith('I9-Section1'))).toMatchObject({ payloadRef: null });
    // Every file still opens by its id.
    for (const doc of detail.documents) {
      const file = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${doc.id}/download`, { headers: { cookie } });
      expect(file.status).toBe(200);
      await file.arrayBuffer();
    }
  });
});

describe('backward compatibility', () => {
  it('a historical web application stays readable, with no workflow it cannot support', async () => {
    const cookie = await loginAsAdmin();
    const applicationId = await seedApplication({ firstName: 'Old', lastName: 'Web', email: uniqueEmail('legacy'), submittedAt: '2025-03-01T10:00:00.000Z' });
    const legacy = (await list(cookie, { search: applicationId })).data[0];
    expect(legacy).toMatchObject({
      queue: 'application_completed', clinicianRecordId: null, verifications: null, onHold: null, clearedAt: null, documentReview: null,
    });
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { clinicianRecordId: number | null };
    expect(detail.clinicianRecordId).toBeNull();
  });

  it('workflow history names who acted and never exposes a storage location', async () => {
    const cookie = await loginAsAdmin();
    const { clinicianId, applicationId } = await submittedClinician('compat-audit');
    await adminApi(cookie).ok(adminApi(cookie).put(`/${clinicianId}/verifications/background_check`, { status: 'pending' }));
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    expect(detail.auditLogs.find((l) => l.action === 'background_check_status_changed')).toMatchObject({ actor: 'admin@example.com', metadata: { from: 'not_started', to: 'pending' } });
    expect(detail.auditLogs.map((l) => l.action)).toContain('i9_pdf_generated');
    expect(JSON.stringify(detail.auditLogs)).not.toMatch(/objectKey|i9\/PCS/);
    const app = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { auditLogs: { action: string; metadata: Record<string, unknown> | null }[] };
    const i9 = app.auditLogs.find((l) => l.action === 'i9_pdf_generated')!;
    expect(i9.metadata).not.toHaveProperty('objectKey');
  });

  it('a modern submitted application keeps its own audit history alongside the workflow\'s', async () => {
    const cookie = await loginAsAdmin();
    const { clinicianId, applicationId } = await submittedClinician('compat-modern');
    await adminApi(cookie).ok(adminApi(cookie).put(`/${clinicianId}/verifications/w4_verification`, { status: 'pending' }));
    const detail = await adminApi(cookie).ok(adminApi(cookie).get(`/${clinicianId}`));
    const actions = detail.auditLogs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['application_submitted', 'w4_verification_status_changed']));
    const app = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { auditLogs: { action: string }[] };
    expect(app.auditLogs.map((l) => l.action)).toContain('application_submitted');
  });
});
