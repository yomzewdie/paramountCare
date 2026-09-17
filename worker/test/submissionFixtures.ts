import { SELF, env } from 'cloudflare:test';
import { expect } from 'vitest';
import { getPacket, type PacketStep } from '@pcs/shared';
import { BASE } from './helpers';

// M16 — building blocks for "walk an entire real packet to a genuinely
// submittable state" used by submission.spec.ts. One function per step
// TYPE (not per step id) so a packet's actual real steps drive what runs —
// never a hardcoded step list — matching this whole codebase's standing
// "packet-aware, never assumed" discipline.
//
// Also the shared home for small HTTP-call helpers (submit/patch/associate/
// remove/deleteUpload) and cross-cutting assertions (submittedSession) used
// by BOTH submission.spec.ts and i9Finalization.spec.ts — kept here rather
// than duplicated in each file, or than growing one single ever-larger spec
// file (which was empirically found to strain
// @cloudflare/vitest-pool-workers' isolated-storage teardown once a single
// file's real D1/R2/outbound-network volume gets too high).

export function fakeFile(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes).fill(7)], name, { type });
}

export async function uploadFile(accessToken: string, file: File = fakeFile('doc.jpg', 'image/jpeg', 200)): Promise<string> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await SELF.fetch(`${BASE}/api/uploads`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
  const body = (await res.json()) as { objectKey: string };
  return body.objectKey;
}

export interface TestSession {
  sessionId: string;
  revision: number;
  formData: Record<string, unknown>;
  stepStates: Record<string, string>;
}

export async function createTestSession(accessToken: string, packetId: string): Promise<TestSession> {
  const res = await SELF.fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ packetId }),
  });
  return res.json();
}

async function patchStep(
  accessToken: string,
  session: TestSession,
  formDataPatch: Record<string, unknown>,
  stepId: string,
): Promise<TestSession> {
  const res = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      revision: session.revision,
      formData: { ...session.formData, ...formDataPatch },
      // stepStates is a full-replace, not a merge (see sessionApi.ts's own
      // doc comment) — every previously-completed step must be re-sent
      // alongside this one, or it silently reverts to "not started."
      stepStates: { ...session.stepStates, [stepId]: 'completed' },
    }),
  });
  if (res.status !== 200) {
    throw new Error(`patchStep(${stepId}) failed (${res.status}): ${await res.text()}`);
  }
  // The Worker stores formData exactly as sent (full-replace contract, not
  // a server-side merge) — the response's own formData is already
  // authoritative, no need to reconstruct it client-side.
  return res.json();
}

const VALID_PERSONAL_INFO = {
  firstName: 'Jane', lastName: 'Doe', middleInitial: '', otherLastNames: '',
  email: 'jane.doe@example.com', phone: '5551234567',
  address: '123 Main St', aptNumber: '', city: 'Los Angeles', state: 'CA', zip: '90001',
};

const VALID_EMPLOYMENT_APPLICATION = {
  positionApplied: 'RN', specialtyPreference: 'Med-Surg', shiftPreference: 'day', employmentType: 'full_time',
  availableStartDate: '2026-01-01',
  licenseType: 'RN', licenseNumber: 'RN123456', licenseState: 'CA', licenseExpiration: '2028-01-01',
  yearsExperience: '3-5', primarySpecialty: 'Med-Surg',
  authorizedToWork: true, hasConviction: false, convictionDetails: '',
  hasLicenseDiscipline: false, licenseDisciplineDetails: '',
  hasLicenseRevocation: false, licenseRevocationDetails: '',
  underInvestigation: false,
  emergencyContactName: 'John Doe', emergencyContactRelationship: 'Spouse', emergencyContactPhone: '5559876543',
};

const SIGNED_ACK = { checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z' };
const DECLINING_VACCINE = { checked: true, typedSignature: 'Jane Doe', signedAt: '2026-01-01T00:00:00.000Z', decision: 'declining' };

const VALID_REFERENCE = {
  positionHeld: 'RN', employmentDateFrom: '01/2020', employmentDateTo: '01/2022',
  employerName: 'Test Hospital', employerCity: 'Los Angeles', employerState: 'CA',
  supervisorName: 'Supervisor Name', supervisorPhone: '5551112222',
  permissionGranted: true, reasonForLeaving: 'Relocation', eligibleForRehire: true,
  rehireDetails: '', comments: '',
};

const VALID_W4 = {
  firstNameMI: 'Jane', lastName: 'Doe', ssn: '123-45-6789',
  address: '123 Main St', cityStateZip: 'Los Angeles, CA 90001', filingStatus: 'single_mfs',
  multipleJobs: false, qualifyingChildren: '', otherDependents: '', totalDependents: '', otherIncome: '', deductions: '', extraWithholding: '',
  typedSignature: 'Jane Doe', signedDate: '01/01/2026',
};

const VALID_I9 = {
  dateOfBirth: '01/01/1990', citizenshipStatus: 'citizen',
  alienRegistrationNumber: '', alienWorkAuthExpiration: '', alienWorkAuthType: '', alienNumber: '', i94Number: '',
  foreignPassportNumber: '', foreignPassportCountry: '',
  i9SignatureDataUrl: '', i9SignatureType: 'typed', i9TypedSignature: 'Jane Doe', i9SignedDate: '01/01/2026',
};

const SAFETY_ALL_TRUE = {
  patientSafety: true, infectionControl: true, fireSafety: true, patientRightsHipaa: true,
  workplaceViolence: true, backSafety: true, hazardousMaterials: true, documentationStandards: true,
  examAttestation: true,
};

/** Completes ONE required step, dispatching purely on the step's own
 * type/subtype/config — never on its id — so this works unmodified for
 * every packet. Uploads (direct deposit proof, documents) go through the
 * real POST /api/uploads + POST /api/sessions/:id/documents/:docType
 * association endpoints, exactly like a real applicant, so the
 * `uploaded_documents` ownership ledger this milestone's document
 * promotion depends on is genuinely populated, not faked. */
async function completeStep(accessToken: string, session: TestSession, step: PacketStep): Promise<TestSession> {
  switch (step.type) {
    case 'personal_info':
      return patchStep(accessToken, session, { personalInfo: VALID_PERSONAL_INFO }, step.id);

    case 'internal_form':
      if (step.subtype === 'employment_application') {
        return patchStep(accessToken, session, { employmentApplication: VALID_EMPLOYMENT_APPLICATION }, step.id);
      }
      if (step.subtype === 'direct_deposit') {
        const objectKey = await uploadFile(accessToken, fakeFile('check.jpg', 'image/jpeg', 100));
        const assocRes = await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}/documents/direct_deposit_voided_check`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ objectKey, revision: session.revision }),
        });
        const assocBody = (await assocRes.json()) as TestSession;
        if (assocRes.status !== 200) throw new Error(`direct_deposit upload association failed: ${JSON.stringify(assocBody)}`);
        return patchStep(
          accessToken,
          assocBody,
          {
            directDepositData: {
              lastName: 'Doe', firstName: 'Jane', middleInitial: '', employeeId: '',
              primaryAccount: {
                bankName: 'Test Bank', accountType: 'checking',
                routingNumber: '011000015', accountNumber: '1234567890',
                depositType: 'percentage', depositAmount: '100',
              },
              additionalAccount: { bankName: '', accountType: '', routingNumber: '', accountNumber: '', depositType: '', depositAmount: '' },
              typedSignature: 'Jane Doe', signedDate: '01/01/2026',
            },
          },
          step.id,
        );
      }
      // Any other internal_form falls through to the generic acknowledgement path below.
      return patchStep(accessToken, session, { acknowledgements: { ...(session.formData.acknowledgements as object), [step.id]: SIGNED_ACK } }, step.id);

    case 'employment_reference':
      return patchStep(accessToken, session, { employmentReferences: { ...(session.formData.employmentReferences as object), [step.id]: VALID_REFERENCE } }, step.id);

    case 'government_form':
      if (step.subtype === 'w4') return patchStep(accessToken, session, { w4Data: VALID_W4 }, step.id);
      if (step.subtype === 'i9') return patchStep(accessToken, session, { i9Data: VALID_I9 }, step.id);
      return patchStep(accessToken, session, { acknowledgements: { ...(session.formData.acknowledgements as object), [step.id]: SIGNED_ACK } }, step.id);

    case 'acknowledgement':
      if (step.config?.hasDeclination) {
        return patchStep(accessToken, session, { acknowledgements: { ...(session.formData.acknowledgements as object), [step.id]: DECLINING_VACCINE } }, step.id);
      }
      if (step.config?.acknowledgementId === 'safety_acknowledgements') {
        return patchStep(accessToken, session, { safetyEducation: SAFETY_ALL_TRUE }, step.id);
      }
      return patchStep(accessToken, session, { acknowledgements: { ...(session.formData.acknowledgements as object), [step.id]: SIGNED_ACK } }, step.id);

    case 'document_upload': {
      let current = session;
      const docTypes: string[] = [];
      if (step.config?.i9Uploads) docTypes.push('list_a');
      for (const key of step.config?.requiredUploads ?? []) docTypes.push(key);

      // Each association call already PATCHes formData.uploadedDocuments
      // server-side and returns the updated authoritative session — no
      // separate client-side merge needed (and merging a stale local copy
      // back in afterward would silently revert these associations).
      for (const docType of docTypes) {
        const objectKey = await uploadFile(accessToken, fakeFile(`${docType}.jpg`, 'image/jpeg', 150));
        const assocRes = await SELF.fetch(`${BASE}/api/sessions/${current.sessionId}/documents/${docType}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ objectKey, revision: current.revision }),
        });
        const assocBody = (await assocRes.json()) as TestSession;
        if (assocRes.status !== 200) throw new Error(`documents upload association (${docType}) failed: ${JSON.stringify(assocBody)}`);
        current = assocBody;
      }
      return patchStep(accessToken, current, {}, step.id);
    }

    case 'exam':
      // Optional (safety_exam) — deliberately never completed by this
      // helper, so tests exercising it prove it's genuinely non-blocking.
      return session;

    default:
      return session;
  }
}

/** Walks every REQUIRED step of a real packet (except `review` itself) to
 * a genuinely, server-validated complete state, using the real endpoints
 * a mobile applicant would actually call. Returns the final session state,
 * ready to call POST /api/sessions/:sessionId/submit against. */
export async function completePacketExceptReview(accessToken: string, packetId: string): Promise<TestSession> {
  const packet = getPacket(packetId);
  if (!packet) throw new Error(`Unknown packetId: ${packetId}`);

  let session = await createTestSession(accessToken, packetId);
  for (const step of packet.steps) {
    if (step.id === 'review' || !step.required) continue;
    session = await completeStep(accessToken, session, step);
  }
  return session;
}

// ── Shared HTTP-call helpers ─────────────────────────────────────────────

export async function submit(accessToken: string, sessionId: string, revision: number): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${sessionId}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ revision }),
  });
}

export async function patch(accessToken: string, sessionId: string, revision: number, body: Record<string, unknown> = {}): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${sessionId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ revision, ...body }),
  });
}

export async function associateDoc(accessToken: string, sessionId: string, docType: string, objectKey: string, revision: number): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${sessionId}/documents/${docType}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ objectKey, revision }),
  });
}

export async function removeDoc(accessToken: string, sessionId: string, docType: string, revision: number): Promise<Response> {
  return SELF.fetch(`${BASE}/api/sessions/${sessionId}/documents/${docType}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ revision }),
  });
}

export async function deleteUpload(accessToken: string, objectKey: string): Promise<Response> {
  return SELF.fetch(`${BASE}/api/uploads`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ objectKey }),
  });
}

export async function countApplications(applicationId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM applications WHERE application_id = ?')
    .bind(applicationId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function countApplicationDocuments(applicationId: string): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM application_documents WHERE application_id = ?')
    .bind(applicationId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function submittedSession(accessToken: string, packetId = 'icu_rn') {
  const session = await completePacketExceptReview(accessToken, packetId);
  const res = await submit(accessToken, session.sessionId, session.revision);
  expect(res.status).toBe(201);
  const body = await res.json() as { applicationId: string };
  const latest = await (await SELF.fetch(`${BASE}/api/sessions/${session.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json() as TestSession;
  return { session, applicationId: body.applicationId, latest };
}

/** Injects a name pdf-lib's WinAnsi-only standard fonts cannot render
 * directly into a session's stored form_data_json, bypassing the
 * (now-blocked) applicant-facing PATCH route entirely — used by both
 * i9Finalization.spec.ts's deterministic-failure tests and its Unicode-
 * font-support tests to set up realistic, immutable-once-submitted
 * session data. */
export async function setPersonalInfoFirstName(sessionId: string, firstName: string): Promise<void> {
  const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(sessionId).first<{ form_data_json: string }>();
  const formData = JSON.parse(row!.form_data_json) as { personalInfo: Record<string, unknown> };
  formData.personalInfo.firstName = firstName;
  await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?').bind(JSON.stringify(formData), sessionId).run();
}
