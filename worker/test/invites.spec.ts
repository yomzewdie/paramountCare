import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, loginAsAdmin, registerVerifyAndLoginApplicant, registerViaInvite } from './helpers';

async function createInvite(cookie: string, email: string) {
  const res = await SELF.fetch(`${BASE}/api/admin/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ email }),
  });
  const body = await res.json() as Record<string, unknown>;
  return { res, body };
}

// ── Creation ───────────────────────────────────────────────────────────────────

describe('POST /api/admin/invites', () => {
  it('an authenticated admin can create an invitation', async () => {
    const cookie = await loginAsAdmin();
    const { res, body } = await createInvite(cookie, uniqueEmail('invite-create'));
    expect(res.status).toBe(201);
    expect(body.status).toBe('pending');
    expect(body.email).toBeTruthy();
    // The raw token and its hash must never appear in the API response.
    expect(body.token).toBeUndefined();
    expect(body.tokenHash).toBeUndefined();
    expect(body.token_hash).toBeUndefined();
  });

  it('an applicant cannot create an invitation', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('invite-applicant-forbidden'));
    const res = await SELF.fetch(`${BASE}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ email: uniqueEmail('target') }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated invite creation', async () => {
    const res = await SELF.fetch(`${BASE}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: uniqueEmail('nobody') }),
    });
    expect(res.status).toBe(401);
  });

  it('the invitation token is never stored raw in the database', async () => {
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('invite-hashed');
    await createInvite(cookie, email);

    const row = await env.DB.prepare('SELECT token_hash FROM onboarding_invites WHERE email = ?').bind(email).first<{ token_hash: string }>();
    expect(row).toBeTruthy();
    // A SHA-256 hex digest is 64 characters — clearly not a plaintext value,
    // and definitely not equal to anything an email body would contain verbatim.
    expect(row!.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rejects creating a duplicate outstanding invitation for the same email', async () => {
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('invite-dup');
    const first = await createInvite(cookie, email);
    expect(first.res.status).toBe(201);

    const second = await createInvite(cookie, email);
    expect(second.res.status).toBe(409);
  });

  it('rejects creating an invitation for an already-registered email', async () => {
    const email = uniqueEmail('invite-already-registered');
    await registerVerifyAndLoginApplicant(email);

    const cookie = await loginAsAdmin();
    const { res } = await createInvite(cookie, email);
    expect(res.status).toBe(409);
  });

  it('rejects a malformed email', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ email: 'not-an-email' }),
    });
    expect(res.status).toBe(422);
  });
});

// ── Listing ───────────────────────────────────────────────────────────────────

describe('GET /api/admin/invites', () => {
  it('lists invitations for an admin', async () => {
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('invite-list');
    await createInvite(cookie, email);

    const res = await SELF.fetch(`${BASE}/api/admin/invites?email=${encodeURIComponent(email)}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { email: string; status: string }[]; pagination: { total: number } };
    expect(body.data.some((i) => i.email === email && i.status === 'pending')).toBe(true);
  });

  it('rejects a non-admin caller', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('invite-list-forbidden'));
    const res = await SELF.fetch(`${BASE}/api/admin/invites`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(403);
  });
});

// ── Resend ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/invites/:id/resend', () => {
  it('rotates the token: the old one stops working and a new one is issued', async () => {
    const cookie = await loginAsAdmin();
    const email = uniqueEmail('invite-resend');

    // Seed directly so the test can observe the ORIGINAL raw token, then
    // resend via the real endpoint and confirm rotation.
    const { seedInvite } = await import('./helpers');
    const originalToken = await seedInvite(email);
    const inviteRow = await env.DB.prepare('SELECT id FROM onboarding_invites WHERE email = ?').bind(email).first<{ id: number }>();

    const resendRes = await SELF.fetch(`${BASE}/api/admin/invites/${inviteRow!.id}/resend`, {
      method: 'POST',
      headers: { cookie },
    });
    expect(resendRes.status).toBe(200);
    const resendBody = await resendRes.json() as { status: string };
    expect(resendBody.status).toBe('pending');

    // The OLD token must no longer register an account.
    const oldTokenRes = await registerViaInvite(originalToken);
    expect(oldTokenRes.status).toBe(401);

    // Only ONE token_hash exists for this invite id at any time (rotation
    // overwrote the row rather than creating a second one).
    const rows = await env.DB.prepare('SELECT COUNT(*) as cnt FROM onboarding_invites WHERE email = ?').bind(email).first<{ cnt: number }>();
    expect(rows!.cnt).toBe(1);
  });

  it('rejects resending an already-used invitation', async () => {
    const cookie = await loginAsAdmin();
    const { seedInvite } = await import('./helpers');
    const email = uniqueEmail('invite-resend-used');
    const rawToken = await seedInvite(email);
    await registerViaInvite(rawToken);

    const inviteRow = await env.DB.prepare('SELECT id FROM onboarding_invites WHERE email = ?').bind(email).first<{ id: number }>();
    const res = await SELF.fetch(`${BASE}/api/admin/invites/${inviteRow!.id}/resend`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(409);
  });

  it('rejects resending a revoked invitation', async () => {
    const cookie = await loginAsAdmin();
    const { res: createRes, body: created } = await createInvite(cookie, uniqueEmail('invite-resend-revoked'));
    expect(createRes.status).toBe(201);
    await SELF.fetch(`${BASE}/api/admin/invites/${created.id}/revoke`, { method: 'POST', headers: { cookie } });

    const res = await SELF.fetch(`${BASE}/api/admin/invites/${created.id}/resend`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(409);
  });

  it('returns 404 for a nonexistent invite id', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/admin/invites/999999999/resend`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(404);
  });
});

// ── Revoke ─────────────────────────────────────────────────────────────────────

describe('POST /api/admin/invites/:id/revoke', () => {
  it('revokes an outstanding invitation, which can then no longer be used to register', async () => {
    const cookie = await loginAsAdmin();
    const { seedInvite } = await import('./helpers');
    const email = uniqueEmail('invite-revoke');
    const rawToken = await seedInvite(email);
    const inviteRow = await env.DB.prepare('SELECT id FROM onboarding_invites WHERE email = ?').bind(email).first<{ id: number }>();

    const revokeRes = await SELF.fetch(`${BASE}/api/admin/invites/${inviteRow!.id}/revoke`, { method: 'POST', headers: { cookie } });
    expect(revokeRes.status).toBe(200);
    const revokeBody = await revokeRes.json() as { status: string };
    expect(revokeBody.status).toBe('revoked');

    const registerRes = await registerViaInvite(rawToken);
    expect(registerRes.status).toBe(401);
  });

  it('rejects revoking an already-used invitation', async () => {
    const { seedInvite } = await import('./helpers');
    const email = uniqueEmail('invite-revoke-used');
    const rawToken = await seedInvite(email);
    await registerViaInvite(rawToken);

    const cookie = await loginAsAdmin();
    const inviteRow = await env.DB.prepare('SELECT id FROM onboarding_invites WHERE email = ?').bind(email).first<{ id: number }>();
    const res = await SELF.fetch(`${BASE}/api/admin/invites/${inviteRow!.id}/revoke`, { method: 'POST', headers: { cookie } });
    expect(res.status).toBe(409);
  });

  it('rejects a non-admin caller', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('invite-revoke-forbidden'));
    const res = await SELF.fetch(`${BASE}/api/admin/invites/1/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(403);
  });
});
