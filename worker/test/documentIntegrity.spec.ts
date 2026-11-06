import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';
import {
  VALID_PERSONAL_INFO, associateDoc, completePacketExceptReview, createTestSession, deleteUpload, patch, submit, uploadFile, type TestSession,
} from './submissionFixtures';

// Security regression: document state comes only from the authenticated upload
// and association routes, backed by the ownership ledger. The generic session
// PATCH can neither write it nor complete a document step with fabricated data,
// and final submission answers from the ledger itself.

const fake = (objectKey = 'uploads/999/not-mine.jpg') => ({ name: 'forged.jpg', size: 1, type: 'image/jpeg', objectKey, uploadedAt: '2026-01-01T00:00:00.000Z' });

const SERVER_OWNED: [string, Record<string, unknown>][] = [
  ['uploadedDocuments', { uploadedDocuments: { listA: fake(), nursingLicense: fake(), cprCertification: fake() } }],
  ['vaccineProofDocuments', { vaccineProofDocuments: { hep_b_declination: fake() } }],
  ['directDepositProofDocument', { directDepositProofDocument: fake() }],
  ['resumeDocument', { resumeDocument: fake() }],
  ['documentAttachments', { documentAttachments: { nursing_license: [fake(), fake('uploads/999/b.jpg')] } }],
];

async function newSession(label: string) {
  const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  return { accessToken, session: await createTestSession(accessToken, 'general_rn') };
}

/** Writes a session's stored formData directly — a session saved before PATCH
 * stopped accepting these keys, which could already hold a fabricated value. */
async function setStoredFormData(sessionId: string, change: (formData: Record<string, unknown>) => Record<string, unknown>): Promise<void> {
  const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(sessionId).first<{ form_data_json: string }>();
  await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?')
    .bind(JSON.stringify(change(JSON.parse(row!.form_data_json))), sessionId).run();
}

const incompleteIds = async (res: Response) => ((await res.json()) as { incompleteSteps: { id: string }[] }).incompleteSteps.map((s) => s.id);

describe('session PATCH cannot write document state', () => {
  it.each(SERVER_OWNED)('a fabricated %s is discarded', async (key, formData) => {
    const { accessToken, session } = await newSession(`patch-forge-${key}`.toLowerCase());
    const res = await patch(accessToken, session.sessionId, session.revision, { formData });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TestSession;
    expect(body.formData[key]).toBeUndefined();
    expect(JSON.stringify(body.formData)).not.toContain('not-mine');
  });

  it('a fabricated value cannot overwrite or clear a real document', async () => {
    const { accessToken, session } = await newSession('patch-overwrite');
    const real = await uploadFile(accessToken);
    const associated = (await (await associateDoc(accessToken, session.sessionId, 'cpr_cert', real, session.revision)).json()) as TestSession;
    const stored = () => associated.formData.uploadedDocuments as { cprCertification: { objectKey: string } };
    expect(stored().cprCertification.objectKey).toBe(real);

    const forged = await patch(accessToken, associated.sessionId, associated.revision, { formData: { uploadedDocuments: { cprCertification: fake() } } });
    const afterForged = (await forged.json()) as TestSession;
    expect((afterForged.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey).toBe(real);

    const cleared = await patch(accessToken, afterForged.sessionId, afterForged.revision, { formData: { uploadedDocuments: { cprCertification: null } } });
    expect((((await cleared.json()) as TestSession).formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey).toBe(real);
  });

  it("another applicant's real object key can't be written either", async () => {
    const victim = await newSession('patch-victim');
    const attacker = await newSession('patch-attacker');
    const victimsFile = await uploadFile(victim.accessToken);
    const res = await patch(attacker.accessToken, attacker.session.sessionId, attacker.session.revision, {
      formData: { uploadedDocuments: { listA: fake(victimsFile) }, directDepositProofDocument: fake(victimsFile) },
    });
    expect(JSON.stringify(((await res.json()) as TestSession).formData)).not.toContain(victimsFile);
  });
});

describe('a required document step cannot be completed without a real upload', () => {
  const FULL_DEPOSIT = {
    lastName: 'Doe', firstName: 'Jane', middleInitial: '', employeeId: '',
    primaryAccount: { bankName: 'Bank', accountType: 'checking', routingNumber: '011000015', accountNumber: '123', depositType: 'percentage', depositAmount: '100' },
    additionalAccount: { bankName: '', accountType: '', routingNumber: '', accountNumber: '', depositType: '', depositAmount: '' },
    typedSignature: 'Jane Doe', signedDate: '01/01/2026',
  };

  it.each<[string, string, Record<string, unknown>]>([
    ['documents', 'documents', { uploadedDocuments: { listA: fake(), cprCertification: fake() } }],
    ['resume', 'resume', { resumeDocument: fake() }],
    ['direct_deposit', 'direct_deposit', { directDepositData: FULL_DEPOSIT, directDepositProofDocument: fake() }],
    ['a vaccine proof', 'hep_b_declination', { acknowledgements: { hep_b_declination: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' } }, vaccineProofDocuments: { hep_b_declination: fake() } }],
  ])('%s', async (_label, stepId, formData) => {
    const { accessToken, session } = await newSession(`patch-step-${stepId}`.replace(/_/g, '-'));
    const res = await patch(accessToken, session.sessionId, session.revision, { formData, stepStates: { [stepId]: 'completed' } });
    expect(res.status).toBe(422);
  });

  it('a modified client sending completed step states wholesale gets the same answer', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('patch-wholesale'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const { formData } = complete;
    const res = await patch(accessToken, complete.sessionId, complete.revision, {
      formData: { ...formData, uploadedDocuments: { listA: fake(), cprCertification: fake() } },
      stepStates: complete.stepStates,
    });
    const body = (await res.json()) as TestSession;
    expect(JSON.stringify(body.formData.uploadedDocuments)).not.toContain('not-mine');
  });
});

describe('final submission answers from the ledger', () => {
  it.each<[string, string, string, (f: Record<string, unknown>) => Record<string, unknown>]>([
    ['documents (CPR)', 'cpr_cert', 'documents', (f) => ({ ...f, uploadedDocuments: { ...(f.uploadedDocuments as object), cprCertification: fake() } })],
    ['documents (identity)', 'list_a', 'documents', (f) => ({ ...f, uploadedDocuments: { ...(f.uploadedDocuments as object), listA: fake() } })],
    ['direct deposit', 'direct_deposit_voided_check', 'direct_deposit', (f) => ({ ...f, directDepositProofDocument: fake() })],
    ['resume', 'applicant_resume', 'resume', (f) => ({ ...f, resumeDocument: fake() })],
  ])('a stored reference to %s with no live upload behind it blocks submission', async (_label, docType, stepId, forge) => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`ledger-${docType}`.replace(/_/g, '-')));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    // The real upload goes away, and the session is left claiming one — how a
    // session fabricated before this fix would look.
    await env.DB.prepare(`UPDATE uploaded_documents SET deleted_at = datetime('now') WHERE session_id = ? AND doc_type = ?`).bind(complete.sessionId, docType).run();
    await setStoredFormData(complete.sessionId, forge);

    const res = await submit(accessToken, complete.sessionId, complete.revision);
    expect(res.status).toBe(422);
    expect(await incompleteIds(res)).toEqual([stepId]);
  });

  it('a vaccine answered "providing proof" with no live upload blocks submission', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ledger-vaccine'));
    const complete = await completePacketExceptReview(accessToken, 'general_rn');
    await setStoredFormData(complete.sessionId, (f) => ({
      ...f,
      acknowledgements: { ...(f.acknowledgements as object), hep_b_declination: { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' } },
      vaccineProofDocuments: { hep_b_declination: fake() },
    }));
    const res = await submit(accessToken, complete.sessionId, complete.revision);
    expect(res.status).toBe(422);
    expect(await incompleteIds(res)).toEqual(['hep_b_declination']);
  });

  it('deleting the object through the upload route leaves the step incomplete at submission', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ledger-delete'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const cpr = (complete.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey;
    expect((await deleteUpload(accessToken, cpr)).status).toBe(200);
    const res = await submit(accessToken, complete.sessionId, complete.revision);
    expect(res.status).toBe(422);
    expect(await incompleteIds(res)).toEqual(['documents']);
  });

  it('another applicant\'s upload never satisfies a requirement', async () => {
    const victim = await registerVerifyAndLoginApplicant(uniqueEmail('ledger-victim'));
    const victimsFile = await uploadFile(victim.accessToken);
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ledger-attacker'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    await env.DB.prepare(`UPDATE uploaded_documents SET deleted_at = datetime('now') WHERE session_id = ? AND doc_type = 'cpr_cert'`).bind(complete.sessionId).run();
    await setStoredFormData(complete.sessionId, (f) => ({ ...f, uploadedDocuments: { ...(f.uploadedDocuments as object), cprCertification: fake(victimsFile) } }));
    expect((await submit(accessToken, complete.sessionId, complete.revision)).status).toBe(422);
    expect(await env.DB.prepare('SELECT 1 FROM application_documents WHERE object_key = ?').bind(victimsFile).first()).toBeNull();
  });

  it('the application snapshot holds only what the ledger holds', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ledger-snapshot'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const real = complete.formData.uploadedDocuments as { nursingLicense: { objectKey: string }; cprCertification: { objectKey: string } };
    // The optional license is forged in storage; CPR's stored name is tampered with.
    await env.DB.prepare(`UPDATE uploaded_documents SET deleted_at = datetime('now') WHERE session_id = ? AND doc_type = 'nursing_license'`).bind(complete.sessionId).run();
    await setStoredFormData(complete.sessionId, (f) => ({
      ...f,
      uploadedDocuments: { ...(f.uploadedDocuments as object), nursingLicense: fake(), cprCertification: { ...real.cprCertification, name: 'tampered.jpg' } },
    }));

    const res = await submit(accessToken, complete.sessionId, complete.revision);
    expect(res.status).toBe(201);
    const { applicationId } = (await res.json()) as { applicationId: string };
    const app = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const payload = JSON.parse(app!.payload_json) as { uploadedDocuments: Record<string, { objectKey: string; name: string } | null> };
    expect(payload.uploadedDocuments.nursingLicense).toBeNull();
    expect(payload.uploadedDocuments.cprCertification?.objectKey).toBe(real.cprCertification.objectKey);
    expect(payload.uploadedDocuments.cprCertification?.name).not.toBe('tampered.jpg');
    const docs = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ?').bind(applicationId).all<{ object_key: string }>();
    expect(docs.results.map((d) => d.object_key)).not.toContain('uploads/999/not-mine.jpg');
  });
});

describe('legitimate clients keep working', () => {
  it('an installed client re-sending the document state it last read, as Save Progress does, saves normally', async () => {
    const { accessToken, session } = await newSession('patch-installed');
    const key = await uploadFile(accessToken);
    const associated = (await (await associateDoc(accessToken, session.sessionId, 'cpr_cert', key, session.revision)).json()) as TestSession;

    const res = await patch(accessToken, associated.sessionId, associated.revision, {
      formData: { ...associated.formData, personalInfo: VALID_PERSONAL_INFO, uploadedDocuments: associated.formData.uploadedDocuments },
      stepStates: { ...associated.stepStates, documents: 'in_progress' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TestSession;
    expect(body.formData.personalInfo).toEqual(VALID_PERSONAL_INFO);
    expect((body.formData.uploadedDocuments as { cprCertification: { objectKey: string } }).cprCertification.objectKey).toBe(key);
  });

  it('an installed client completing the documents step after real uploads succeeds', async () => {
    const { accessToken, session } = await newSession('patch-installed-complete');
    const a = await uploadFile(accessToken);
    const afterA = (await (await associateDoc(accessToken, session.sessionId, 'list_a', a, session.revision)).json()) as TestSession;
    const c = await uploadFile(accessToken);
    const afterC = (await (await associateDoc(accessToken, afterA.sessionId, 'cpr_cert', c, afterA.revision)).json()) as TestSession;
    const res = await patch(accessToken, afterC.sessionId, afterC.revision, {
      formData: { ...afterC.formData, uploadedDocuments: { ...(afterC.formData.uploadedDocuments as object) } },
      stepStates: { documents: 'completed' },
    });
    expect(res.status).toBe(200);
  });

  it('a session whose first PATCH defaults the document keys to empty stays usable', async () => {
    const { accessToken, session } = await newSession('patch-defaults');
    const res = await patch(accessToken, session.sessionId, session.revision, {
      formData: { uploadedDocuments: { listA: null, listB: null, listC: null, nursingLicense: null, cprCertification: null }, directDepositProofDocument: null, resumeDocument: null, vaccineProofDocuments: {} },
    });
    expect(res.status).toBe(200);
    const after = (await res.json()) as TestSession;
    const key = await uploadFile(accessToken);
    expect((await associateDoc(accessToken, after.sessionId, 'list_a', key, after.revision)).status).toBe(200);
  });

  it('every other formData key still saves through PATCH', async () => {
    const { accessToken, session } = await newSession('patch-other-keys');
    const formData = { personalInfo: VALID_PERSONAL_INFO, acknowledgements: { hep_b_declination: { decision: 'declining' } }, safetyEducation: { fireSafety: true } };
    const body = (await (await patch(accessToken, session.sessionId, session.revision, { formData })).json()) as TestSession;
    expect(body.formData).toMatchObject(formData);
  });

  it('a normal application with real uploads submits, and every real document is promoted', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ledger-normal'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const res = await submit(accessToken, complete.sessionId, complete.revision);
    expect(res.status).toBe(201);
    const { applicationId } = (await res.json()) as { applicationId: string };
    const cookie = await loginAsAdmin();
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { documents: { docType: string | null }[] };
    expect(detail.documents.map((d) => d.docType)).toEqual(expect.arrayContaining(['applicant_resume', 'list_a', 'nursing_license', 'cpr_cert', 'direct_deposit_voided_check']));
  });
});
