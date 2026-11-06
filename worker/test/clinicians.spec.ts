import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { hashPassword } from '../src/services/auth';
import { onboardingQueue, type ClinicianListItem, type ClinicianPage, type OnboardingSummary } from '../src/services/clinicians';
import { LEGACY_MANUAL_EMPLOYMENT_APPLICATION, submittedSession } from './submissionFixtures';
import {
  completeFormData, employmentApplication, seedApplication, seedInviteRow, seedSession, seedUser, withAllVaccinesProvidingProof, withoutDocuments,
} from './clinicianFixtures';

// The Admin clinician list: every clinician from invitation through submitted
// application, combined from the existing lifecycle records, with calculated
// queues, completion, required documents, filters, sorting and pagination.

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function list(cookie: string, params: Record<string, string> = {}): Promise<ClinicianPage> {
  const res = await SELF.fetch(`${BASE}/api/admin/clinicians?${new URLSearchParams(params)}`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return (await res.json()) as ClinicianPage;
}

const emails = (page: ClinicianPage) => page.data.map((c) => c.email).sort();
const byEmail = (page: ClinicianPage, email: string) => page.data.find((c) => c.email === email);

describe('onboarding queue rule', () => {
  const started = { submitted: false, started: true };

  it('79% complete stays In Progress', () => {
    expect(onboardingQueue({ ...started, completionPercent: 79, documentsRemaining: 0 })).toBe('in_progress');
  });
  it('80% or more with more than 5 documents remaining stays In Progress', () => {
    expect(onboardingQueue({ ...started, completionPercent: 95, documentsRemaining: 6 })).toBe('in_progress');
  });
  it('80% or more AND 5 or fewer documents remaining is Almost Done', () => {
    expect(onboardingQueue({ ...started, completionPercent: 80, documentsRemaining: 5 })).toBe('almost_done');
    expect(onboardingQueue({ ...started, completionPercent: 100, documentsRemaining: 0 })).toBe('almost_done');
  });
  it('unknown progress is In Progress, never Almost Done', () => {
    expect(onboardingQueue({ ...started, completionPercent: null, documentsRemaining: null })).toBe('in_progress');
    expect(onboardingQueue({ ...started, completionPercent: 90, documentsRemaining: null })).toBe('in_progress');
  });
  it('submitted is Application Completed whatever the numbers say (precedence)', () => {
    expect(onboardingQueue({ submitted: true, started: true, completionPercent: 50, documentsRemaining: 4 })).toBe('application_completed');
    expect(onboardingQueue({ submitted: true, started: false, completionPercent: null, documentsRemaining: null })).toBe('application_completed');
  });
  it('not started is Invited', () => {
    expect(onboardingQueue({ submitted: false, started: false, completionPercent: null, documentsRemaining: null })).toBe('invited');
  });
});

describe('GET /api/admin/clinicians', () => {
  let cookie: string;
  const complete = completeFormData('general_rn');

  beforeAll(async () => {
    cookie = await loginAsAdmin();

    // Almost Done: everything but the resume and CPR card.
    await seedSession({
      email: 'jane.smith@example.com', firstName: 'Jane', lastName: 'Smith',
      formData: { ...withoutDocuments(complete, ['resume', 'cpr']), employmentApplication: employmentApplication('RN', ['icu']) },
      createdAt: '2026-10-01 09:00:00', updatedAt: '2026-11-01 10:00:00',
    });
    await seedInviteRow({ email: 'jane.smith@example.com', usedAt: '2026-10-01T08:00:00.000Z', createdAt: '2026-09-30T08:00:00.000Z' });

    // >= 80% complete but 7 documents owed: stays In Progress.
    await seedSession({
      email: 'janet.smithers@example.com', firstName: 'Janet', lastName: 'Smithers',
      formData: { ...withAllVaccinesProvidingProof(withoutDocuments(complete, ['resume', 'identity', 'cpr', 'directDeposit'])), employmentApplication: employmentApplication('RN', ['icu']) },
    });

    // Barely started.
    await seedSession({
      email: 'ana.lopez@example.com', firstName: 'Ana', lastName: 'Lopez',
      formData: { employmentApplication: employmentApplication('LVN', ['tele_dou']) },
      createdAt: '2026-09-15 08:00:00', updatedAt: '2026-09-20 08:00:00',
    });

    // Preference and primary specialty differ.
    await seedSession({
      email: 'nina.prac@example.com', firstName: 'Nina', lastName: 'Prac',
      formData: { employmentApplication: employmentApplication('NP', ['er'], ['icu']) },
    });

    // Everything done but not yet submitted.
    await seedSession({
      email: 'tess.tech@example.com', firstName: 'Tess', lastName: 'Tech',
      formData: { ...complete, employmentApplication: employmentApplication('Tech', ['cst']) },
    });

    // Submitted through the session flow.
    const bobApp = await seedApplication({ firstName: 'Bob', lastName: 'Brown', email: 'bob.brown@example.com', submittedAt: '2026-10-20T15:00:00.000Z' });
    await seedSession({
      email: 'bob.brown@example.com', firstName: 'Bob', lastName: 'Brown', status: 'submitted', applicationId: bobApp,
      formData: { ...complete, employmentApplication: employmentApplication('CNA', ['cna']) },
    });

    // Historical web submission: no account, no session.
    await seedApplication({
      firstName: 'Old', lastName: 'Timer', email: 'old.timer@example.com', submittedAt: '2025-06-01T12:00:00.000Z',
      payload: { employmentApplication: { ...LEGACY_MANUAL_EMPLOYMENT_APPLICATION, specialtyPreference: 'ER', primarySpecialty: 'pacu' } },
    });

    // Registered, not started.
    await seedUser('reggie@example.com');
    await seedInviteRow({ email: 'reggie@example.com', usedAt: '2026-10-05T08:00:00.000Z', createdAt: '2026-10-04T08:00:00.000Z' });

    // Invited only.
    await seedInviteRow({ email: 'pending.invitee@example.com', createdAt: '2026-10-10T08:00:00.000Z' });
    await seedInviteRow({ email: 'expired.invitee@example.com', createdAt: '2026-08-01T08:00:00.000Z', expiresAt: '2026-08-08T08:00:00.000Z' });
    await seedInviteRow({ email: 'revoked.invitee@example.com', revokedAt: '2026-10-11T08:00:00.000Z', createdAt: '2026-10-09T08:00:00.000Z' });
  });

  describe('combining the lifecycle records', () => {
    it('lists every clinician once, each in its queue, with counts', async () => {
      const page = await list(cookie);
      expect(page.pagination).toEqual({ page: 1, pageSize: 20, total: 10, totalPages: 1 });
      expect(page.queueCounts).toEqual({ all: 10, new_applicant: 0, invited: 3, in_progress: 3, almost_done: 2, application_completed: 2, cleared: 0, on_hold: 0 });
      expect(new Set(page.data.map((c) => c.clinicianId)).size).toBe(10);
      expect(emails(page)).not.toContain('revoked.invitee@example.com');
    });

    it('an in-progress clinician carries the shared completion, documents, dates and invitation', async () => {
      const jane = byEmail(await list(cookie), 'jane.smith@example.com')!;
      expect(jane).toMatchObject({
        firstName: 'Jane', lastName: 'Smith', position: 'RN', specialtyPreference: ['icu'], primaryClinicalSpecialty: ['icu'],
        queue: 'almost_done', requiredDocuments: { total: 4, completed: 2, remaining: 2 },
        startedAt: '2026-10-01T09:00:00.000Z', lastActiveAt: '2026-11-01T10:00:00.000Z', completedAt: null,
        applicationId: null, documentCount: null, invitation: { status: 'used', sentAt: '2026-09-30T08:00:00.000Z' },
      });
      expect(jane.sessionId).toBeTruthy();
      expect(jane.completionPercent).toBeGreaterThanOrEqual(80);
      expect(jane.completionPercent).toBeLessThan(100);
    });

    it('80% or more complete with more than 5 documents owed stays In Progress', async () => {
      const janet = byEmail(await list(cookie), 'janet.smithers@example.com')!;
      expect(janet.completionPercent).toBeGreaterThanOrEqual(80);
      expect(janet.requiredDocuments).toEqual({ total: 7, completed: 0, remaining: 7 });
      expect(janet.queue).toBe('in_progress');
    });

    it('everything done but not submitted is Almost Done at 100%', async () => {
      const tess = byEmail(await list(cookie), 'tess.tech@example.com')!;
      expect(tess).toMatchObject({ queue: 'almost_done', completionPercent: 100, requiredDocuments: { remaining: 0 }, position: 'Tech', specialtyPreference: ['cst'] });
    });

    it('a submitted session is Application Completed, with its application', async () => {
      const bob = byEmail(await list(cookie), 'bob.brown@example.com')!;
      expect(bob).toMatchObject({ queue: 'application_completed', position: 'CNA', specialtyPreference: ['cna'], completedAt: '2026-10-20T15:00:00.000Z', documentCount: 0 });
      expect(bob.applicationId).toMatch(/^PCS-T-/);
      expect(bob.completionPercent).toBe(100);
    });

    it('a historical web application appears with safe defaults', async () => {
      const old = byEmail(await list(cookie), 'old.timer@example.com')!;
      expect(old).toMatchObject({
        clinicianId: `application:${old.applicationId}`, queue: 'application_completed', position: 'RN',
        specialtyPreference: ['er'], primaryClinicalSpecialty: ['pacu'],
        completionPercent: null, requiredDocuments: null, startedAt: null, lastActiveAt: null, sessionId: null,
        completedAt: '2025-06-01T12:00:00.000Z', invitation: null,
      });
    });

    it('registered and invite-only clinicians are Invited, with only what exists', async () => {
      const page = await list(cookie);
      expect(byEmail(page, 'reggie@example.com')).toMatchObject({
        queue: 'invited', firstName: null, lastName: null, position: null, completionPercent: null, requiredDocuments: null,
        startedAt: null, lastActiveAt: null, invitation: { status: 'used' },
      });
      expect(byEmail(page, 'pending.invitee@example.com')).toMatchObject({ queue: 'invited', invitation: { status: 'pending', sentAt: '2026-10-10T08:00:00.000Z' } });
      expect(byEmail(page, 'expired.invitee@example.com')).toMatchObject({ queue: 'invited', invitation: { status: 'expired' } });
    });

    it('returns every date as ISO, and never a storage key or form answers', async () => {
      const page = await list(cookie);
      for (const c of page.data) {
        for (const value of [c.startedAt, c.lastActiveAt, c.completedAt, c.invitation?.sentAt, c.invitation?.expiresAt]) {
          if (value !== null && value !== undefined) expect(value).toMatch(ISO);
        }
      }
      const body = JSON.stringify(page);
      for (const s of ['uploads/', 'objectKey', '1234567890', '123-45-6789', 'formData']) expect(body).not.toContain(s);
    });
  });

  describe('search', () => {
    const search = async (term: string) => emails(await list(cookie, { search: term }));

    it('finds by first name, last name and partial words', async () => {
      expect(await search('Ana')).toEqual(['ana.lopez@example.com']);
      expect(await search('lopez')).toEqual(['ana.lopez@example.com']);
      expect(await search('lop')).toEqual(['ana.lopez@example.com']);
      expect(await search('Smithers')).toEqual(['janet.smithers@example.com']);
    });

    it('finds "First Last", "Last First" and "Last, First"', async () => {
      for (const term of ['Ana Lopez', 'Lopez Ana', 'Lopez, Ana', 'lopez,ana']) expect(await search(term)).toEqual(['ana.lopez@example.com']);
      for (const term of ['Janet Smithers', 'Smithers Janet', 'Smithers, Janet']) expect(await search(term)).toEqual(['janet.smithers@example.com']);
    });

    it('a partial name can match more than one clinician', async () => {
      expect(await search('Jane Smith')).toEqual(['jane.smith@example.com', 'janet.smithers@example.com']);
    });

    it('finds by email, including an invite-only clinician', async () => {
      expect(await search('reggie@')).toEqual(['reggie@example.com']);
      expect(await search('pending.invitee')).toEqual(['pending.invitee@example.com']);
    });

    it('finds by application ID, but short words never match inside an ID', async () => {
      const old = byEmail(await list(cookie), 'old.timer@example.com')!;
      expect(await search(old.applicationId!)).toEqual(['old.timer@example.com']);
      expect(await search('PCS')).toEqual([]);
    });

    it('matches nobody for an unknown name', async () => {
      expect((await list(cookie, { search: 'Zelda' })).pagination.total).toBe(0);
    });
  });

  describe('sorting', () => {
    const NAMED_A_Z = [
      'bob.brown@example.com', 'ana.lopez@example.com', 'nina.prac@example.com', 'jane.smith@example.com',
      'janet.smithers@example.com', 'tess.tech@example.com', 'old.timer@example.com',
    ];
    const EMAIL_ONLY = ['expired.invitee@example.com', 'pending.invitee@example.com', 'reggie@example.com'];

    it('A-Z sorts by last name, then first, with email-only clinicians after, by email', async () => {
      const page = await list(cookie, { sort: 'name_asc' });
      expect(page.data.map((c) => c.email)).toEqual([...NAMED_A_Z, ...EMAIL_ONLY]);
    });

    it('Z-A reverses the names, still with email-only clinicians after', async () => {
      const page = await list(cookie, { sort: 'name_desc' });
      expect(page.data.map((c) => c.email)).toEqual([...[...NAMED_A_Z].reverse(), ...[...EMAIL_ONLY].reverse()]);
    });

    it('the default order is stable between requests', async () => {
      const first = (await list(cookie)).data.map((c) => c.clinicianId);
      const second = (await list(cookie)).data.map((c) => c.clinicianId);
      expect(second).toEqual(first);
      expect(first[0]).toBe((await list(cookie, { search: 'jane.smith' })).data[0].clinicianId); // most recently active
    });
  });

  describe('position and specialty filters', () => {
    it.each([
      ['CNA', ['bob.brown@example.com']],
      ['Tech', ['tess.tech@example.com']],
      ['LVN', ['ana.lopez@example.com']],
      ['RN', ['jane.smith@example.com', 'janet.smithers@example.com', 'old.timer@example.com']],
      ['NP', ['nina.prac@example.com']],
    ])('position %s', async (position, expected) => {
      expect(emails(await list(cookie, { position }))).toEqual(expected);
    });

    it('matches the Specialty / Unit Preference', async () => {
      expect(emails(await list(cookie, { specialty: 'er' }))).toEqual(['nina.prac@example.com', 'old.timer@example.com']);
    });

    it('matches the Primary Clinical Specialty, including a historical single answer', async () => {
      expect(emails(await list(cookie, { specialty: 'icu' }))).toEqual(['jane.smith@example.com', 'janet.smithers@example.com', 'nina.prac@example.com']);
      expect(emails(await list(cookie, { specialty: 'pacu' }))).toEqual(['old.timer@example.com']);
    });

    it('uses the shared Tele-DOU code, not separate Tele and DOU', async () => {
      expect(emails(await list(cookie, { specialty: 'tele_dou' }))).toEqual(['ana.lopez@example.com']);
      expect((await SELF.fetch(`${BASE}/api/admin/clinicians?specialty=tele`, { headers: { cookie } })).status).toBe(400);
    });

    it('rejects values outside the shared taxonomies', async () => {
      for (const qs of ['position=Doctor', 'specialty=cardiology', 'queue=archived', 'sort=age', 'startedFrom=2026-13-01', 'lastActiveTo=yesterday']) {
        expect((await SELF.fetch(`${BASE}/api/admin/clinicians?${qs}`, { headers: { cookie } })).status).toBe(400);
      }
    });
  });

  describe('queues', () => {
    it.each([
      ['invited', ['expired.invitee@example.com', 'pending.invitee@example.com', 'reggie@example.com']],
      ['in_progress', ['ana.lopez@example.com', 'janet.smithers@example.com', 'nina.prac@example.com']],
      ['almost_done', ['jane.smith@example.com', 'tess.tech@example.com']],
      ['application_completed', ['bob.brown@example.com', 'old.timer@example.com']],
    ])('%s', async (queue, expected) => {
      const page = await list(cookie, { queue });
      expect(emails(page)).toEqual(expected);
      expect(page.pagination.total).toBe(expected.length);
      // The counts describe every queue under the other filters.
      expect(page.queueCounts.all).toBe(10);
    });
  });

  describe('date filters', () => {
    it('Application Start Date range', async () => {
      expect(emails(await list(cookie, { startedFrom: '2026-09-01', startedTo: '2026-09-30' }))).toEqual(['ana.lopez@example.com']);
    });

    it('Last Active range, inclusive of both days', async () => {
      expect(emails(await list(cookie, { lastActiveFrom: '2026-11-01', lastActiveTo: '2026-11-01' }))).toEqual(['jane.smith@example.com']);
      expect(emails(await list(cookie, { lastActiveFrom: '2026-10-02', lastActiveTo: '2026-10-31' }))).not.toContain('jane.smith@example.com');
    });

    it('Completed range', async () => {
      expect(emails(await list(cookie, { completedFrom: '2026-10-01' }))).toEqual(['bob.brown@example.com']);
      expect(emails(await list(cookie, { completedTo: '2025-12-31' }))).toEqual(['old.timer@example.com']);
    });

    it('a clinician without that date is outside any range for it', async () => {
      const page = await list(cookie, { startedFrom: '2000-01-01' });
      expect(emails(page)).not.toContain('pending.invitee@example.com');
      expect(emails(page)).not.toContain('old.timer@example.com');
    });
  });

  describe('combined filters and pagination', () => {
    it('RN + ICU + Almost Done', async () => {
      expect(emails(await list(cookie, { position: 'RN', specialty: 'icu', queue: 'almost_done' }))).toEqual(['jane.smith@example.com']);
    });

    it('LVN + In Progress + Last Active from a date', async () => {
      expect(emails(await list(cookie, { position: 'LVN', queue: 'in_progress', lastActiveFrom: '2026-09-20' }))).toEqual(['ana.lopez@example.com']);
      expect(emails(await list(cookie, { position: 'LVN', queue: 'in_progress', lastActiveFrom: '2026-09-21' }))).toEqual([]);
    });

    it('queue counts reflect the other filters', async () => {
      const page = await list(cookie, { position: 'RN' });
      expect(page.queueCounts).toEqual({ all: 3, new_applicant: 0, invited: 0, in_progress: 1, almost_done: 1, application_completed: 1, cleared: 0, on_hold: 0 });
    });

    it('pages the complete sorted, filtered set', async () => {
      const all = (await list(cookie, { sort: 'name_asc' })).data.map((c) => c.clinicianId);
      const pages: string[] = [];
      for (let page = 1; page <= 4; page++) {
        const result = await list(cookie, { sort: 'name_asc', pageSize: '3', page: String(page) });
        expect(result.pagination).toEqual({ page, pageSize: 3, total: 10, totalPages: 4 });
        pages.push(...result.data.map((c) => c.clinicianId));
      }
      expect(pages).toEqual(all);
    });

    it('filters before paging, with the filtered total', async () => {
      const result = await list(cookie, { queue: 'in_progress', pageSize: '2', page: '2', sort: 'name_asc' });
      expect(result.pagination).toEqual({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
      expect(result.data.map((c) => c.email)).toEqual(['janet.smithers@example.com']);
    });
  });

  describe('GET /api/admin/sessions/:sessionId (onboarding summary)', () => {
    it('shows the clinician, step progress and required documents, without files or answers', async () => {
      const jane = byEmail(await list(cookie), 'jane.smith@example.com')!;
      const res = await SELF.fetch(`${BASE}/api/admin/sessions/${jane.sessionId}`, { headers: { cookie } });
      expect(res.status).toBe(200);
      const summary = (await res.json()) as OnboardingSummary;
      expect(summary.clinician).toEqual(jane);
      expect(summary.steps.find((s) => s.id === 'personal_info')).toMatchObject({ label: expect.any(String), required: true, percent: 100 });
      expect(summary.steps.some((s) => s.id === 'review')).toBe(false);
      expect(summary.requiredDocuments).toEqual(expect.arrayContaining([
        { key: 'i9_identity', stepId: 'documents', satisfied: true, attachmentCount: 1 },
        { key: 'cpr_cert', stepId: 'documents', satisfied: false, attachmentCount: 0 },
        { key: 'applicant_resume', stepId: 'resume', satisfied: false, attachmentCount: 0 },
      ]));
      const body = JSON.stringify(summary);
      for (const s of ['uploads/', 'objectKey', '1234567890', 'Test Bank']) expect(body).not.toContain(s);
    });

    it('is 404 for an unknown session', async () => {
      expect((await SELF.fetch(`${BASE}/api/admin/sessions/no-such-session`, { headers: { cookie } })).status).toBe(404);
    });
  });
});

describe('clinician list access', () => {
  async function loginAsSuperAdmin(): Promise<string> {
    const email = uniqueEmail('super-admin');
    await env.DB.prepare(`INSERT INTO admin_users (email, password_hash, role) VALUES (?, ?, 'super_admin')`).bind(email, await hashPassword('Super-Passw0rd!')).run();
    const res = await SELF.fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Super-Passw0rd!' }),
    });
    return (res.headers.get('set-cookie') ?? '').match(/admin_token=[^;]+/)![0];
  }

  it('admin and super_admin may list clinicians and read a summary', async () => {
    for (const cookie of [await loginAsAdmin(), await loginAsSuperAdmin()]) {
      expect((await SELF.fetch(`${BASE}/api/admin/clinicians`, { headers: { cookie } })).status).toBe(200);
      expect((await SELF.fetch(`${BASE}/api/admin/sessions/unknown`, { headers: { cookie } })).status).toBe(404);
    }
  });

  it('an applicant is refused (403) and an anonymous caller is unauthorized (401)', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('clinicians-applicant'));
    const { sessionId } = await seedSession({ email: uniqueEmail('someone') });
    for (const path of ['/api/admin/clinicians', `/api/admin/sessions/${sessionId}`]) {
      expect((await SELF.fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } })).status).toBe(403);
      expect((await SELF.fetch(`${BASE}${path}`)).status).toBe(401);
    }
  });
});

describe('clinician list with real onboarding records', () => {
  it('a session that cannot be evaluated is listed with unknown progress instead of failing the list', async () => {
    const cookie = await loginAsAdmin();
    await seedSession({ email: 'malformed@example.com', firstName: 'Mal', lastName: 'Formed', formData: { personalInfo: { firstName: 'Mal' } } });
    const mal = byEmail(await list(cookie), 'malformed@example.com')!;
    expect(mal).toMatchObject({ queue: 'in_progress', completionPercent: null, requiredDocuments: null });
  });

  it('a modern submission is Application Completed, and admin actions never move Last Active', async () => {
    const { accessToken, email } = await registerVerifyAndLoginApplicant(uniqueEmail('clinicians-modern'));
    const { applicationId, session } = await submittedSession(accessToken);
    // A distinct, older applicant timestamp, so any admin write to it would show.
    await env.DB.prepare(`UPDATE onboarding_sessions SET updated_at = '2026-01-02 03:04:05' WHERE session_id = ?`).bind(session.sessionId).run();
    const cookie = await loginAsAdmin();

    const before = byEmail(await list(cookie, { search: email }), email)!;
    expect(before).toMatchObject({ queue: 'application_completed', applicationId, completionPercent: 100, requiredDocuments: { remaining: 0 } });
    expect(before.documentCount).toBeGreaterThan(0);
    expect(before.lastActiveAt).toBe('2026-01-02T03:04:05.000Z');
    // The login email is the identity; the contact email entered on the form differs here.
    expect(before.contactEmail).toBe('jane.doe@example.com');
    expect(byEmail(await list(cookie, { search: 'jane.doe@example' }), email)).toBeDefined();
    expect(before.completedAt).toMatch(ISO);

    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'verified.pdf', { type: 'application/pdf' }));
    const upload = await SELF.fetch(`${BASE}/api/admin/application/${applicationId}/verified-license`, { method: 'POST', headers: { cookie }, body: form });
    expect(upload.status).toBe(201);
    await SELF.fetch(`${BASE}/api/admin/application/${applicationId}`, { headers: { cookie } }).then((r) => r.arrayBuffer());

    const after = byEmail(await list(cookie, { search: email }), email)! as ClinicianListItem;
    expect(after.lastActiveAt).toBe(before.lastActiveAt);
    expect(after.documentCount).toBe(before.documentCount! + 1);
  });
});
