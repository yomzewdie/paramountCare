import { SELF, env } from 'cloudflare:test';
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

  // ── ADR-018 §2: database-enforced uniqueness, not a client-side pre-check ──

  it('a second create call for the same applicant returns the existing session (200), not a new one', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('reuse-existing'));
    const first = await createSession(accessToken);
    expect(first.res.status).toBe(201);

    const second = await createSession(accessToken);
    expect(second.res.status).toBe(200); // reused, not created
    expect(second.body.sessionId).toBe(first.body.sessionId);
    expect(second.body.revision).toBe(first.body.revision);
  });

  it('two different applicants each get their own independent session', async () => {
    const a = await registerVerifyAndLoginApplicant(uniqueEmail('owner-a'));
    const b = await registerVerifyAndLoginApplicant(uniqueEmail('owner-b'));

    const sessionA = await createSession(a.accessToken);
    const sessionB = await createSession(b.accessToken);

    expect(sessionA.res.status).toBe(201);
    expect(sessionB.res.status).toBe(201);
    expect(sessionA.body.sessionId).not.toBe(sessionB.body.sessionId);
  });

  it('two concurrent create calls for the same applicant cannot both create a session — one wins (201), one reuses (200), and both get the SAME session', async () => {
    const email = uniqueEmail('concurrent-create');
    const { accessToken } = await registerVerifyAndLoginApplicant(email);

    // Two genuinely concurrent requests through the real HTTP route — not a
    // GET-first-then-POST client simulation, and not a mocked race. Whether
    // the underlying D1/Miniflare connection actually interleaves these at
    // the statement level or serializes them, the assertion that matters is
    // the OUTCOME: never two rows, never an error surfaced to either caller.
    const [r1, r2] = await Promise.all([createSession(accessToken), createSession(accessToken)]);

    const statuses = [r1.res.status, r2.res.status].sort();
    expect(statuses).toEqual([200, 201]); // exactly one create, one reuse — never [500,*], [409,*], or [201,201]
    expect(r1.body.sessionId).toBe(r2.body.sessionId); // both callers end up with the SAME authoritative session

    // And directly confirm at most one row actually exists for this user in
    // the database — the real proof, not an inference from the HTTP
    // responses alone.
    const rowCount = await env.DB
      .prepare('SELECT COUNT(*) AS c FROM onboarding_sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)')
      .bind(email)
      .first<{ c: number }>();
    expect(rowCount?.c).toBe(1);
  });
});

// ── Database-level uniqueness (ADR-018 §2) ──────────────────────────────────
//
// The route-level tests above prove the *behavior* (both callers end up with
// one shared session, never an error). These prove the *mechanism*: the
// idx_sessions_user_id_unique partial index (migrations/0005) is what
// actually makes that behavior possible, independent of any application code
// — a raw second INSERT for the same user_id is rejected by SQLite/D1
// itself, and a NULL user_id (the legacy/pre-applicant-accounts compatibility
// case documented in migrations/0003) is explicitly still unconstrained.

describe('idx_sessions_user_id_unique (database-level)', () => {
  it('rejects a second row with the same non-null user_id at the database level', async () => {
    const { accessToken } = await registerVerifyAndLoginApplicant(uniqueEmail('db-level-uniq'));
    const { body } = await createSession(accessToken);
    const owner = await env.DB
      .prepare('SELECT user_id FROM onboarding_sessions WHERE session_id = ?')
      .bind(body.sessionId)
      .first<{ user_id: number }>();

    // A raw second INSERT, bypassing the route/application layer entirely —
    // this is what proves the database itself is the authority, not merely
    // that the route happens to behave correctly today.
    await expect(
      env.DB
        .prepare(
          `INSERT INTO onboarding_sessions (session_id, packet_id, packet_version, user_id) VALUES (?, 'general_rn', 5, ?)`,
        )
        .bind('some-other-session-id', owner!.user_id)
        .run(),
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('permits multiple rows with a NULL user_id — the legacy/pre-applicant-accounts compatibility case is unaffected', async () => {
    // onboarding_sessions.user_id is deliberately nullable at the database
    // level (migrations/0003) for pre-existing rows created before applicant
    // accounts existed; this migration must not turn that into a second
    // constraint violation for NULL specifically.
    await env.DB
      .prepare(`INSERT INTO onboarding_sessions (session_id, packet_id, packet_version, user_id) VALUES (?, 'general_rn', 5, NULL)`)
      .bind('legacy-session-a')
      .run();
    await env.DB
      .prepare(`INSERT INTO onboarding_sessions (session_id, packet_id, packet_version, user_id) VALUES (?, 'general_rn', 5, NULL)`)
      .bind('legacy-session-b')
      .run();

    const rows = await env.DB
      .prepare(`SELECT session_id FROM onboarding_sessions WHERE session_id IN ('legacy-session-a', 'legacy-session-b')`)
      .all();
    expect(rows.results).toHaveLength(2);
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
