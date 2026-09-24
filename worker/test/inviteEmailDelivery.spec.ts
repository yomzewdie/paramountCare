import { SELF, env, fetchMock } from 'cloudflare:test';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin } from './helpers';

// Email delivery feedback for admin invitation create/resend. Resend is
// mocked at the network boundary (fetchMock) so these tests are
// deterministic — the real production code path (services/email.ts's fetch
// to api.resend.com) runs unchanged.

let captured: string[] = [];

function mockResend(status: number, responseBody: unknown = { id: 'email_test' }) {
  fetchMock
    .get('https://api.resend.com')
    .intercept({ path: '/emails', method: 'POST' })
    .reply(status, (opts) => {
      captured.push(String(opts.body));
      return responseBody as object;
    });
}

beforeEach(() => {
  captured = [];
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  fetchMock.deactivate();
});

async function createInvite(cookie: string, email: string) {
  const res = await SELF.fetch(`${BASE}/api/admin/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ email }),
  });
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Record<string, unknown> };
}

async function resendInvite(cookie: string, id: unknown) {
  const res = await SELF.fetch(`${BASE}/api/admin/invites/${id}/resend`, { method: 'POST', headers: { cookie } });
  const text = await res.text();
  return { res, text, body: JSON.parse(text) as Record<string, unknown> };
}

function extractCode(emailPayload: string): string {
  const { text } = JSON.parse(emailPayload) as { text: string };
  const match = text.match(/Invitation Code\s+([0-9A-Z]{10})/);
  if (!match) throw new Error('test setup: no invitation code found in email body');
  return match[1];
}

describe('invitation email delivery feedback — create', () => {
  it('reports emailDelivery "sent" when the email provider accepts the message', async () => {
    mockResend(200);
    const cookie = await loginAsAdmin();
    const { res, body } = await createInvite(cookie, uniqueEmail('delivery-ok'));
    expect(res.status).toBe(201);
    expect(body.emailDelivery).toBe('sent');
    expect(body.status).toBe('pending');
    expect(captured).toHaveLength(1);
  });

  it('reports "failed" — but keeps the invitation — when the provider rejects the message', async () => {
    mockResend(403, { statusCode: 403, name: 'validation_error', message: 'provider-secret-detail: domain not verified' });
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('delivery-fail');
    const { res, text, body } = await createInvite(cookie, email);

    expect(res.status).toBe(201);
    expect(body.emailDelivery).toBe('failed');
    expect(body.status).toBe('pending');

    const row = await env.DB.prepare('SELECT id, used_at, revoked_at FROM onboarding_invites WHERE email = ?')
      .bind(email)
      .first<{ id: number; used_at: string | null; revoked_at: string | null }>();
    expect(row).toBeTruthy();
    expect(row!.used_at).toBeNull();
    expect(row!.revoked_at).toBeNull();

    // No raw provider response/detail leaks into the admin API response.
    expect(text).not.toContain('provider-secret-detail');
    expect(text).not.toContain('domain not verified');
  });

  it('reports "failed" when the provider is unreachable/erroring (5xx)', async () => {
    mockResend(500, { message: 'upstream exploded' });
    const cookie = await loginAsAdmin();
    const { res, body } = await createInvite(cookie, uniqueEmail('delivery-5xx'));
    expect(res.status).toBe(201);
    expect(body.emailDelivery).toBe('failed');
  });

  it('never returns the plaintext code, its hash, or the token_hash to the admin', async () => {
    mockResend(200);
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('delivery-no-code');
    const { text, body } = await createInvite(cookie, email);

    const code = extractCode(captured[0]);
    const row = await env.DB.prepare('SELECT token_hash FROM onboarding_invites WHERE email = ?')
      .bind(email)
      .first<{ token_hash: string }>();

    expect(text).not.toContain(code);
    expect(text).not.toContain(row!.token_hash);
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'createdBy', 'email', 'emailDelivery', 'expiresAt', 'id', 'revokedAt', 'status', 'updatedAt', 'usedAt'].sort(),
    );
  });
});

describe('invitation email sender', () => {
  it('sends from the verified paramountcarestaffing.com sender, on create and resend', async () => {
    const cookie = await loginAsAdmin();
    mockResend(200);
    const created = await createInvite(cookie, uniqueEmail('sender'));
    mockResend(200);
    await resendInvite(cookie, created.body.id);

    expect(captured).toHaveLength(2);
    for (const payload of captured) {
      expect((JSON.parse(payload) as { from: string }).from).toBe('Paramount Care Staffing <noreply@paramountcarestaffing.com>');
    }
  });
});

describe('invitation email delivery feedback — resend', () => {
  it('reports "sent" on a successful resend and the emailed code differs from the original', async () => {
    const cookie = await loginAsAdmin();
    mockResend(200);
    const created = await createInvite(cookie, uniqueEmail('resend-ok'));
    mockResend(200);
    const { res, body } = await resendInvite(cookie, created.body.id);

    expect(res.status).toBe(200);
    expect(body.emailDelivery).toBe('sent');
    expect(extractCode(captured[1])).not.toBe(extractCode(captured[0]));
  });

  it('reports "failed" on resend when delivery fails, and the admin can resend again after fixing it', async () => {
    const cookie = await loginAsAdmin();
    mockResend(200);
    const created = await createInvite(cookie, uniqueEmail('resend-fail'));

    mockResend(403, { message: 'provider-secret-detail' });
    const failed = await resendInvite(cookie, created.body.id);
    expect(failed.res.status).toBe(200);
    expect(failed.body.emailDelivery).toBe('failed');
    expect(failed.body.status).toBe('pending');
    expect(failed.text).not.toContain('provider-secret-detail');

    mockResend(200);
    const retried = await resendInvite(cookie, created.body.id);
    expect(retried.res.status).toBe(200);
    expect(retried.body.emailDelivery).toBe('sent');
  });

  it('can resend an expired invitation (rotates the code and expiry) and reports delivery', async () => {
    const cookie = await loginAsAdmin();
    mockResend(200);
    const email = uniqueEmail('resend-expired');
    const created = await createInvite(cookie, email);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare('UPDATE onboarding_invites SET expires_at = ? WHERE email = ?').bind(oneDayAgo, email).run();

    mockResend(200);
    const { res, body } = await resendInvite(cookie, created.body.id);
    expect(res.status).toBe(200);
    expect(body.status).toBe('pending');
    expect(body.emailDelivery).toBe('sent');
  });
});
