import { env, SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant } from './helpers';
import { VALID_EMPLOYMENT_APPLICATION, completePacketExceptReview, createTestSession, patch, submit } from './submissionFixtures';
import { isoDateInTimeZone } from '@pcs/shared';
import { pastStartDateError } from '../src/routes/sessions';

// Available Start Date can't be entered or changed to a date before the
// applicant's local today. The client names its IANA time zone
// (X-Client-Time-Zone); the Worker computes today in that zone from its own
// clock. A stored date that has since passed is never re-rejected.

const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const withStart = (availableStartDate: string) => ({ employmentApplication: { ...VALID_EMPLOYMENT_APPLICATION, availableStartDate } });
const PAST = 'Available start date can’t be in the past.';
const LA = 'America/Los_Angeles';
const NY = 'America/New_York';

describe('pastStartDateError: local-today boundaries', () => {
  it('today in Pacific time is valid, yesterday is not, tomorrow is', () => {
    const noonPacific = new Date('2026-11-19T20:00:00Z'); // 12:00 PST
    expect(pastStartDateError(withStart('2026-11-19'), {}, noonPacific, LA)).toBeNull();
    expect(pastStartDateError(withStart('2026-11-18'), {}, noonPacific, LA)).toBe(PAST);
    expect(pastStartDateError(withStart('2026-11-20'), {}, noonPacific, LA)).toBeNull();
  });

  it('today in Eastern time is valid, yesterday is not, tomorrow is', () => {
    const noonEastern = new Date('2026-11-19T17:00:00Z'); // 12:00 EST
    expect(pastStartDateError(withStart('2026-11-19'), {}, noonEastern, NY)).toBeNull();
    expect(pastStartDateError(withStart('2026-11-18'), {}, noonEastern, NY)).toBe(PAST);
    expect(pastStartDateError(withStart('2026-11-20'), {}, noonEastern, NY)).toBeNull();
  });

  it('late evening Pacific, when UTC is already the next date: the Pacific date is still today', () => {
    const latePacific = new Date('2026-11-20T07:30:00Z'); // 23:30 PST on the 19th; UTC is the 20th
    expect(pastStartDateError(withStart('2026-11-19'), {}, latePacific, LA)).toBeNull();
    expect(pastStartDateError(withStart('2026-11-18'), {}, latePacific, LA)).toBe(PAST);
    // At that same instant it is already the 20th in New York: the 19th is yesterday there.
    expect(pastStartDateError(withStart('2026-11-19'), {}, latePacific, NY)).toBe(PAST);
  });

  it('just after midnight Eastern: the new day is today and the previous day is rejected', () => {
    const justAfterMidnightEastern = new Date('2026-11-20T05:05:00Z'); // 00:05 EST on the 20th
    expect(pastStartDateError(withStart('2026-11-20'), {}, justAfterMidnightEastern, NY)).toBeNull();
    expect(pastStartDateError(withStart('2026-11-19'), {}, justAfterMidnightEastern, NY)).toBe(PAST);
    // Still the 19th in Los Angeles (21:05 PST).
    expect(pastStartDateError(withStart('2026-11-19'), {}, justAfterMidnightEastern, LA)).toBeNull();
  });

  it('an unchanged saved date that is now past stays allowed; changing it to another past date is rejected', () => {
    const now = new Date('2026-11-19T20:00:00Z');
    expect(pastStartDateError(withStart('2026-06-01'), withStart('2026-06-01'), now, LA)).toBeNull();
    expect(pastStartDateError(withStart('2026-06-02'), withStart('2026-06-01'), now, LA)).toBe(PAST);
    expect(pastStartDateError(withStart('2026-11-18'), withStart('2026-06-01'), now, LA)).toBe(PAST);
    expect(pastStartDateError(withStart('2026-11-19'), withStart('2026-06-01'), now, LA)).toBeNull();
    expect(pastStartDateError(withStart(''), withStart('2026-06-01'), now, LA)).toBeNull();
  });

  it('no zone, or an invalid one, means Paramount Care\'s own Pacific day, never a blanket "yesterday"', () => {
    const justAfterMidnightEastern = new Date('2026-11-20T05:05:00Z');
    for (const zone of [undefined, null, '', 'Not/AZone', '../../etc', 'x'.repeat(100)]) {
      expect(pastStartDateError(withStart('2026-11-19'), {}, justAfterMidnightEastern, zone)).toBeNull();
      expect(pastStartDateError(withStart('2026-11-18'), {}, justAfterMidnightEastern, zone)).toBe(PAST);
    }
  });

  it('ignores partial text and other steps', () => {
    const now = new Date('2026-11-19T20:00:00Z');
    expect(pastStartDateError(withStart('11/18/20'), {}, now, LA)).toBeNull();
    expect(pastStartDateError({ personalInfo: {} }, {}, now, LA)).toBeNull();
    expect(pastStartDateError(undefined, {}, now, LA)).toBeNull();
  });
});

describe('PATCH /api/sessions/:id: Available Start Date', () => {
  async function session(label: string) {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail(label));
    return { accessToken, session: await createTestSession(accessToken, 'icu_rn') };
  }

  it('a past date is refused on a draft save and on completion, naming the field', async () => {
    const { accessToken, session: s } = await session('start-past');
    for (const stepStates of [undefined, { employment_application: 'completed' }]) {
      const res = await patch(accessToken, s.sessionId, s.revision, { formData: withStart(iso(-3)), ...(stepStates ? { stepStates } : {}) });
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ issues: [{ field: 'availableStartDate', message: 'Available start date can’t be in the past.' }] });
    }
  });

  it('today and future dates are accepted', async () => {
    const { accessToken, session: s } = await session('start-ok');
    let revision = s.revision;
    for (const date of [iso(0), iso(1), iso(400)]) {
      const res = await patch(accessToken, s.sessionId, revision, { formData: withStart(date) });
      expect(res.status).toBe(200);
      revision = ((await res.json()) as { revision: number }).revision;
    }
  });

  it("uses the applicant's own zone from the request: today there is accepted, yesterday there is refused", async () => {
    const { accessToken, session: s } = await session('start-zone');
    const send = (zone: string, date: string, revision: number) => SELF.fetch(`${BASE}/api/sessions/${s.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, 'X-Client-Time-Zone': zone },
      body: JSON.stringify({ revision, formData: withStart(date) }),
    });
    let revision = s.revision;
    for (const zone of [NY, LA]) {
      const today = isoDateInTimeZone(new Date(), zone)!;
      const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
      const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
      expect((await send(zone, yesterday, revision)).status).toBe(422);
      const ok = await send(zone, today, revision);
      expect(ok.status).toBe(200);
      revision = ((await ok.json()) as { revision: number }).revision;
      const later = await send(zone, tomorrow, revision);
      expect(later.status).toBe(200);
      revision = ((await later.json()) as { revision: number }).revision;
    }
  });

  it('a stored start date that has since passed stays readable, saves unchanged and never blocks submission', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('start-stale'));
    const s = await completePacketExceptReview(accessToken, 'icu_rn');
    // Simulate time passing: the saved date is now in the past.
    const formData = { ...s.formData, ...withStart('2025-06-01') };
    await env.DB.prepare('UPDATE onboarding_sessions SET form_data_json = ? WHERE session_id = ?').bind(JSON.stringify(formData), s.sessionId).run();

    const saved = await patch(accessToken, s.sessionId, s.revision, { formData, stepStates: s.stepStates });
    expect(saved.status).toBe(200);
    const after = (await saved.json()) as { revision: number; formData: { employmentApplication: { availableStartDate: string } } };
    expect(after.formData.employmentApplication.availableStartDate).toBe('2025-06-01');

    const submitted = await submit(accessToken, s.sessionId, after.revision);
    expect(submitted.status).toBe(201);
  });
});
