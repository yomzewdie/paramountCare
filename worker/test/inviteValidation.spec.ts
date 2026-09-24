import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, seedInvite, registerViaInvite } from './helpers';

async function validate(code: string) {
  const res = await SELF.fetch(`${BASE}/api/invites/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const body = await res.json() as Record<string, unknown>;
  return { res, body };
}

describe('POST /api/invites/validate', () => {
  it('returns a masked (never full) email for a valid, outstanding invitation', async () => {
    const email = uniqueEmail('validate-ok');
    const rawCode = await seedInvite(email);

    const { res, body } = await validate(rawCode);
    expect(res.status).toBe(200);
    expect(body.email).toBe(`${email[0]}***@${email.split('@')[1]}`);
    expect(body.email).not.toBe(email);
  });

  it('is normalization-tolerant: lowercase, spaces, and dashes are all accepted', async () => {
    const email = uniqueEmail('validate-normalize');
    const rawCode = await seedInvite(email);
    const mangled = rawCode.toLowerCase().slice(0, 5) + '-' + rawCode.slice(5, 8) + ' ' + rawCode.slice(8);

    const { res, body } = await validate(mangled);
    expect(res.status).toBe(200);
    expect(body.email).toBe(`${email[0]}***@${email.split('@')[1]}`);
  });

  it('does not mutate the invitation row — it remains fully outstanding after validation', async () => {
    const email = uniqueEmail('validate-no-mutate');
    const rawCode = await seedInvite(email);

    await validate(rawCode);

    const row = await env.DB
      .prepare('SELECT used_at, revoked_at FROM onboarding_invites WHERE email = ?')
      .bind(email)
      .first<{ used_at: string | null; revoked_at: string | null }>();
    expect(row?.used_at).toBeNull();
    expect(row?.revoked_at).toBeNull();

    // The invite is still fully usable for real registration afterward.
    const registerRes = await registerViaInvite(rawCode);
    expect(registerRes.status).toBe(201);
  });

  it('returns one generic error for a code that does not exist, with no distinguishing detail', async () => {
    const { res, body } = await validate('ZZZZZZZZZZ');
    expect(res.status).toBe(404);
    expect(body.error).toBe('INVITE_CODE_INVALID');
  });

  it('returns the SAME generic error for an expired invitation', async () => {
    const email = uniqueEmail('validate-expired');
    const rawCode = await seedInvite(email);
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await env.DB.prepare(`UPDATE onboarding_invites SET expires_at = ? WHERE email = ?`).bind(oneDayAgo, email).run();

    const { res, body } = await validate(rawCode);
    expect(res.status).toBe(404);
    expect(body.error).toBe('INVITE_CODE_INVALID');
  });

  it('returns the SAME generic error for a revoked invitation', async () => {
    const email = uniqueEmail('validate-revoked');
    const rawCode = await seedInvite(email);
    await env.DB.prepare(`UPDATE onboarding_invites SET revoked_at = datetime('now') WHERE email = ?`).bind(email).run();

    const { res, body } = await validate(rawCode);
    expect(res.status).toBe(404);
    expect(body.error).toBe('INVITE_CODE_INVALID');
  });

  it('returns the SAME generic error for an already-used invitation', async () => {
    const email = uniqueEmail('validate-used');
    const rawCode = await seedInvite(email);
    const registerRes = await registerViaInvite(rawCode);
    expect(registerRes.status).toBe(201);

    const { res, body } = await validate(rawCode);
    expect(res.status).toBe(404);
    expect(body.error).toBe('INVITE_CODE_INVALID');
  });

  it('rejects a missing code with 422', async () => {
    const res = await SELF.fetch(`${BASE}/api/invites/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(422);
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await SELF.fetch(`${BASE}/api/invites/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not valid json',
    });
    expect(res.status).toBe(400);
  });
});
