import { fetchMock } from 'cloudflare:test';
import { describe, it, expect, afterEach } from 'vitest';
import { uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant } from './helpers';
import { submittedSession } from './submissionFixtures';
import { adminApi, auditActions, clinicianIdForEmail, loginAsSuperAdmin, type Detail } from './workflowFixtures';

// The applicant's clearance email: sent once per successful transition to
// cleared (normal or super_admin override), never on a failed clearance, a
// read, a verification change or a revoke; a delivery failure leaves the
// clearance in place and is audited and shown. Resend is mocked per email
// (fetchMock, its own file) only around the actions under test, and
// disableNetConnect means nothing else can reach the network meanwhile.

const VERIFICATIONS = ['background_check', 'reference_verification', 'i9_verification', 'w4_verification'] as const;

type Email = { to: string; subject: string; text: string };
let sent: Email[] = [];

/** The next email Resend receives answers `status`; each send needs its own. */
function nextEmail(status: number) {
  fetchMock
    .get('https://api.resend.com')
    .intercept({ path: '/emails', method: 'POST' })
    .reply(status, (opts) => {
      if (status === 200) sent.push(JSON.parse(String(opts.body)) as Email);
      return status === 200 ? { id: 'email_test' } : { message: 'upstream unavailable' };
    });
}

/** Only from here on is every outbound request mocked or refused. */
function watchEmail() {
  sent = [];
  fetchMock.activate();
  fetchMock.disableNetConnect();
}

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
});

async function submittedClinician(label: string) {
  const email = uniqueEmail(label);
  const { accessToken } = await registerVerifyAndLoginApplicant(email);
  const submitted = await submittedSession(accessToken);
  return { email, clinicianId: await clinicianIdForEmail(email), ...submitted };
}

async function makeClearable(api: ReturnType<typeof adminApi>, clinicianId: number): Promise<Detail> {
  let detail = await api.ok(api.get(`/${clinicianId}`));
  for (const req of detail.documentReviews.requirements.filter((r) => r.required)) {
    detail = await api.ok(api.put(`/${clinicianId}/document-reviews/${req.requirement}`, { status: 'accepted', expectedUpdatedAt: req.updatedAt }));
  }
  for (const kind of VERIFICATIONS) detail = await api.ok(api.put(`/${clinicianId}/verifications/${kind}`, { status: 'complete' }));
  return detail;
}

const emailAudits = async (clinicianId: number) =>
  (await auditActions(clinicianId)).filter((a) => a.action.startsWith('clearance_email_'));

describe('clearance email', () => {
  it('a successful clearance emails the applicant once, by name, with nothing sensitive', async () => {
    const api = adminApi(await loginAsAdmin());
    const { clinicianId, email } = await submittedClinician('clear-email');
    await makeClearable(api, clinicianId);

    watchEmail();
    nextEmail(200);
    const response = await api.call('POST', `/${clinicianId}/clearance`, {});
    expect(response.status).toBe(200);
    const cleared = (await response.json()) as Detail & { clearanceEmail: string };
    expect(cleared.clearance.clearedAt).toBeTruthy();
    expect(cleared.clearanceEmail).toBe('sent');
    expect(cleared.clearance.email).toBe('sent');

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe(email);
    expect(sent[0].subject).toBe("You're cleared to start picking up shifts");
    expect(sent[0].text).toMatch(/^Hi \S+,/);
    expect(sent[0].text).toContain('cleared to begin picking up shifts');
    expect(sent[0].text).toContain('staffing manager will reach out');
    // Nothing from the file: no application id, SSN, documents or verifications.
    expect(sent[0].text).not.toMatch(/PCS-|SSN|\d{3}-\d{2}-\d{4}|license|document|background|I-9|W-4/i);

    // Reads and refreshes never send again (no interceptor is left to answer).
    await api.ok(api.get(`/${clinicianId}`));
    await api.ok(api.get(`/${clinicianId}`));
    // A second clearance attempt fails, and sends nothing.
    expect((await api.post(`/${clinicianId}/clearance`, {})).status).toBe(409);
    expect(sent).toHaveLength(1);
    expect((await emailAudits(clinicianId)).map((a) => a.action)).toEqual(['clearance_email_sent']);
  });

  it('a failed delivery leaves the clinician cleared, is audited, and is shown — not reported as a failed clearance', async () => {
    const api = adminApi(await loginAsAdmin());
    const { clinicianId } = await submittedClinician('clear-email-fail');
    await makeClearable(api, clinicianId);

    watchEmail();
    nextEmail(500);
    const response = await api.call('POST', `/${clinicianId}/clearance`, {});
    expect(response.status).toBe(200);
    const cleared = (await response.json()) as Detail & { clearanceEmail: string };
    expect(cleared.clearance.clearedAt).toBeTruthy();
    expect(cleared.clinician.queue).toBe('cleared');
    expect(cleared.clearanceEmail).toBe('failed');

    // Still shown after a refresh, from the audit trail.
    const later = await api.ok(api.get(`/${clinicianId}`));
    expect(later.clearance.clearedAt).toBeTruthy();
    expect(later.clearance.email).toBe('failed');
    expect(await emailAudits(clinicianId)).toEqual([expect.objectContaining({ action: 'clearance_email_failed', metadata: expect.objectContaining({ reason: 'delivery_failed' }) })]);
  });

  it('nothing is sent while clearance is incomplete, or for verification and review changes', async () => {
    const api = adminApi(await loginAsAdmin());
    const { clinicianId } = await submittedClinician('clear-email-none');

    watchEmail();
    expect((await api.post(`/${clinicianId}/clearance`, {})).status).toBe(409);
    await makeClearable(api, clinicianId);
    expect(sent).toHaveLength(0);
    expect(await emailAudits(clinicianId)).toEqual([]);
    expect((await api.ok(api.get(`/${clinicianId}`))).clearance.email).toBeNull();
  });

  it('revoking sends nothing; clearing again later is a new transition and sends one more', async () => {
    const api = adminApi(await loginAsAdmin());
    const { clinicianId } = await submittedClinician('clear-email-again');
    await makeClearable(api, clinicianId);

    watchEmail();
    nextEmail(200);
    await api.ok(api.post(`/${clinicianId}/clearance`, {}));
    const revoked = await api.ok(api.post(`/${clinicianId}/clearance/revoke`, { reason: 'Recheck' }));
    expect(revoked.clearance.email).toBeNull();
    expect(sent).toHaveLength(1);

    nextEmail(200);
    const again = await api.ok(api.post(`/${clinicianId}/clearance`, {}));
    expect(again.clearance.email).toBe('sent');
    expect(sent).toHaveLength(2);
    expect((await emailAudits(clinicianId)).map((a) => a.action)).toEqual(['clearance_email_sent', 'clearance_email_sent']);
  });

  it('a super_admin override reaches the same cleared state and sends the same email', async () => {
    const api = adminApi(await loginAsSuperAdmin());
    const { clinicianId } = await submittedClinician('clear-email-override');

    watchEmail();
    nextEmail(200);
    const cleared = await api.ok(api.post(`/${clinicianId}/clearance`, { override: true, reason: 'Verified by phone' }));
    expect(cleared.clearance.clearedAt).toBeTruthy();
    expect(cleared.clearance.email).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('cleared to begin picking up shifts');
  });
});
