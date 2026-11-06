import { SELF, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BASE, loginAsAdmin } from './helpers';
import { fakeFile } from './submissionFixtures';
import { adminApi, attachOk, auditActions, auth, corrections, decide, inProgress, review } from './workflowFixtures';

// The admin's manual "Resend Notification" for a correction email that could
// not be sent. Resend is mocked per email here (its own file: fetchMock keeps
// interceptors for the whole file), and nothing reaches the network.

describe('resending a correction notification', () => {
  let sent: { to: string; subject: string; text: string }[] = [];

  /** The next email answers with `status` (each send needs its own). */
  function nextEmail(status: number) {
    fetchMock
      .get('https://api.resend.com')
      .intercept({ path: '/emails', method: 'POST' })
      .reply(status, (opts) => {
        if (status === 200) sent.push(JSON.parse(String(opts.body)));
        return status === 200 ? { id: 'email_test' } : { message: 'upstream unavailable' };
      });
  }

  beforeEach(() => {
    sent = [];
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });

  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  it('a failed email leaves the correction valid and shows it was not sent; Resend Notification sends it and is audited', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, session, clinicianId } = await inProgress('resend');
    await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));

    nextEmail(500);
    const decided = await api.call('PUT', `/${clinicianId}/document-reviews/cpr_cert`, { status: 'needs_correction', note: 'Card is expired', expectedUpdatedAt: null });
    expect(((await decided.json()) as { correctionNotification: string }).correctionNotification).toBe('failed');
    const detail = await api.ok(api.get(`/${clinicianId}`));
    expect(review(detail, 'cpr_cert')).toMatchObject({ status: 'needs_correction', correctionOpen: true, correctionNotified: false });
    expect(await corrections(accessToken, session.sessionId)).toEqual([expect.objectContaining({ requirement: 'cpr_cert', note: 'Card is expired' })]);

    // Failing again is reported, and changes nothing.
    nextEmail(503);
    const failed = await api.post(`/${clinicianId}/document-reviews/cpr_cert/notify`);
    expect(failed.status).toBe(502);
    expect(((await failed.json()) as { error: string }).error).toContain('The correction is saved');

    nextEmail(200);
    const resent = await api.ok(api.post(`/${clinicianId}/document-reviews/cpr_cert/notify`));
    expect(review(resent, 'cpr_cert').correctionNotified).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('CPR / BLS certification');
    expect(sent[0].text).toContain('Card is expired');
    expect(sent[0].text).not.toContain('cpr.jpg');
    const audit = (await auditActions(clinicianId)).filter((a) => a.action === 'document_correction_notification_resent');
    expect(audit).toEqual([{ action: 'document_correction_notification_resent', metadata: expect.objectContaining({ requirement: 'cpr_cert' }) }]);
  });

  it('is refused while On Hold, and for a correction already resolved — nothing stale is sent', async () => {
    const cookie = await loginAsAdmin();
    const api = adminApi(cookie);
    const { accessToken, session, clinicianId } = await inProgress('resend-refused');
    const current = await attachOk(accessToken, session, 'cpr_cert', fakeFile('cpr.jpg', 'image/jpeg', 100));
    await api.ok(api.post(`/${clinicianId}/hold`, {}));
    await api.ok(api.put(`/${clinicianId}/document-reviews/cpr_cert`, { status: 'needs_correction', note: 'Blurry', expectedUpdatedAt: null }));

    const held = await api.post(`/${clinicianId}/document-reviews/cpr_cert/notify`);
    expect(held.status).toBe(409);
    expect(((await held.json()) as { error: string }).error).toContain('On Hold');

    // Fixed by the applicant, then accepted: the correction is closed.
    await attachOk(accessToken, current, 'cpr_cert', fakeFile('cpr-2.jpg', 'image/jpeg', 100), { mode: 'add' });
    expect((await api.post(`/${clinicianId}/document-reviews/cpr_cert/notify`)).status).toBe(409);
    await decide(cookie, clinicianId, 'cpr_cert', 'accepted');
    expect((await api.post(`/${clinicianId}/document-reviews/cpr_cert/notify`)).status).toBe(409);
    expect((await api.post(`/${clinicianId}/document-reviews/applicant_resume/notify`)).status).toBe(409);
    expect(sent).toEqual([]);
  });

  it('applicants and anonymous callers cannot trigger it', async () => {
    const { accessToken, clinicianId } = await inProgress('resend-auth');
    const url = `${BASE}/api/admin/clinicians/${clinicianId}/document-reviews/cpr_cert/notify`;
    expect((await SELF.fetch(url, { method: 'POST', headers: auth(accessToken) })).status).toBe(403);
    expect((await SELF.fetch(url, { method: 'POST' })).status).toBe(401);
  });
});
