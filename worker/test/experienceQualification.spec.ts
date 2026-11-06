import { describe, it, expect } from 'vitest';
import { uniqueEmail, registerVerifyAndLoginApplicant } from './helpers';
import {
  VALID_EMPLOYMENT_APPLICATION, completePacketExceptReview, createTestSession, patch, submit, type TestSession,
} from './submissionFixtures';
import { env } from 'cloudflare:test';

// Total Years of Professional Experience and Primary Clinical Specialty are
// enforced by the Worker itself, however a client behaves.

const application = (override: Record<string, unknown>) => ({ ...VALID_EMPLOYMENT_APPLICATION, ...override });

async function completeApplicationStep(accessToken: string, session: TestSession, employmentApplication: Record<string, unknown>) {
  return patch(accessToken, session.sessionId, session.revision, {
    formData: { ...session.formData, employmentApplication },
    stepStates: { ...session.stepStates, employment_application: 'completed' },
  });
}

async function newSession(label: string) {
  const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
  return { accessToken, session: await createTestSession(accessToken, 'general_rn') };
}

describe('Worker enforcement — the Applicant Details step', () => {
  it.each([
    ['CNA', '0.9', ['cna'], 422],
    ['CNA', '1', ['cna'], 200],
    ['RN', '1.9', ['icu'], 422],
    ['RN', '2', ['icu'], 200],
    ['Tech', '0', ['ct_tech'], 200],
    ['LVN', '0', ['er'], 200],
    ['NP', '0', ['icu'], 200],
  ])('%s with %s years completes with status %i', async (position, years, clinical, status) => {
    const { accessToken, session } = await newSession(`exp-${position}-${years}`.toLowerCase());
    const res = await completeApplicationStep(accessToken, session, application({
      positionApplied: position,
      licenseType: position,
      specialtyPreference: position === 'CNA' ? ['cna'] : clinical,
      primaryClinicalSpecialty: clinical,
      totalYearsExperience: years,
    }));
    expect(res.status).toBe(status);
  });

  it('a missing or non-numeric value cannot complete the step', async () => {
    const { accessToken, session } = await newSession('exp-invalid');
    expect((await completeApplicationStep(accessToken, session, application({ totalYearsExperience: '' }))).status).toBe(422);
    expect((await completeApplicationStep(accessToken, session, application({ totalYearsExperience: 'five' }))).status).toBe(422);
  });

  it.each(['Tech', 'LVN', 'NP'])('a %s new graduate (0 years) can complete the step with no clinical specialty', async (position) => {
    const { accessToken, session } = await newSession(`clinical-newgrad-${position}`.toLowerCase());
    const specialty = position === 'Tech' ? ['ct_tech'] : position === 'LVN' ? ['er'] : ['icu'];
    const res = await completeApplicationStep(accessToken, session, application({
      positionApplied: position, licenseType: position, specialtyPreference: specialty, primaryClinicalSpecialty: [], totalYearsExperience: '0',
    }));
    expect(res.status).toBe(200);
  });

  it('Primary Clinical Specialty is required with any experience, and must belong to the position', async () => {
    const { accessToken, session } = await newSession('clinical-required');
    expect((await completeApplicationStep(accessToken, session, application({ primaryClinicalSpecialty: [] }))).status).toBe(422);
    expect((await completeApplicationStep(accessToken, session, application({ positionApplied: 'Tech', licenseType: 'Tech', specialtyPreference: ['ct_tech'], primaryClinicalSpecialty: [], totalYearsExperience: '0.5' }))).status).toBe(422);
    expect((await completeApplicationStep(accessToken, session, application({ primaryClinicalSpecialty: ['ct_tech'] }))).status).toBe(422);
  });
});

describe('Worker enforcement — final submission cannot be bypassed', () => {
  it('rejects a qualification value written after the step was completed', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('exp-bypass'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');

    // Saved without re-sending the step status, as a modified client could.
    const res = await patch(accessToken, complete.sessionId, complete.revision, {
      formData: { ...complete.formData, employmentApplication: application({ totalYearsExperience: '1.9' }) },
    });
    expect(res.status).toBe(200);
    const tampered = (await res.json()) as TestSession;

    const submitted = await submit(accessToken, tampered.sessionId, tampered.revision);
    expect(submitted.status).toBe(422);
    const body = (await submitted.json()) as { incompleteSteps: { id: string }[] };
    expect(body.incompleteSteps.map((s) => s.id)).toContain('employment_application');
  });

  it('re-evaluates the minimum when the position changes', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('exp-position'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');

    // 1.5 years is fine for a CNA; switching that same value to RN is not.
    const asCna = await patch(accessToken, complete.sessionId, complete.revision, {
      formData: { ...complete.formData, employmentApplication: application({ positionApplied: 'CNA', licenseType: 'CNA', totalYearsExperience: '1.5' }) },
    });
    const cna = (await asCna.json()) as TestSession;
    const asRn = await patch(accessToken, cna.sessionId, cna.revision, {
      formData: { ...cna.formData, employmentApplication: application({ positionApplied: 'RN', totalYearsExperience: '1.5' }) },
      stepStates: { ...cna.stepStates, employment_application: 'completed' },
    });
    expect(asRn.status).toBe(422);
  });

  it('an in-progress session completed before these fields existed must answer them before submitting', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('exp-legacy-session'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(complete.sessionId).first<{ form_data_json: string }>();
    const stored = JSON.parse(row!.form_data_json) as { employmentApplication: Record<string, unknown> };
    delete stored.employmentApplication.totalYearsExperience;
    delete stored.employmentApplication.primaryClinicalSpecialty;
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?').bind(JSON.stringify(stored), complete.sessionId).run();

    const blocked = await submit(accessToken, complete.sessionId, complete.revision);
    expect(blocked.status).toBe(422);

    // Unrelated saves are not blocked by the older completion in the meantime.
    const saved = await patch(accessToken, complete.sessionId, complete.revision, { stepStates: complete.stepStates });
    expect(saved.status).toBe(200);
    const fixedRes = await patch(accessToken, complete.sessionId, ((await saved.json()) as TestSession).revision, {
      formData: { ...stored, employmentApplication: { ...stored.employmentApplication, totalYearsExperience: '4', primaryClinicalSpecialty: ['icu'] } },
    });
    const fixed = (await fixedRes.json()) as TestSession;
    expect((await submit(accessToken, fixed.sessionId, fixed.revision)).status).toBe(201);
  });
});

describe('Submitted application', () => {
  it('records the structured values, and only the selections valid for the final position', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('exp-payload'));
    const complete = await completePacketExceptReview(accessToken, 'icu_rn');
    const res = await patch(accessToken, complete.sessionId, complete.revision, {
      formData: {
        ...complete.formData,
        employmentApplication: application({
          totalYearsExperience: '2.5',
          primaryClinicalSpecialty: ['icu', 'er', 'ct_tech'], // ct_tech left over from another position
          specialtyPreference: ['med_surg'],
        }),
      },
    });
    const updated = (await res.json()) as TestSession;
    const submitted = await submit(accessToken, updated.sessionId, updated.revision);
    expect(submitted.status).toBe(201);
    const { applicationId } = (await submitted.json()) as { applicationId: string };

    const app = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
    const { employmentApplication: ea } = JSON.parse(app!.payload_json) as { employmentApplication: Record<string, unknown> };
    expect(ea.totalYearsExperience).toBe('2.5');
    expect(ea.primaryClinicalSpecialty).toEqual(['icu', 'er']); // valid for RN, in display order
    expect(ea.specialtyPreference).toEqual(['med_surg']); // a separate answer
  });
});
