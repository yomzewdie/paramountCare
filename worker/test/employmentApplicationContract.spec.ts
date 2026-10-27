import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { defaultFormData } from '@pcs/shared';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant } from './helpers';
import {
  createTestSession,
  completePacketExceptReview,
  patch,
  submit,
  VALID_EMPLOYMENT_APPLICATION,
  VALID_REFERENCE,
  type TestSession,
} from './submissionFixtures';

// UAT feedback — Employment Application / Employment Reference contract
// changes, exercised through the real PATCH and submit routes (shared
// validation is what the Worker enforces; these prove it's wired in and
// that pre-change sessions keep working).

async function completeEmploymentApplication(accessToken: string, session: TestSession, data: Record<string, unknown>): Promise<Response> {
  return patch(accessToken, session.sessionId, session.revision, {
    formData: { ...session.formData, employmentApplication: data },
    stepStates: { ...session.stepStates, employment_application: 'completed' },
  });
}

async function getSession(accessToken: string, sessionId: string): Promise<TestSession> {
  const res = await SELF.fetch(`${BASE}/api/sessions/${sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return res.json();
}

describe('employment_application completion - new contract', () => {
  it('accepts RN with selected units, multiple shifts, and a listed specialty', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ea-rn'));
    const session = await createTestSession(accessToken, 'general_rn');
    const res = await completeEmploymentApplication(accessToken, session, {
      ...VALID_EMPLOYMENT_APPLICATION,
      specialtyPreference: ['icu', 'er', 'l_and_d'],
      shiftPreference: ['am', 'mid', 'pm'],
      employmentType: 'travel_assignment',
    });
    expect(res.status).toBe(200);
  });

  it('accepts CNA with no unit preference', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ea-cna'));
    const session = await createTestSession(accessToken, 'general_rn');
    const res = await completeEmploymentApplication(accessToken, session, {
      ...VALID_EMPLOYMENT_APPLICATION, positionApplied: 'CNA', specialtyPreference: [],
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['non-CNA without a unit preference', { specialtyPreference: [] }],
    ['an unknown unit value', { specialtyPreference: ['peds'] }],
    ['an unknown shift value', { shiftPreference: ['overnight'] }],
    ['a legacy employment type', { employmentType: 'full_time' }],
    ['a legacy free-text position', { positionApplied: 'RN — Med/Surg' }],
    ['an impossible license expiration date', { licenseExpiration: '2028-02-30' }],
    ['a display-format (non-canonical) license expiration date', { licenseExpiration: '01-01-2028' }],
  ])('rejects completion with %s', async (_label, override) => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ea-reject'));
    const session = await createTestSession(accessToken, 'general_rn');
    const res = await completeEmploymentApplication(accessToken, session, { ...VALID_EMPLOYMENT_APPLICATION, ...override });
    expect(res.status).toBe(422);
  });
});

describe('employment_application completion - resume-first (work history comes from the resume)', () => {
  it('accepts completion without any experience/work-history field', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ea-resume-first'));
    const session = await createTestSession(accessToken, 'general_rn');
    expect(VALID_EMPLOYMENT_APPLICATION).not.toHaveProperty('yearsExperience');
    expect(VALID_EMPLOYMENT_APPLICATION).not.toHaveProperty('primarySpecialty');
    const res = await completeEmploymentApplication(accessToken, session, VALID_EMPLOYMENT_APPLICATION);
    expect(res.status).toBe(200);
  });

  it('never rejects a legacy experience value, even one the old rules would have (Other without text)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ea-legacy-specialty'));
    const session = await createTestSession(accessToken, 'general_rn');
    const res = await completeEmploymentApplication(accessToken, session, {
      ...VALID_EMPLOYMENT_APPLICATION, yearsExperience: '', primarySpecialty: 'other', primarySpecialtyOther: '',
    });
    expect(res.status).toBe(200);
  });

  it.each([
    ['position', { positionApplied: '' }],
    ['employment type', { employmentType: '' }],
    ['shift preference', { shiftPreference: [] }],
    ['license number', { licenseNumber: '' }],
    ['license expiration', { licenseExpiration: '' }],
    ['work authorization answer', { authorizedToWork: null }],
    ['conviction answer', { hasConviction: null }],
    ['emergency contact phone', { emergencyContactPhone: '' }],
  ])('still requires the relocated structured field: %s', async (_label, override) => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ea-still-required'));
    const session = await createTestSession(accessToken, 'general_rn');
    const res = await completeEmploymentApplication(accessToken, session, { ...VALID_EMPLOYMENT_APPLICATION, ...override });
    expect(res.status).toBe(422);
  });
});

describe('employment_reference completion - Supervisor Title replaces Reason for Leaving', () => {
  it('requires supervisorTitle and no longer requires reasonForLeaving', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('ref-title'));
    const session = await createTestSession(accessToken, 'general_rn');

    const missingTitle = await patch(accessToken, session.sessionId, session.revision, {
      formData: { ...session.formData, employmentReferences: { employment_ref_1: { ...VALID_REFERENCE, supervisorTitle: '' } } },
      stepStates: { ...session.stepStates, employment_ref_1: 'completed' },
    });
    expect(missingTitle.status).toBe(422);

    const ok = await patch(accessToken, session.sessionId, session.revision, {
      formData: { ...session.formData, employmentReferences: { employment_ref_1: VALID_REFERENCE } },
      stepStates: { ...session.stepStates, employment_ref_1: 'completed' },
    });
    expect(ok.status).toBe(200);
    expect(VALID_REFERENCE).not.toHaveProperty('reasonForLeaving');
  });
});

describe('sessions saved before the UAT changes', () => {
  it('a step completed under the old rules never blocks saving other steps, but still blocks final submission', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('legacy-session'));
    const session = await createTestSession(accessToken, 'general_rn');

    // Seed the exact pre-change shape directly (string unit/shift, legacy
    // employment type, reference with reasonForLeaving and no title).
    const legacyFormData = {
      employmentApplication: {
        ...VALID_EMPLOYMENT_APPLICATION,
        specialtyPreference: 'Med-Surg', shiftPreference: 'day', employmentType: 'full_time', primarySpecialty: 'Critical Care',
      },
      employmentReferences: { employment_ref_1: { ...VALID_REFERENCE, supervisorTitle: undefined, reasonForLeaving: 'Relocation' } },
    };
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ?, step_states_json = ? WHERE session_id = ?')
      .bind(JSON.stringify(legacyFormData), JSON.stringify({ employment_application: 'completed', employment_ref_1: 'completed' }), session.sessionId)
      .run();
    const seeded = await getSession(accessToken, session.sessionId);
    expect(seeded.formData.employmentApplication).toMatchObject({ shiftPreference: 'day' }); // stored data is never rewritten on read

    // Saving an unrelated step re-sends the full stepStates (as mobile does).
    const res = await patch(accessToken, seeded.sessionId, seeded.revision, {
      formData: { ...seeded.formData, personalInfo: { ...defaultFormData.personalInfo, firstName: 'Jane' } },
      stepStates: { ...seeded.stepStates, personal_info: 'in_progress' },
    });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as TestSession;

    const submitRes = await submit(accessToken, saved.sessionId, saved.revision);
    expect(submitRes.status).toBe(422);
    const body = (await submitRes.json()) as { incompleteSteps: { id: string }[] };
    const ids = body.incompleteSteps.map((s) => s.id);
    expect(ids).toContain('employment_application');
    expect(ids).toContain('employment_ref_1');
  });

  it('turning a still-valid completed step invalid is rejected as before', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('valid-to-invalid'));
    const session = await createTestSession(accessToken, 'general_rn');
    const done = (await (await completeEmploymentApplication(accessToken, session, VALID_EMPLOYMENT_APPLICATION)).json()) as TestSession;

    const res = await patch(accessToken, done.sessionId, done.revision, {
      formData: { ...done.formData, employmentApplication: { ...VALID_EMPLOYMENT_APPLICATION, shiftPreference: [] } },
      stepStates: done.stepStates,
    });
    expect(res.status).toBe(422);
  });
});

describe('submitted application snapshot - final answers only', () => {
  it('replaces hidden CNA unit selections with the canonical CNA value, drops stale Other text, keeps arrays, and keeps legacy reference data readable', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('snapshot-final'));
    const completed = await completePacketExceptReview(accessToken, 'icu_rn');

    // RN → picked units → switched to CNA (units still in the session);
    // typed Other text → then picked a listed specialty.
    const res = await patch(accessToken, completed.sessionId, completed.revision, {
      formData: {
        ...completed.formData,
        employmentApplication: {
          ...VALID_EMPLOYMENT_APPLICATION,
          positionApplied: 'CNA', specialtyPreference: ['icu', 'er'],
          shiftPreference: ['am', 'pm'],
          primarySpecialty: 'icu', primarySpecialtyOther: 'Stale text',
        },
        employmentReferences: {
          ...(completed.formData.employmentReferences as Record<string, unknown>),
          employment_ref_1: { ...VALID_REFERENCE, reasonForLeaving: 'Relocation' },
        },
      },
      stepStates: completed.stepStates,
    });
    expect(res.status).toBe(200);
    const session = (await res.json()) as TestSession;
    expect((session.formData.employmentApplication as { specialtyPreference: string[] }).specialtyPreference).toEqual(['icu', 'er']); // in-progress state preserved

    const submitRes = await submit(accessToken, session.sessionId, session.revision);
    expect(submitRes.status).toBe(201);
    const { applicationId } = (await submitRes.json()) as { applicationId: string };

    const row = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const payload = JSON.parse(row!.payload_json) as {
      employmentApplication: Record<string, unknown>;
      employmentReferences: Record<string, Record<string, unknown>>;
    };
    expect(payload.employmentApplication.positionApplied).toBe('CNA');
    expect(payload.employmentApplication.specialtyPreference).toEqual(['cna']); // canonical CNA value, never []
    expect(payload.employmentApplication.shiftPreference).toEqual(['am', 'pm']);
    expect(payload.employmentApplication.primarySpecialty).toBe('icu');
    expect(payload.employmentApplication.primarySpecialtyOther).toBe('');
    expect(payload.employmentApplication.licenseExpiration).toBe('2028-01-01');
    expect(payload.employmentReferences.employment_ref_1.supervisorTitle).toBe('Nurse Manager');
    expect(payload.employmentReferences.employment_ref_1.reasonForLeaving).toBe('Relocation');
  });
});
