import { fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  sendApplicantConfirmation,
  sendAdminNotification,
  sendApplicantInvitation,
  sendEmailVerificationCode,
} from '../src/services/email';

// Every outbound Resend email type must use the one verified sender.
const VERIFIED_SENDER = 'Paramount Care Staffing <noreply@paramountcarestaffing.com>';

let sent: { from: string; to: string | string[] }[] = [];

beforeEach(() => {
  sent = [];
  fetchMock.activate();
  fetchMock.disableNetConnect();
  fetchMock
    .get('https://api.resend.com')
    .intercept({ path: '/emails', method: 'POST' })
    .reply(200, (opts) => {
      sent.push(JSON.parse(String(opts.body)));
      return { id: 'email_test' };
    })
    .persist();
});

afterEach(() => {
  fetchMock.deactivate();
});

describe('transactional email sender', () => {
  it('applicant invitation uses the verified sender', async () => {
    await sendApplicantInvitation('key', { to: 'a@example.com', code: 'ABCDEFGHJK', expiresAt: new Date().toISOString() });
    expect(sent.map((m) => m.from)).toEqual([VERIFIED_SENDER]);
  });

  it('applicant submission confirmation uses the verified sender', async () => {
    await sendApplicantConfirmation('key', {
      to: 'a@example.com', firstName: 'Jane', applicationId: 'APP-1', submittedAt: new Date().toISOString(),
    });
    expect(sent.map((m) => m.from)).toEqual([VERIFIED_SENDER]);
  });

  it('admin notification uses the verified sender', async () => {
    await sendAdminNotification('key', 'admin@example.com', {
      firstName: 'Jane', lastName: 'Nurse', applicationId: 'APP-1', submittedAt: new Date().toISOString(), status: 'submitted',
    });
    expect(sent.map((m) => m.from)).toEqual([VERIFIED_SENDER]);
  });

  it('verification-code email uses the verified sender', async () => {
    await sendEmailVerificationCode('key', { to: 'a@example.com', code: '123456' });
    expect(sent.map((m) => m.from)).toEqual([VERIFIED_SENDER]);
  });

  it('no email type falls back to the Resend test sender', async () => {
    await sendApplicantInvitation('key', { to: 'a@example.com', code: 'ABCDEFGHJK', expiresAt: new Date().toISOString() });
    await sendEmailVerificationCode('key', { to: 'a@example.com', code: '123456' });
    for (const m of sent) expect(m.from).not.toContain('resend.dev');
  });
});
