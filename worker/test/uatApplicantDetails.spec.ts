import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import {
  completePacketExceptReview,
  patch,
  submit,
  VALID_EMPLOYMENT_APPLICATION,
  VALID_PERSONAL_INFO,
  type TestSession,
} from './submissionFixtures';

// UAT follow-up through the real routes: DOB / 18+ gate, position taxonomy
// (incl. Tech), position-specific specialties, multi-select employment type.
// Professional experience is NOT evaluated automatically — recruiters verify
// it from the uploaded resume.

async function createSession(accessToken: string): Promise<TestSession> {
  return (await SELF.fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ packetId: 'general_rn' }),
  })).json();
}

async function setApplication(accessToken: string, s: TestSession, overrides: Record<string, unknown>): Promise<TestSession> {
  const res = await patch(accessToken, s.sessionId, s.revision, {
    formData: { ...s.formData, employmentApplication: { ...VALID_EMPLOYMENT_APPLICATION, ...overrides } },
    stepStates: s.stepStates,
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function payloadOf(applicationId: string): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const row = await env.DB.prepare('SELECT payload_json FROM applications WHERE application_id = ?').bind(applicationId).first<{ payload_json: string }>();
  return JSON.parse(row!.payload_json);
}

describe('Date of birth / age gate', () => {
  async function completePersonalInfo(dateOfBirth: string) {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('dob'));
    const created = await createSession(accessToken);
    return patch(accessToken, created.sessionId, created.revision, {
      formData: { personalInfo: { ...VALID_PERSONAL_INFO, dateOfBirth } },
      stepStates: { personal_info: 'completed' },
    });
  }

  it('an applicant under 18 cannot complete Personal Information', async () => {
    expect((await completePersonalInfo(`${new Date().getUTCFullYear() - 17}-01-01`)).status).toBe(422);
  });

  it('an adult passes; a missing or impossible DOB does not', async () => {
    expect((await completePersonalInfo('1990-05-05')).status).toBe(200);
    expect((await completePersonalInfo('')).status).toBe(422);
    expect((await completePersonalInfo('1990-02-30')).status).toBe(422);
  });

  it('an underage applicant can never submit, even with the step forced to completed', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('dob-submit'));
    const s = await completePacketExceptReview(accessToken, 'icu_rn');
    const row = await env.DB.prepare('SELECT form_data_json FROM onboarding_sessions WHERE session_id = ?').bind(s.sessionId).first<{ form_data_json: string }>();
    const fd = JSON.parse(row!.form_data_json);
    fd.personalInfo.dateOfBirth = `${new Date().getUTCFullYear() - 16}-06-01`;
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?').bind(JSON.stringify(fd), s.sessionId).run();
    const latest = (await (await SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } })).json()) as TestSession;
    const res = await submit(accessToken, latest.sessionId, latest.revision);
    expect(res.status).toBe(422);
    expect(((await res.json()) as { incompleteSteps: { id: string }[] }).incompleteSteps.map((x) => x.id)).toContain('personal_info');
  });
});

describe('Applicant Details — UAT taxonomy through the real routes', () => {
  it.each([
    ['one employment type', { employmentType: ['travel_assignment'] }, 200],
    ['both employment types', { employmentType: ['per_diem_assignment', 'travel_assignment'] }, 200],
    ['no employment type', { employmentType: [] }, 422],
    ['CNA (no specialty asked)', { positionApplied: 'CNA', licenseType: 'CNA', specialtyPreference: [] }, 200],
    ['Tech with a Tech specialty', { positionApplied: 'Tech', licenseType: 'Tech', specialtyPreference: ['rrt', 'emt'] }, 200],
    ['Tech with only RN units (drafts are not active)', { positionApplied: 'Tech', licenseType: 'Tech', specialtyPreference: ['icu'] }, 422],
    ['LVN with an RN-only unit', { positionApplied: 'LVN', licenseType: 'LVN', specialtyPreference: ['icu'] }, 422],
    ['NP with an NP unit', { positionApplied: 'NP', licenseType: 'NP', specialtyPreference: ['psychiatric'] }, 200],
    ['legacy "other" license type', { licenseType: 'other' }, 422],
  ])('%s', async (_label, overrides, status) => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('taxonomy'));
    const created = await createSession(accessToken);
    const res = await patch(accessToken, created.sessionId, created.revision, {
      formData: { employmentApplication: { ...VALID_EMPLOYMENT_APPLICATION, ...overrides } },
      stepStates: { employment_application: 'completed' },
    });
    expect(res.status).toBe(status);
  });

  it('switching RN → Tech submits only Tech specialties; the RN drafts stay in the session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('rn-to-tech'));
    let s = await completePacketExceptReview(accessToken, 'icu_rn');
    s = await setApplication(accessToken, s, { positionApplied: 'Tech', licenseType: 'Tech', specialtyPreference: ['icu', 'er', 'cst'] });
    expect((s.formData.employmentApplication as { specialtyPreference: string[] }).specialtyPreference).toEqual(['icu', 'er', 'cst']);
    const res = await submit(accessToken, s.sessionId, s.revision);
    expect(res.status).toBe(201);
    const { applicationId } = (await res.json()) as { applicationId: string };
    expect((await payloadOf(applicationId)).employmentApplication.specialtyPreference).toEqual(['cst']);
  });

  it('a CNA submits with the canonical CNA specialty, regardless of experience', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('cna-submit'));
    let s = await completePacketExceptReview(accessToken, 'icu_rn');
    s = await setApplication(accessToken, s, { positionApplied: 'CNA', licenseType: 'CNA', specialtyPreference: [] });
    const res = await submit(accessToken, s.sessionId, s.revision);
    expect(res.status).toBe(201);
    const payload = await payloadOf(((await res.json()) as { applicationId: string }).applicationId);
    expect(payload.employmentApplication.specialtyPreference).toEqual(['cna']);
    expect(payload).not.toHaveProperty('eligibility');
    expect(payload).not.toHaveProperty('resumeExtraction');
  });

  it('a session saved with the single-value employment type stays valid and submits as a list', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('legacy-emptype'));
    let s = await completePacketExceptReview(accessToken, 'icu_rn');
    s = await setApplication(accessToken, s, { employmentType: 'per_diem_assignment' });
    const res = await submit(accessToken, s.sessionId, s.revision);
    expect(res.status).toBe(201);
    expect((await payloadOf(((await res.json()) as { applicationId: string }).applicationId)).employmentApplication.employmentType).toEqual(['per_diem_assignment']);
  });

  it('the admin API returns the applicant-entered DOB', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('admin-dob'));
    const s = await completePacketExceptReview(accessToken, 'icu_rn');
    const { applicationId } = (await (await submit(accessToken, s.sessionId, s.revision)).json()) as { applicationId: string };
    const cookie = await loginAsAdmin();
    const detail = (await (await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } })).json()) as { payload: { personalInfo: { dateOfBirth: string } } };
    expect(detail.payload.personalInfo.dateOfBirth).toBe('1990-01-01');
  });
});
