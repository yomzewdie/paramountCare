import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { getPacket } from '@pcs/shared';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';
import {
  fakeFile,
  uploadFile,
  createTestSession,
  completePacketExceptReview,
  associateDoc,
  removeDoc,
  submit,
  countApplicationDocuments,
  type TestSession,
} from './submissionFixtures';

// Vaccination evidence: when an applicant answers "I am providing proof of
// vaccination", a proof upload is required (server-enforced), stored through
// the SAME ownership-verified document-slot mechanism as every other
// upload, categorized by doc_type, and retrievable by admins through the
// existing protected download route.

const VACCINES = [
  { stepId: 'hep_b_declination', docType: 'hep_b_vaccination_proof', label: 'Hepatitis B' },
  { stepId: 'tdap_declination', docType: 'tdap_vaccination_proof', label: 'Tdap' },
  { stepId: 'flu_declination', docType: 'flu_vaccination_proof', label: 'Influenza' },
] as const;

// A real packet that actually contains the vaccine step (never assumed).
function packetWith(stepId: string): string {
  const id = ['general_rn', 'icu_rn', 'er_rn', 'lvn', 'travel_rn'].find((p) => getPacket(p)?.steps.some((s) => s.id === stepId));
  if (!id) throw new Error(`no packet contains ${stepId}`);
  return id;
}

const PROVIDING = { checked: false, typedSignature: '', signedAt: '', decision: 'providing_proof' };
const DECLINING = { checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z', decision: 'declining' };

async function markStep(token: string, s: TestSession, stepId: string, entry: object): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      revision: s.revision,
      formData: { ...s.formData, acknowledgements: { ...(s.formData.acknowledgements as object), [stepId]: entry } },
      stepStates: { ...s.stepStates, [stepId]: 'completed' },
    }),
  });
}

async function attachProof(token: string, s: TestSession, docType: string, name = 'proof.pdf'): Promise<{ session: TestSession; objectKey: string }> {
  const objectKey = await uploadFile(token, fakeFile(name, 'application/pdf', 300));
  const res = await associateDoc(token, s.sessionId, docType, objectKey, s.revision);
  expect(res.status).toBe(200);
  return { session: (await res.json()) as TestSession, objectKey };
}

describe.each(VACCINES)('$label vaccination proof - slot', ({ stepId, docType }) => {
  it('associates through the standard document route into formData.vaccineProofDocuments[stepId], categorized by doc_type', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-assoc-${docType}`));
    const session = await createTestSession(accessToken, packetWith(stepId));
    const { session: after, objectKey } = await attachProof(accessToken, session, docType, 'my-record.pdf');

    const stored = (after.formData.vaccineProofDocuments as Record<string, { name: string; objectKey: string; type: string }>)[stepId];
    expect(stored).toMatchObject({ name: 'my-record.pdf', objectKey, type: 'application/pdf' });

    const row = await env.DB.prepare('SELECT doc_type, session_id FROM uploaded_documents WHERE object_key = ?')
      .bind(objectKey).first<{ doc_type: string; session_id: string }>();
    expect(row).toEqual({ doc_type: docType, session_id: session.sessionId });
  });

  it('can be removed again (session reference cleared)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-remove-${docType}`));
    const session = await createTestSession(accessToken, packetWith(stepId));
    const { session: after } = await attachProof(accessToken, session, docType);

    const res = await removeDoc(accessToken, after.sessionId, docType, after.revision);
    expect(res.status).toBe(200);
    const cleared = (await res.json()) as TestSession;
    expect((cleared.formData.vaccineProofDocuments as Record<string, unknown>)[stepId]).toBeNull();
  });

  it('rejects an object the caller did not upload (ownership stays server-side)', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-owner-${docType}`));
    const other = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-other-${docType}`));
    const foreignKey = await uploadFile(owner.accessToken, fakeFile('theirs.pdf', 'application/pdf', 100));
    const session = await createTestSession(other.accessToken, packetWith(stepId));

    const res = await associateDoc(other.accessToken, session.sessionId, docType, foreignKey, session.revision);
    expect(res.status).toBe(403);
  });
});

describe('vaccination proof - unknown slots are still rejected', () => {
  it('a vaccine-like but unlisted docType is 422', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('vax-unknown'));
    const session = await createTestSession(accessToken, 'icu_rn');
    const objectKey = await uploadFile(accessToken);
    const res = await associateDoc(accessToken, session.sessionId, 'covid_vaccination_proof', objectKey, session.revision);
    expect(res.status).toBe(422);
  });
});

describe.each(VACCINES)('$label - conditional proof requirement (server-enforced)', ({ stepId, docType }) => {
  it('"providing proof" cannot be marked complete WITHOUT an uploaded proof', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-req-${docType}`));
    const session = await createTestSession(accessToken, packetWith(stepId));
    const res = await markStep(accessToken, session, stepId, PROVIDING);
    expect(res.status).toBe(422);
  });

  it('"providing proof" CAN be completed once the proof is attached', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-ok-${docType}`));
    const session = await createTestSession(accessToken, packetWith(stepId));
    const { session: withProof } = await attachProof(accessToken, session, docType);
    const res = await markStep(accessToken, withProof, stepId, PROVIDING);
    expect(res.status).toBe(200);
  });

  it('a true declination never requires a proof', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-decl-${docType}`));
    const session = await createTestSession(accessToken, packetWith(stepId));
    const res = await markStep(accessToken, session, stepId, DECLINING);
    expect(res.status).toBe(200);
  });

  it('switching from "providing proof" to declining is valid, and the already-uploaded file is not silently deleted', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-switch-${docType}`));
    const session = await createTestSession(accessToken, packetWith(stepId));
    const { session: withProof, objectKey } = await attachProof(accessToken, session, docType);
    const providing = (await (await markStep(accessToken, withProof, stepId, PROVIDING)).json()) as TestSession;

    const res = await markStep(accessToken, providing, stepId, DECLINING);
    expect(res.status).toBe(200);
    const declined = (await res.json()) as TestSession;
    expect((declined.formData.vaccineProofDocuments as Record<string, { objectKey: string }>)[stepId].objectKey).toBe(objectKey);
    expect((await env.UPLOADS_BUCKET.head(objectKey))).not.toBeNull();
  });
});

describe('vaccination proof - submission, categorization, and admin retrieval', () => {
  it('a submitted application promotes the proof with its doc_type, shows it to admins, and the protected download returns it', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('vax-e2e'));
    const packetId = packetWith('hep_b_declination');
    const baseline = await completePacketExceptReview(accessToken, packetId); // vaccines declined

    // Applicant changes Hep B to "providing proof" and uploads the evidence.
    const { session: withProof, objectKey } = await attachProof(accessToken, baseline, 'hep_b_vaccination_proof', 'hepb-card.pdf');
    const switched = await markStep(accessToken, withProof, 'hep_b_declination', PROVIDING);
    expect(switched.status).toBe(200);
    const ready = (await switched.json()) as TestSession;

    const submitRes = await submit(accessToken, ready.sessionId, ready.revision);
    expect(submitRes.status).toBe(201);
    const { applicationId } = (await submitRes.json()) as { applicationId: string };

    // Categorized in the application's document manifest.
    const promoted = await env.DB.prepare('SELECT doc_type, file_name, object_key FROM application_documents WHERE application_id = ? AND doc_type = ?')
      .bind(applicationId, 'hep_b_vaccination_proof').first<{ doc_type: string; file_name: string; object_key: string }>();
    expect(promoted).toMatchObject({ doc_type: 'hep_b_vaccination_proof', file_name: 'hepb-card.pdf', object_key: objectKey });

    // Admin detail identifies it (docType), without exposing anything new.
    const cookie = await loginAsAdmin();
    const detailRes = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } });
    const detail = (await detailRes.json()) as { documents: { id: number; docType: string | null; fileName: string }[] };
    const proofDoc = detail.documents.find((d) => d.docType === 'hep_b_vaccination_proof');
    expect(proofDoc).toMatchObject({ fileName: 'hepb-card.pdf' });

    // The EXISTING protected download serves it.
    const dl = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${proofDoc!.id}/download`, { headers: { cookie } });
    expect(dl.status).toBe(200);
    expect(dl.headers.get('cache-control')).toBe('private, no-store');
    expect(dl.headers.get('content-type')).toBe('application/pdf');
    expect((await dl.arrayBuffer()).byteLength).toBe(300);

    // ...and still refuses an unauthenticated caller.
    const anon = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/documents/${proofDoc!.id}/download`);
    expect(anon.status).toBe(401);

    expect(await countApplicationDocuments(applicationId)).toBeGreaterThan(0);
  });

  it('submission is refused if a "providing proof" answer has no proof (defense in depth)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('vax-submit-guard'));
    const baseline = await completePacketExceptReview(accessToken, packetWith('hep_b_declination'));

    // Force an inconsistent state: answer flips to providing_proof with NO proof, step still 'completed'.
    const res = await markStep(accessToken, baseline, 'hep_b_declination', PROVIDING);
    if (res.status === 200) {
      const forced = (await res.json()) as TestSession;
      const submitRes = await submit(accessToken, forced.sessionId, forced.revision);
      expect(submitRes.status).not.toBe(201);
    } else {
      expect(res.status).toBe(422);
    }
  });
});

// ── Final-answer rule: only proof for a vaccine whose FINAL answer is
// "providing proof" becomes part of the submitted application ─────────────

async function adminDocs(applicationId: string) {
  const cookie = await loginAsAdmin();
  const res = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } });
  return (await res.json()) as {
    payload: { vaccineProofDocuments?: Record<string, unknown>; acknowledgements: Record<string, { decision: string }> };
    documents: { id: number; docType: string | null; fileName: string }[];
  };
}

const VACCINE_DOC_TYPES: string[] = VACCINES.map((v) => v.docType);

async function promotedVaccineDocTypes(applicationId: string): Promise<string[]> {
  const rows = await env.DB.prepare(
    `SELECT doc_type FROM application_documents WHERE application_id = ? AND doc_type IN (${VACCINE_DOC_TYPES.map(() => '?').join(',')}) ORDER BY doc_type`,
  ).bind(applicationId, ...VACCINE_DOC_TYPES).all<{ doc_type: string }>();
  return rows.results.map((r) => r.doc_type);
}

/** Walks a real packet to submittable, then applies the given per-vaccine sequence of answers (uploading proof for the FIRST providing answer) and submits. */
async function submitAfter(
  token: string,
  stepId: string,
  docType: string,
  answers: ('providing' | 'declining')[],
): Promise<{ applicationId: string; objectKey: string; sessionId: string }> {
  let s = await completePacketExceptReview(token, packetWith(stepId)); // every vaccine declined
  const { session, objectKey } = await attachProof(token, s, docType, `${stepId}-proof.pdf`);
  s = session;
  for (const a of answers) {
    const res = await markStep(token, s, stepId, a === 'providing' ? PROVIDING : DECLINING);
    expect(res.status).toBe(200);
    s = (await res.json()) as TestSession;
  }
  const submitRes = await submit(token, s.sessionId, s.revision);
  expect(submitRes.status).toBe(201);
  const { applicationId } = (await submitRes.json()) as { applicationId: string };
  return { applicationId, objectKey, sessionId: s.sessionId };
}

describe.each(VACCINES)('$label - final answer decides whether the proof is promoted', ({ stepId, docType }) => {
  it('providing proof + upload + submit: the proof is promoted and shown to admins', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-final-yes-${docType}`));
    const { applicationId } = await submitAfter(accessToken, stepId, docType, ['providing']);

    expect(await promotedVaccineDocTypes(applicationId)).toEqual([docType]);
    const detail = await adminDocs(applicationId);
    expect(detail.documents.filter((d) => d.docType === docType)).toHaveLength(1);
    expect(detail.payload.vaccineProofDocuments?.[stepId]).toBeTruthy();
  });

  it('providing proof + upload, then switched to a declination: the proof is NOT promoted and not shown as evidence', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-final-no-${docType}`));
    const { applicationId, objectKey, sessionId } = await submitAfter(accessToken, stepId, docType, ['providing', 'declining']);

    expect(await promotedVaccineDocTypes(applicationId)).toEqual([]);
    const detail = await adminDocs(applicationId);
    expect(detail.documents.some((d) => d.docType === docType)).toBe(false);
    expect(detail.payload.acknowledgements[stepId].decision).toBe('declining');
    expect(detail.payload.vaccineProofDocuments?.[stepId]).toBeUndefined();

    // Not deleted: still on the submitted session's upload ledger and in storage; simply not part of the application.
    const ledger = await env.DB.prepare('SELECT deleted_at FROM uploaded_documents WHERE object_key = ? AND session_id = ?')
      .bind(objectKey, sessionId).first<{ deleted_at: string | null }>();
    expect(ledger?.deleted_at).toBeNull();
    expect(await env.UPLOADS_BUCKET.head(objectKey)).not.toBeNull();
    const inApplication = await env.DB.prepare('SELECT 1 AS x FROM application_documents WHERE application_id = ? AND object_key = ?')
      .bind(applicationId, objectKey).first();
    expect(inApplication).toBeNull();
  });

  it('switching to a declination and BACK to providing proof reuses the existing upload (no re-upload) and it is promoted', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-final-back-${docType}`));
    // providing -> declining -> providing again, with the single original upload
    const { applicationId, objectKey } = await submitAfter(accessToken, stepId, docType, ['providing', 'declining', 'providing']);

    expect(await promotedVaccineDocTypes(applicationId)).toEqual([docType]);
    const promoted = await env.DB.prepare('SELECT object_key FROM application_documents WHERE application_id = ? AND doc_type = ?')
      .bind(applicationId, docType).first<{ object_key: string }>();
    expect(promoted?.object_key).toBe(objectKey);
  });

  it('while still in progress, the proof stays on the session after switching to a declination (not deleted)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(`vax-inprogress-${docType}`));
    const s0 = await createTestSession(accessToken, packetWith(stepId));
    const { session: withProof, objectKey } = await attachProof(accessToken, s0, docType);
    const providing = (await (await markStep(accessToken, withProof, stepId, PROVIDING)).json()) as TestSession;
    const declined = (await (await markStep(accessToken, providing, stepId, DECLINING)).json()) as TestSession;

    expect((declined.formData.vaccineProofDocuments as Record<string, { objectKey: string }>)[stepId].objectKey).toBe(objectKey);
    const row = await env.DB.prepare('SELECT deleted_at FROM uploaded_documents WHERE object_key = ?').bind(objectKey).first<{ deleted_at: string | null }>();
    expect(row?.deleted_at).toBeNull();
  });
});

describe('final-answer rule - several vaccines at once', () => {
  it('only the vaccines whose FINAL answer is "providing proof" are promoted; other documents are unaffected', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('vax-mixed'));
    const packetId = packetWith('hep_b_declination');
    const withAll = VACCINES.filter((v) => getPacket(packetId)!.steps.some((st) => st.id === v.stepId));
    expect(withAll.length).toBe(3);

    let s = await completePacketExceptReview(accessToken, packetId);
    // Upload proof for ALL three vaccines...
    for (const v of VACCINES) s = (await attachProof(accessToken, s, v.docType, `${v.stepId}.pdf`)).session;
    // ...but only Hep B (providing) and Tdap (providing then declined) — flu stays declining; final: Hep B yes, Tdap no, Flu no.
    for (const [stepId, answer] of [['hep_b_declination', PROVIDING], ['tdap_declination', PROVIDING], ['tdap_declination', DECLINING]] as const) {
      const res = await markStep(accessToken, s, stepId, answer);
      expect(res.status).toBe(200);
      s = (await res.json()) as TestSession;
    }
    const submitRes = await submit(accessToken, s.sessionId, s.revision);
    expect(submitRes.status).toBe(201);
    const { applicationId } = (await submitRes.json()) as { applicationId: string };

    expect(await promotedVaccineDocTypes(applicationId)).toEqual(['hep_b_vaccination_proof']);
    const detail = await adminDocs(applicationId);
    expect(detail.documents.filter((d) => d.docType && VACCINE_DOC_TYPES.includes(d.docType)).map((d) => d.docType)).toEqual(['hep_b_vaccination_proof']);
    expect(Object.keys(detail.payload.vaccineProofDocuments ?? {})).toEqual(['hep_b_declination']);

    // Non-vaccine documents (voided check, I-9/credential uploads) are all still promoted.
    const others = await env.DB.prepare(`SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ? AND doc_type NOT IN (${VACCINE_DOC_TYPES.map(() => '?').join(',')})`)
      .bind(applicationId, ...VACCINE_DOC_TYPES).first<{ n: number }>();
    expect(others!.n).toBeGreaterThan(0);
  });

  it('a submitted application with all vaccines declined and NO uploads promotes no vaccination evidence', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('vax-none'));
    const s = await completePacketExceptReview(accessToken, packetWith('hep_b_declination'));
    const submitRes = await submit(accessToken, s.sessionId, s.revision);
    expect(submitRes.status).toBe(201);
    const { applicationId } = (await submitRes.json()) as { applicationId: string };
    expect(await promotedVaccineDocTypes(applicationId)).toEqual([]);
  });
});
