import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { PACKETS, defaultFormData, getPacket } from '@pcs/shared';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import {
  associateDoc,
  completePacketExceptReview,
  completeRemainingRequiredSteps,
  createTestSession,
  fakeFile,
  patch,
  removeDoc,
  submit,
  uploadFile,
  LEGACY_MANUAL_EMPLOYMENT_APPLICATION,
  LEGACY_MANUAL_REFERENCE,
  type TestSession,
} from './submissionFixtures';

// Resume-first onboarding: "About You & Work History" is a single resume
// upload (doc_type `applicant_resume`, formData.resumeDocument). Exercised
// through the real upload, association, PATCH, submit, and admin routes.

const RESUME_DOC_TYPE = 'applicant_resume';

async function getSession(accessToken: string, sessionId: string): Promise<TestSession> {
  const res = await SELF.fetch(`${BASE}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.json();
}

async function uploadResume(accessToken: string, name = 'resume.pdf'): Promise<string> {
  return uploadFile(accessToken, fakeFile(name, 'application/pdf', 400));
}

async function completeResumeStep(accessToken: string, session: TestSession): Promise<Response> {
  return patch(accessToken, session.sessionId, session.revision, {
    formData: session.formData,
    stepStates: { ...session.stepStates, resume: 'completed' },
  });
}

async function ledgerRow(objectKey: string) {
  return env.DB.prepare('SELECT session_id, doc_type, deleted_at FROM uploaded_documents WHERE object_key = ?')
    .bind(objectKey).first<{ session_id: string | null; doc_type: string | null; deleted_at: string | null }>();
}

// The exact v5 (pre-resume) step order, for the compatibility assertions.
const V5_GENERAL_RN_STEP_IDS = [
  'personal_info', 'employment_application', 'application_statement', 'employment_ref_1', 'employment_ref_2',
  'background_auth', 'health_info_auth', 'patient_bill_of_rights', 'hep_b_declination', 'tdap_declination',
  'flu_declination', 'w4', 'i9', 'direct_deposit', 'documents', 'jcaho_review', 'safety_acknowledgements',
  'safety_exam', 'review',
];

describe('packet structure — resume-first (v6)', () => {
  it('every packet starts with the resume as its only "About You & Work History" step', () => {
    for (const packet of Object.values(PACKETS)) {
      expect(packet.version).toBe(6);
      expect(packet.steps[0]).toMatchObject({ id: 'resume', type: 'document_upload', subtype: 'resume', required: true });
    }
  });

  it('keeps every v5 step id (only `resume` is new), so in-progress sessions never reference a removed step', () => {
    const ids = getPacket('general_rn')!.steps.map((s) => s.id);
    expect(ids.filter((id) => id !== 'resume').sort()).toEqual([...V5_GENERAL_RN_STEP_IDS].sort());
  });

  it('places the Application Statement after the references and before the background authorization', () => {
    for (const packet of Object.values(PACKETS)) {
      const ids = packet.steps.map((s) => s.id);
      const lastRef = Math.max(...ids.map((id, i) => (id.startsWith('employment_ref_') ? i : -1)));
      expect(ids.indexOf('application_statement')).toBe(lastRef + 1);
      expect(ids.indexOf('background_auth')).toBe(lastRef + 2);
    }
  });

  it('preserves packet-specific reference requirements (ICU/ER: 2 required; Travel: 2 required + optional #3)', () => {
    const refs = (id: string) => getPacket(id)!.steps.filter((s) => s.type === 'employment_reference').map((s) => [s.id, s.required]);
    expect(refs('general_rn')).toEqual([['employment_ref_1', true], ['employment_ref_2', true]]);
    expect(refs('lvn')).toEqual([['employment_ref_1', true], ['employment_ref_2', true]]);
    expect(refs('icu_rn')).toEqual([['employment_ref_1', true], ['employment_ref_2', true]]);
    expect(refs('er_rn')).toEqual([['employment_ref_1', true], ['employment_ref_2', true]]);
    expect(refs('travel_rn')).toEqual([['employment_ref_1', true], ['employment_ref_2', true], ['employment_ref_3', false]]);
  });
});

describe('resume slot — upload, association, replace, remove', () => {
  it('a PDF resume is associated to the session through the ownership-verified slot route', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-ok'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadResume(accessToken, 'Jane Doe Resume.pdf');

    const res = await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, objectKey, session.revision);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TestSession;
    expect(body.formData.resumeDocument).toMatchObject({ name: 'Jane Doe Resume.pdf', type: 'application/pdf', size: 400, objectKey });
    expect(await ledgerRow(objectKey)).toMatchObject({ session_id: session.sessionId, doc_type: RESUME_DOC_TYPE, deleted_at: null });
  });

  it('the resume step cannot be completed without a resume, and can once one is associated', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-required'));
    const session = await createTestSession(accessToken, 'general_rn');

    const without = await completeResumeStep(accessToken, session);
    expect(without.status).toBe(422);

    const objectKey = await uploadResume(accessToken);
    const associated = (await (await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, objectKey, session.revision)).json()) as TestSession;
    const withResume = await completeResumeStep(accessToken, associated);
    expect(withResume.status).toBe(200);
    expect(((await withResume.json()) as TestSession).stepStates.resume).toBe('completed');
  });

  it('the resume persists across a save of another step and a fresh read (Save Progress / reopen)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-persist'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadResume(accessToken);
    const associated = (await (await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, objectKey, session.revision)).json()) as TestSession;

    const saved = await patch(accessToken, associated.sessionId, associated.revision, {
      formData: { ...associated.formData, personalInfo: { ...defaultFormData.personalInfo, firstName: 'Jane' } },
      stepStates: { ...associated.stepStates, resume: 'in_progress', personal_info: 'in_progress' },
    });
    expect(saved.status).toBe(200);

    const reopened = await getSession(accessToken, session.sessionId);
    expect((reopened.formData.resumeDocument as { objectKey: string }).objectKey).toBe(objectKey);
  });

  it('replacing the resume points the slot at the new file and deletes the old one', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-replace'));
    const session = await createTestSession(accessToken, 'general_rn');
    const first = await uploadResume(accessToken, 'old.pdf');
    const afterFirst = (await (await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, first, session.revision)).json()) as TestSession;

    const second = await uploadResume(accessToken, 'new.pdf');
    const res = await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, second, afterFirst.revision);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TestSession).formData.resumeDocument).toMatchObject({ objectKey: second, name: 'new.pdf' });
    expect((await ledgerRow(first))?.deleted_at).not.toBeNull();
    expect(await env.UPLOADS_BUCKET.head(first)).toBeNull();
  });

  it('removing the resume clears the slot, and the session is no longer submittable until a new one is uploaded', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-remove'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const objectKey = (complete.formData.resumeDocument as { objectKey: string }).objectKey;

    const res = await removeDoc(accessToken, complete.sessionId, RESUME_DOC_TYPE, complete.revision);
    expect(res.status).toBe(200);
    const removed = (await res.json()) as TestSession;
    expect(removed.formData.resumeDocument).toBeNull();
    expect((await ledgerRow(objectKey))?.deleted_at).not.toBeNull();

    const submitRes = await submit(accessToken, removed.sessionId, removed.revision);
    expect(submitRes.status).toBe(422);
    const body = (await submitRes.json()) as { incompleteSteps: { id: string; label: string }[] };
    expect(body.incompleteSteps).toEqual([{ id: 'resume', label: 'Upload Your Resume' }]);

    const reupload = await uploadResume(accessToken);
    const reassociated = (await (await associateDoc(accessToken, removed.sessionId, RESUME_DOC_TYPE, reupload, removed.revision)).json()) as TestSession;
    const finalRes = await submit(accessToken, reassociated.sessionId, reassociated.revision);
    expect(finalRes.status).toBe(201);
  });
});

describe('resume slot — security', () => {
  it('rejects a photo as a resume (415) without touching the session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-jpeg'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadFile(accessToken, fakeFile('resume.jpg', 'image/jpeg', 200));

    const res = await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, objectKey, session.revision);
    expect(res.status).toBe(415);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Your resume must be a PDF, DOC, or DOCX file.');
    expect(body.error).not.toContain(objectKey);
    const after = await getSession(accessToken, session.sessionId);
    expect(after.revision).toBe(session.revision);
    expect(after.formData.resumeDocument ?? null).toBeNull();
    expect((await ledgerRow(objectKey))?.session_id).toBeNull();
  });

  it.each([
    ['resume.doc', 'application/msword'],
    ['resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['resume.pdf', 'application/pdf'],
  ])('accepts a %s resume through the same secure slot', async (name, type) => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-word'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadFile(accessToken, fakeFile(name, type, 250));
    const res = await associateDoc(accessToken, session.sessionId, RESUME_DOC_TYPE, objectKey, session.revision);
    expect(res.status).toBe(200);
    expect(((await res.json()) as TestSession).formData.resumeDocument).toMatchObject({ name, type, objectKey });
  });

  it('Word documents are accepted for the resume slot only', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('word-other-slot'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadFile(accessToken, fakeFile('license.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 250));
    const res = await associateDoc(accessToken, session.sessionId, 'nursing_license', objectKey, session.revision);
    expect(res.status).toBe(415);
    expect(((await res.json()) as { error: string }).error).toBe('This document must be a PDF, JPG, or PNG file.');
  });

  it('a file declared as a Word document must carry the matching extension', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('word-mislabeled'));
    const formData = new FormData();
    formData.append('file', fakeFile('payload.exe', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 50));
    const res = await SELF.fetch(`${BASE}/api/uploads`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: formData });
    expect(res.status).toBe(415);
  });

  it('a DOCX resume is promoted at submission and served by the protected admin route as a download only', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('docx-admin'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const docxType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const key = await uploadFile(accessToken, fakeFile('Jane Resume.docx', docxType, 260));
    const replaced = (await (await associateDoc(accessToken, complete.sessionId, RESUME_DOC_TYPE, key, complete.revision)).json()) as TestSession;
    const { applicationId } = (await (await submit(accessToken, replaced.sessionId, replaced.revision)).json()) as { applicationId: string };

    const cookie = await loginAsAdmin();
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { documents: { id: number; docType: string }[] };
    const resume = detail.documents.find((d) => d.docType === RESUME_DOC_TYPE)!;
    const url = `${BASE}/api/admin/application/${applicationId}/documents/${resume.id}/download`;
    const res = await SELF.fetch(url, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(docxType);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect((await res.arrayBuffer()).byteLength).toBe(260);
    expect((await SELF.fetch(url)).status).toBe(401);
  });

  it('the resume type rule is scoped to the resume slot (other slots still accept JPG/PNG)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-scope'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadFile(accessToken, fakeFile('license.jpg', 'image/jpeg', 200));
    const res = await associateDoc(accessToken, session.sessionId, 'nursing_license', objectKey, session.revision);
    expect(res.status).toBe(200);
  });

  it('rejects another applicant\'s file as a resume (403), without disclosing anything about it', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('resume-owner'));
    const stranger = await registerVerifyAndLoginApplicant(uniqueEmail('resume-stranger'));
    const session = await createTestSession(owner.accessToken, 'general_rn');
    const strangersResume = await uploadResume(stranger.accessToken);

    const res = await associateDoc(owner.accessToken, session.sessionId, RESUME_DOC_TYPE, strangersResume, session.revision);
    expect(res.status).toBe(403);
    expect((await ledgerRow(strangersResume))?.session_id).toBeNull();
  });

  it('rejects an unknown document slot (422)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-badslot'));
    const session = await createTestSession(accessToken, 'general_rn');
    const objectKey = await uploadResume(accessToken);
    for (const docType of ['resume', 'applicant_resume_v2', 'resumeDocument']) {
      const res = await associateDoc(accessToken, session.sessionId, docType, objectKey, session.revision);
      expect(res.status).toBe(422);
    }
  });

  it('a resume reference written through the generic PATCH (no real upload) can never satisfy submission', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-forged'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const removed = (await (await removeDoc(accessToken, complete.sessionId, RESUME_DOC_TYPE, complete.revision)).json()) as TestSession;

    const forged = await patch(accessToken, removed.sessionId, removed.revision, {
      formData: {
        ...removed.formData,
        resumeDocument: { name: 'x.pdf', size: 1, type: 'application/pdf', objectKey: 'uploads/999/forged.pdf', uploadedAt: '2026-01-01T00:00:00.000Z' },
      },
      stepStates: { ...removed.stepStates, resume: 'completed' },
    });
    expect(forged.status).toBe(200);
    const forgedSession = (await forged.json()) as TestSession;
    // resumeDocument is server-owned: the forged value is discarded on save…
    expect(forgedSession.formData.resumeDocument).toBeNull();

    const res = await submit(accessToken, forgedSession.sessionId, forgedSession.revision);
    expect(res.status).toBe(422); // …and submission independently checks the upload ledger
    const body = (await res.json()) as { incompleteSteps: { id: string }[] };
    expect(body.incompleteSteps.map((s) => s.id)).toEqual(['resume']);
  });
});

describe('final submission — resume-based application', () => {
  it('includes the resume as an application document and stores no manual work-history placeholders', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-submit'));
    const complete = await completePacketExceptReview(accessToken, 'travel_rn');
    const resumeKey = (complete.formData.resumeDocument as { objectKey: string }).objectKey;

    const res = await submit(accessToken, complete.sessionId, complete.revision);
    expect(res.status).toBe(201);
    const { applicationId } = (await res.json()) as { applicationId: string };

    const doc = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND doc_type = ?')
      .bind(applicationId, RESUME_DOC_TYPE).first<{ object_key: string }>();
    expect(doc?.object_key).toBe(resumeKey);

    const row = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const payload = JSON.parse(row!.payload_json) as {
      resumeDocument: Record<string, unknown>;
      employmentApplication: Record<string, unknown>;
      employmentReferences: Record<string, Record<string, unknown>>;
    };
    expect(payload.resumeDocument).toMatchObject({ type: 'application/pdf' });
    for (const legacyKey of ['yearsExperience', 'primarySpecialty', 'primarySpecialtyOther', 'currentlyEmployed', 'previouslyWorkedHere', 'hasCPR']) {
      expect(payload.employmentApplication).not.toHaveProperty(legacyKey);
    }
    // Still-required structured data is retained.
    expect(payload.employmentApplication).toMatchObject({ positionApplied: 'RN', licenseNumber: 'RN123456', emergencyContactName: 'John Doe' });
    for (const ref of Object.values(payload.employmentReferences)) {
      for (const legacyKey of ['positionHeld', 'employmentDateFrom', 'employmentDateTo', 'employerCity', 'employerState', 'eligibleForRehire']) {
        expect(ref).not.toHaveProperty(legacyKey);
      }
      expect(ref).toMatchObject({ supervisorName: 'Supervisor Name', permissionGranted: true });
    }
    expect(row!.payload_json).not.toMatch(/see resume|"N\/A"/i);
  });

  it('the resume is downloadable through the protected admin route, scoped to its own application', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume-admin'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const { applicationId } = (await (await submit(accessToken, complete.sessionId, complete.revision)).json()) as { applicationId: string };
    const other = await registerVerifyAndLoginApplicant(uniqueEmail('resume-admin-other'));
    const otherComplete = await completePacketExceptReview(other.accessToken, 'icu_rn');
    const { applicationId: otherApplicationId } = (await (await submit(other.accessToken, otherComplete.sessionId, otherComplete.revision)).json()) as { applicationId: string };

    const cookie = await loginAsAdmin();
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as {
      documents: { id: number; docType: string | null; fileName: string }[];
    };
    const resume = detail.documents.find((d) => d.docType === RESUME_DOC_TYPE);
    expect(resume).toBeDefined();

    const url = (appId: string, docId: number) => `${BASE}/api/admin/application/${appId}/documents/${docId}/download`;
    const ok = await SELF.fetch(url(applicationId, resume!.id), { headers: { cookie } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    expect((await ok.arrayBuffer()).byteLength).toBe(300); // completeStep's resume fixture

    // Another application's id never unlocks this document.
    const crossApp = await SELF.fetch(url(otherApplicationId, resume!.id), { headers: { cookie } });
    expect(crossApp.status).toBe(404);
    // No admin credentials, or an applicant's token: refused.
    expect((await SELF.fetch(url(applicationId, resume!.id))).status).toBe(401);
    expect((await SELF.fetch(url(applicationId, resume!.id), { headers: { Authorization: `Bearer ${accessToken}` } })).status).toBe(403);
  });
});

describe('backward compatibility — sessions started on the manual (v5) flow', () => {
  async function seedLegacyInProgressSession(accessToken: string, packetId: string): Promise<TestSession & { packetId: string; packetVersion: number }> {
    const session = await createTestSession(accessToken, packetId);
    const formData = {
      personalInfo: {
        firstName: 'Legacy', lastName: 'Applicant', middleInitial: '', otherLastNames: '', dateOfBirth: '1985-06-15', email: 'legacy@example.com',
        phone: '5551234567', address: '1 Old Rd', aptNumber: '', city: 'Fresno', state: 'CA', zip: '93701',
      },
      employmentApplication: LEGACY_MANUAL_EMPLOYMENT_APPLICATION,
      employmentReferences: { employment_ref_1: LEGACY_MANUAL_REFERENCE, employment_ref_2: LEGACY_MANUAL_REFERENCE },
      acknowledgements: { application_statement: { checked: true, typedSignature: 'Legacy Applicant', signedAt: '2026-01-01T00:00:00.000Z' } },
    };
    const stepStates = {
      personal_info: 'completed', employment_application: 'completed', application_statement: 'completed',
      employment_ref_1: 'completed', employment_ref_2: 'completed',
    };
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ?, step_states_json = ?, packet_version = 5 WHERE session_id = ?')
      .bind(JSON.stringify(formData), JSON.stringify(stepStates), session.sessionId).run();
    return getSession(accessToken, session.sessionId) as Promise<TestSession & { packetId: string; packetVersion: number }>;
  }

  it('an in-progress v5 session keeps every completed step valid and can keep saving', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('legacy-progress'));
    const legacy = await seedLegacyInProgressSession(accessToken, 'general_rn');
    expect(legacy.packetVersion).toBe(5);
    expect(legacy.formData.resumeDocument).toBeUndefined();

    // Re-sending the full stepStates (as mobile does) with every legacy
    // completed step is accepted — no step id was removed and every old
    // completed step still passes the (now smaller) validation.
    const res = await patch(accessToken, legacy.sessionId, legacy.revision, {
      formData: legacy.formData,
      stepStates: { ...legacy.stepStates, background_auth: 'in_progress' },
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as TestSession;
    // Stored manual data is never rewritten.
    expect(saved.formData.employmentApplication).toMatchObject({ yearsExperience: '3-5', primarySpecialty: 'med_surg' });
    expect((saved.formData.employmentReferences as Record<string, unknown>).employment_ref_1).toMatchObject({ positionHeld: 'RN', employerCity: 'Los Angeles' });
  });

  it('a v5 session must upload a resume and answer the new qualification questions before it can submit, and then submits with its manual data intact', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('legacy-submit'));
    const legacy = await seedLegacyInProgressSession(accessToken, 'icu_rn');

    // Everything else completed the real way; the v5 About You steps stay as seeded.
    let current = await completeRemainingRequiredSteps(accessToken, { ...legacy, packetId: 'icu_rn' }, { except: ['resume'] });

    const blocked = await submit(accessToken, current.sessionId, current.revision);
    expect(blocked.status).toBe(422);
    expect(((await blocked.json()) as { incompleteSteps: { id: string }[] }).incompleteSteps.map((s) => s.id)).toEqual(['resume', 'employment_application']);

    const resumeKey = await uploadResume(accessToken);
    current = (await (await associateDoc(accessToken, current.sessionId, RESUME_DOC_TYPE, resumeKey, current.revision)).json()) as TestSession;
    current = (await (await completeResumeStep(accessToken, current)).json()) as TestSession;
    current = (await (await patch(accessToken, current.sessionId, current.revision, {
      formData: {
        ...current.formData,
        employmentApplication: { ...(current.formData.employmentApplication as Record<string, unknown>), totalYearsExperience: '4', primaryClinicalSpecialty: ['med_surg'] },
      },
    })).json()) as TestSession;

    const res = await submit(accessToken, current.sessionId, current.revision);
    expect(res.status).toBe(201);
    const { applicationId } = (await res.json()) as { applicationId: string };
    const row = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const payload = JSON.parse(row!.payload_json) as {
      employmentApplication: Record<string, unknown>;
      employmentReferences: Record<string, Record<string, unknown>>;
      resumeDocument: Record<string, unknown>;
    };
    expect(payload.resumeDocument).toMatchObject({ objectKey: resumeKey });
    expect(payload.employmentApplication).toMatchObject({ yearsExperience: '3-5', primarySpecialty: 'med_surg' });
    expect(payload.employmentReferences.employment_ref_1).toMatchObject({ positionHeld: 'RN', eligibleForRehire: true });
  });

  it('an application submitted before resume-first is returned to the Admin Portal exactly as stored', async () => {
    const legacyPayload = {
      personalInfo: { firstName: 'Old', lastName: 'Submission' },
      employmentApplication: LEGACY_MANUAL_EMPLOYMENT_APPLICATION,
      employmentReferences: { employment_ref_1: LEGACY_MANUAL_REFERENCE },
    };
    const applicationId = `APP-LEGACY-${crypto.randomUUID().slice(0, 8)}`;
    await env.DB.prepare(
      `INSERT INTO applications (application_id, first_name, last_name, email, phone, payload_json, submitted_at)
       VALUES (?, 'Old', 'Submission', 'old@example.com', '5551234567', ?, '2026-01-01T00:00:00.000Z')`,
    ).bind(applicationId, JSON.stringify(legacyPayload)).run();

    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { payload: unknown }).payload).toEqual(legacyPayload);
  });
});
