import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { BASE, uniqueEmail, registerVerifyAndLoginApplicant, loginAsAdmin } from './helpers';

async function createSession(accessToken: string, packetId = 'general_rn') {
  const res = await SELF.fetch(`${BASE}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ packetId }),
  });
  const body = await res.json() as { sessionId: string; revision: number };
  return { res, body };
}

const VALID_PERSONAL_INFO = {
  firstName: 'Jane',
  lastName: 'Doe',
  middleInitial: '',
  otherLastNames: '',
  email: 'jane.doe@example.com',
  phone: '5551234567',
  address: '123 Main St',
  aptNumber: '',
  city: 'Los Angeles',
  state: 'CA',
  zip: '90001',
};

// ── No anonymous access exists ────────────────────────────────────────────────

describe('Sessions require authentication end-to-end', () => {
  it('rejects session creation with no credentials at all', async () => {
    const res = await SELF.fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packetId: 'general_rn' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects reading a session with no credentials at all', async () => {
    const res = await SELF.fetch(`${BASE}/api/sessions/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(401);
  });

  it('rejects updating a session with no credentials at all', async () => {
    const res = await SELF.fetch(`${BASE}/api/sessions/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it('there is no claim endpoint anymore', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('no-claim-route'));
    const res = await SELF.fetch(`${BASE}/api/sessions/00000000-0000-0000-0000-000000000000/claim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    // Not mounted at all — falls through to the app's global 404 handler
    // rather than any session-specific logic.
    expect(res.status).toBe(404);
  });

  it('an admin token cannot create a session (applicant-only route)', async () => {
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ packetId: 'general_rn' }),
    });
    expect(res.status).toBe(403);
  });
});

// ── Creation ───────────────────────────────────────────────────────────────────

describe('POST /api/sessions', () => {
  it('an authenticated, verified applicant can create a session, owned automatically', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('create-owned'));
    const { res, body } = await createSession(accessToken);
    expect(res.status).toBe(201);
    expect(body.revision).toBe(1);
    expect(body.sessionId).toBeTruthy();
  });

  it('does not accept a client-supplied userId — ownership always comes from the token', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('no-client-userid'));
    const res = await SELF.fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      // Even if a client tries to smuggle a userId in, the schema has no such
      // field, and the route never reads it from the body.
      body: JSON.stringify({ packetId: 'general_rn', userId: 999999 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { sessionId: string };

    // Confirm it's owned by the ACTUAL caller, not the smuggled id, by
    // reading it back with the same caller's token.
    const readRes = await SELF.fetch(`${BASE}/api/sessions/${body.sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(readRes.status).toBe(200);
  });

  it('rejects an unknown packetId', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('unknown-packet'));
    const res = await SELF.fetch(`${BASE}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ packetId: 'not-a-real-packet' }),
    });
    expect(res.status).toBe(422);
  });
});

// ── Retrieval & ownership ────────────────────────────────────────────────────

describe('GET /api/sessions/:sessionId', () => {
  it('returns 404 for an unknown session id', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('read-unknown'));
    const res = await SELF.fetch(`${BASE}/api/sessions/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(404);
  });

  it('the owner can read their own session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('read-owner'));
    const { body: created } = await createSession(accessToken);
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('a different applicant cannot read someone else\'s session (cross-user access rejected, non-disclosing)', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('owner'));
    const { body: created } = await createSession(owner.accessToken);

    const intruder = await registerVerifyAndLoginApplicant(uniqueEmail('intruder'));
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      headers: { Authorization: `Bearer ${intruder.accessToken}` },
    });
    expect(res.status).toBe(404); // existence not confirmed to the wrong caller
  });

  it('an admin token cannot read an applicant session (applicant-only route)', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('admin-cant-read'));
    const { body: created } = await createSession(owner.accessToken);
    const cookie = await loginAsAdmin();
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, { headers: { cookie } });
    expect(res.status).toBe(403);
  });
});

// ── Optimistic concurrency ───────────────────────────────────────────────────

describe('PATCH /api/sessions/:sessionId - optimistic concurrency', () => {
  it('applies the update and increments revision when the revision matches', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('patch-ok'));
    const { body: created } = await createSession(accessToken);
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ revision: created.revision, firstName: 'Jane', lastName: 'Doe' }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json() as { revision: number; firstName: string };
    expect(updated.revision).toBe(created.revision + 1);
    expect(updated.firstName).toBe('Jane');
  });

  it('rejects a stale revision with 409 and does not overwrite the saved data', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('patch-stale'));
    const { body: created } = await createSession(accessToken);
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };

    const firstUpdate = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ revision: created.revision, firstName: 'First-Writer' }),
    });
    expect(firstUpdate.status).toBe(200);

    const staleUpdate = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ revision: created.revision, firstName: 'Second-Writer-Should-Not-Win' }),
    });
    expect(staleUpdate.status).toBe(409);
    const conflictBody = await staleUpdate.json() as { error: string; currentRevision: number; current: { firstName: string } };
    expect(conflictBody.error).toBe('Conflict');
    expect(conflictBody.currentRevision).toBe(created.revision + 1);
    expect(conflictBody.current.firstName).toBe('First-Writer');

    const refetch = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const refetchBody = await refetch.json() as { firstName: string; revision: number };
    expect(refetchBody.firstName).toBe('First-Writer');
    expect(refetchBody.revision).toBe(created.revision + 1);
  });

  it('rejects an update to a session owned by a different applicant', async () => {
    const owner = await registerVerifyAndLoginApplicant(uniqueEmail('patch-owner'));
    const { body: created } = await createSession(owner.accessToken);

    const intruder = await registerVerifyAndLoginApplicant(uniqueEmail('patch-intruder'));
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${intruder.accessToken}` },
      body: JSON.stringify({ revision: created.revision, firstName: 'Should-Not-Apply' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for updating a nonexistent session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('patch-unknown'));
    const res = await SELF.fetch(`${BASE}/api/sessions/00000000-0000-0000-0000-000000000000`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ revision: 1 }),
    });
    expect(res.status).toBe(404);
  });
});

// ── Server-side validation on step completion (M2-D) ─────────────────────────

describe('PATCH /api/sessions/:sessionId - server-side step validation', () => {
  it('accepts marking personal_info completed when the data is valid', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('valid-step'));
    const { body: created } = await createSession(accessToken);
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        revision: created.revision,
        formData: { personalInfo: VALID_PERSONAL_INFO },
        stepStates: { personal_info: 'completed' },
      }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json() as { stepStates: Record<string, string> };
    expect(updated.stepStates.personal_info).toBe('completed');
  });

  it('rejects marking personal_info completed when the data is invalid, without advancing revision', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('invalid-step'));
    const { body: created } = await createSession(accessToken);
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        revision: created.revision,
        formData: { personalInfo: { ...VALID_PERSONAL_INFO, firstName: '', email: '' } },
        stepStates: { personal_info: 'completed' },
      }),
    });
    expect(res.status).toBe(422);

    const refetch = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    const refetchBody = await refetch.json() as { revision: number; stepStates: Record<string, string> };
    expect(refetchBody.revision).toBe(created.revision);
    expect(refetchBody.stepStates.personal_info).not.toBe('completed');
  });

  it('rejects an unknown step id for the session\'s packet', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('unknown-step'));
    const { body: created } = await createSession(accessToken);
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ revision: created.revision, stepStates: { not_a_real_step: 'completed' } }),
    });
    expect(res.status).toBe(422);
  });
});

// ── Resume on another device ──────────────────────────────────────────────────

describe('GET /api/sessions/mine', () => {
  it('returns the applicant\'s active session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('resume'));
    const { body: created } = await createSession(accessToken);

    const res = await SELF.fetch(`${BASE}/api/sessions/mine`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(200);
    const mine = await res.json() as { sessionId: string };
    expect(mine.sessionId).toBe(created.sessionId);
  });

  it('returns 404 when the applicant has no active session', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('no-session'));
    const res = await SELF.fetch(`${BASE}/api/sessions/mine`, { headers: { Authorization: `Bearer ${accessToken}` } });
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await SELF.fetch(`${BASE}/api/sessions/mine`);
    expect(res.status).toBe(401);
  });
});

// ── Completion status ──────────────────────────────────────────────────────────

describe('Completion status', () => {
  it('reflects partial progress via the shared completion calculator', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('completion'));
    const { body: created } = await createSession(accessToken);
    const res = await SELF.fetch(`${BASE}/api/sessions/${created.sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ revision: created.revision, formData: { personalInfo: VALID_PERSONAL_INFO } }),
    });
    const updated = await res.json() as { completionPercent: number | null };
    expect(updated.completionPercent).not.toBeNull();
    expect(updated.completionPercent as number).toBeGreaterThan(0);
    expect(updated.completionPercent as number).toBeLessThan(100);
  });
});
