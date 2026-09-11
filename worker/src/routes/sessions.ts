import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import { requireApplicant } from '../middleware/requireApplicant';
import { createSessionSchema, updateSessionSchema } from '../schemas/sessions';
import { generateSessionId } from '../utils/sessionId';
import {
  getPacket,
  isStepValid,
  computeOverallCompletion,
  defaultFormData,
  type OnboardingFormData,
} from '@pcs/shared';
import {
  insertSession,
  findSessionById,
  findActiveSessionForUser,
  updateSessionWithRevision,
  type OnboardingSessionRow,
} from '../db/queries/onboardingSessions';

// computeOverallCompletion/isStepValid are written against a fully-shaped
// OnboardingFormData (acknowledgements, employmentReferences, etc. always
// present, even if empty) — a session's stored form_data_json starts as '{}'
// and only ever contains whatever fields a client has saved so far. Merging
// onto defaultFormData guarantees every key shared/validation.ts and
// completion.ts expect to read is always present, matching the same
// contract the frontend's own defaultFormData already provides.
function withDefaults(formData: Record<string, unknown>): OnboardingFormData {
  return { ...defaultFormData, ...formData } as unknown as OnboardingFormData;
}

export const sessions = new Hono<AppEnv>();

// Product decision: onboarding sessions require an authenticated, email-
// verified applicant from the moment of creation — there is no anonymous
// session, no session-id-as-credential, and no claim transition. Every route
// in this file requires a valid applicant access token.
sessions.use('*', requireAuth);
sessions.use('*', requireApplicant);

// ── Serialization ────────────────────────────────────────────────────────────

function serializeSession(row: OnboardingSessionRow) {
  let stepStates: Record<string, string> = {};
  let formData: Record<string, unknown> = {};
  try { stepStates = JSON.parse(row.step_states_json || '{}'); } catch { /* leave {} */ }
  try { formData = JSON.parse(row.form_data_json || '{}'); } catch { /* leave {} */ }

  const packet = getPacket(row.packet_id);
  const completionPercent = packet ? computeOverallCompletion(withDefaults(formData)) : null;

  return {
    sessionId: row.session_id,
    packetId: row.packet_id,
    packetVersion: row.packet_version,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    stepStates,
    formData,
    status: row.status,
    applicationId: row.application_id,
    revision: row.revision,
    completionPercent,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ── Ownership ─────────────────────────────────────────────────────────────────
//
// A session belongs to exactly one applicant, fixed at creation. Ownership is
// determined solely from the verified access token (payload.uid) — never
// from anything in the request body. A 404 (not 403) is returned for a
// mismatched owner so a caller without access cannot even confirm the
// session exists (IDOR hardening) — this mirrors the same non-disclosing
// behavior the admin routes already use for cross-applicant application
// lookups.

type AuthorizedSessionResult =
  | { ok: true; session: OnboardingSessionRow }
  | { ok: false; response: Response };

async function loadOwnedSession(
  c: Context<AppEnv>,
  sessionId: string,
): Promise<AuthorizedSessionResult> {
  const payload = c.get('jwtPayload');
  if (!payload) {
    // requireAuth/requireApplicant already guarantee this is unreachable in
    // practice; kept as an explicit, typed guard rather than a non-null
    // assertion.
    return { ok: false, response: c.json({ error: 'Unauthorized' }, 401) };
  }

  const session = await findSessionById(c.env.DB, sessionId);
  if (!session || session.user_id !== payload.uid) {
    return { ok: false, response: c.json({ error: 'Session not found' }, 404) };
  }
  return { ok: true, session };
}

// ── POST /api/sessions — create (always owned by the authenticated caller) ──

sessions.post('/', async (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = createSessionSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  const packet = getPacket(result.data.packetId);
  if (!packet) {
    return c.json({ error: `Unknown packetId: ${result.data.packetId}` }, 422);
  }

  // user_id always comes from the verified token — the request body has no
  // userId field at all (see schemas/sessions.ts), so there is nothing here
  // to accidentally trust from client input.
  const row = await insertSession(c.env.DB, {
    sessionId: generateSessionId(),
    packetId: packet.id,
    packetVersion: packet.version,
    userId: payload.uid,
  });

  return c.json(serializeSession(row), 201);
});

// ── GET /api/sessions/mine — resume entry point after logging in ────────────
// Must be registered before /:sessionId so "mine" isn't captured as an id.

sessions.get('/mine', async (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const row = await findActiveSessionForUser(c.env.DB, payload.uid);
  if (!row) return c.json({ error: 'No active session' }, 404);

  return c.json(serializeSession(row));
});

// ── GET /api/sessions/:sessionId ──────────────────────────────────────────────

sessions.get('/:sessionId', async (c) => {
  const result = await loadOwnedSession(c, c.req.param('sessionId'));
  if (!result.ok) return result.response;
  return c.json(serializeSession(result.session));
});

// ── PATCH /api/sessions/:sessionId — optimistic-concurrency partial update ──

sessions.patch('/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const authResult = await loadOwnedSession(c, sessionId);
  if (!authResult.ok) return authResult.response;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = updateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }
  const p = parsed.data;

  // Server-side enforcement of shared business rules (docs/ARCHITECTURE_DECISION_RECORDS.md
  // M2-D): a step cannot be marked "completed" if its own data doesn't pass
  // the same validation the client already runs. This does not touch the
  // legacy /api/submit-onboarding endpoint or its payloads — it only applies
  // to this new, previously-nonexistent API surface.
  if (p.stepStates) {
    const packet = getPacket(authResult.session.packet_id);
    if (!packet) {
      return c.json({ error: `Session references an unknown packet: ${authResult.session.packet_id}` }, 500);
    }

    let storedFormData: Record<string, unknown>;
    try {
      storedFormData = JSON.parse(authResult.session.form_data_json || '{}');
    } catch {
      storedFormData = {};
    }
    const effectiveFormData = withDefaults({ ...storedFormData, ...(p.formData ?? {}) });

    for (const [stepId, status] of Object.entries(p.stepStates)) {
      if (status !== 'completed') continue;
      const step = packet.steps.find((s) => s.id === stepId);
      if (!step) {
        return c.json({ error: `Unknown step id for this packet: ${stepId}` }, 422);
      }
      const valid = isStepValid(stepId, effectiveFormData, step);
      if (!valid) {
        return c.json({ error: `Step "${stepId}" cannot be marked completed — its data does not pass validation`, field: stepId }, 422);
      }
    }
  }

  // user_id is bound directly into the UPDATE's WHERE clause (not just
  // checked above) — see updateSessionWithRevision's own doc comment for why
  // this defense-in-depth matters even though loadOwnedSession already
  // confirmed ownership.
  const updateResult = await updateSessionWithRevision(c.env.DB, {
    sessionId,
    expectedRevision: p.revision,
    ownerUserId: payload.uid,
    firstName: p.firstName,
    lastName: p.lastName,
    email: p.email,
    phone: p.phone,
    stepStatesJson: p.stepStates ? JSON.stringify(p.stepStates) : undefined,
    formDataJson: p.formData ? JSON.stringify(p.formData) : undefined,
  });

  if (updateResult.ok) {
    return c.json(serializeSession(updateResult.session));
  }

  if (updateResult.reason === 'not_found') {
    return c.json({ error: 'Session not found' }, 404);
  }

  // Stale revision: never overwrite — return the current state so the client
  // can reconcile (re-fetch, re-apply its in-flight edits, or prompt the
  // user), per the mandatory optimistic-concurrency policy in ADR-011.
  return c.json(
    {
      error: 'Conflict',
      message: 'This session was updated elsewhere since you last read it.',
      currentRevision: updateResult.current.revision,
      current: serializeSession(updateResult.current),
    },
    409,
  );
});
