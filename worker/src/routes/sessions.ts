import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import { requireApplicant } from '../middleware/requireApplicant';
import { createSessionSchema, updateSessionSchema, associateDocumentSchema, removeDocumentSchema, submitSessionSchema } from '../schemas/sessions';
import { generateSessionId } from '../utils/sessionId';
import {
  getPacket,
  isStepValid,
  computeOverallCompletion,
  defaultFormData,
  type OnboardingFormData,
} from '@pcs/shared';
import {
  insertSessionOrGetExisting,
  findSessionById,
  findActiveSessionForUser,
  updateSessionWithRevision,
  type OnboardingSessionRow,
} from '../db/queries/onboardingSessions';
import { findOwnedUpload, findCurrentSlotDocument, associateUploadToSlot } from '../db/queries/uploadedDocuments';
import { deleteOwnedUpload } from '../services/documents';
import { submitSession } from '../services/submission';

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
  const completionPercent = packet ? computeOverallCompletion(packet, withDefaults(formData)) : null;

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

// ── Post-submission immutability (M16 hardening, ADR-029 addendum) ─────────
//
// `applications.payload_json` is a submitted SNAPSHOT (ADR-029 §9) — that
// architecture only actually holds if the session it was taken from can no
// longer drift underneath it. Every applicant-facing route that can change
// `form_data_json`, `step_states_json`, or a document association/removal
// must refuse once `status === 'submitted'`, server-side, unconditionally —
// never inferred from the mobile UI hiding Edit buttons or disabling a
// button (a client can always call these routes directly). Checked BEFORE
// any revision logic, so a request against a submitted session is refused
// the same way regardless of whether its revision happens to still match —
// this is a state check, not a concurrency check, and must not be
// conflated with the existing 409 "someone else edited this" conflict
// (though it reuses the same status code and response shape, since a
// submitted session update is very much “state conflict” to the caller,
// and the client already knows how to react to a 409: re-read the
// authoritative session and stop trying to apply its stale edit — a
// distinct `reason: 'submitted'` field lets a caller tell the two apart
// without needing a whole new response shape).
function rejectIfSubmitted(session: OnboardingSessionRow): Response | null {
  if (session.status !== 'submitted') return null;
  return Response.json(
    {
      error: 'Conflict',
      reason: 'submitted',
      message: 'This application has already been submitted and can no longer be edited.',
      current: serializeSession(session),
    },
    { status: 409 },
  );
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
  //
  // Race-safe across devices (ADR-018 §2): insertSessionOrGetExisting relies
  // on the database's idx_sessions_user_id_unique partial unique index
  // (migrations/0005), not a GET-first-then-INSERT check here — two
  // concurrent calls for the same applicant can never both create a row.
  // The call that loses the race gets the winning row back with 200, not an
  // error; the call that wins gets 201. Either way the caller ends up with a
  // valid, usable, authoritative session.
  const insertResult = await insertSessionOrGetExisting(c.env.DB, {
    sessionId: generateSessionId(),
    packetId: packet.id,
    packetVersion: packet.version,
    userId: payload.uid,
  });

  return c.json(serializeSession(insertResult.session), insertResult.created ? 201 : 200);
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
  const submittedBlock = rejectIfSubmitted(authResult.session);
  if (submittedBlock) return submittedBlock;

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

// ── Document slots — M13 hardening ──────────────────────────────────────────
//
// A tiny, explicit allow-list of (docType -> where it lives in formData),
// not a generic "write to any formData key the client names" endpoint —
// adding a future document type (e.g. a `documents` step credential slot)
// is one more map entry, not a redesign. See docs/ARCHITECTURE_DECISION_RECORDS.md
// ADR-026.
interface DocumentFileMeta {
  name: string;
  size: number;
  type: string;
  objectKey: string;
  uploadedAt: string;
}

// M14: the `documents` step (License & Credential Uploads) needs five more
// slots, each nested under `formData.uploadedDocuments` rather than a
// top-level field — this small helper is the only thing new, the map/route
// logic around it is unchanged. docType strings match the naming already
// anticipated (unused, until now) by application_documents.doc_type's own
// comment in migrations/0002_phase1.sql.
function applyUploadedDocumentsField(
  formData: Record<string, unknown>,
  field: 'listA' | 'listB' | 'listC' | 'nursingLicense' | 'cprCertification',
  file: DocumentFileMeta | null,
): Record<string, unknown> {
  const existing = (formData.uploadedDocuments as Record<string, unknown> | undefined) ?? {};
  return { ...formData, uploadedDocuments: { ...existing, [field]: file } };
}

const DOC_TYPE_APPLIERS: Record<
  string,
  (formData: Record<string, unknown>, file: DocumentFileMeta | null) => Record<string, unknown>
> = {
  direct_deposit_voided_check: (formData, file) => ({ ...formData, directDepositProofDocument: file }),
  list_a:           (formData, file) => applyUploadedDocumentsField(formData, 'listA', file),
  list_b:           (formData, file) => applyUploadedDocumentsField(formData, 'listB', file),
  list_c:           (formData, file) => applyUploadedDocumentsField(formData, 'listC', file),
  nursing_license:  (formData, file) => applyUploadedDocumentsField(formData, 'nursingLicense', file),
  cpr_cert:         (formData, file) => applyUploadedDocumentsField(formData, 'cprCertification', file),
};

function toFileMeta(row: { file_name: string; file_size: number; content_type: string; object_key: string; uploaded_at: string }): DocumentFileMeta {
  return { name: row.file_name, size: row.file_size, type: row.content_type, objectKey: row.object_key, uploadedAt: row.uploaded_at };
}

// ── POST /api/sessions/:sessionId/documents/:docType — associate ───────────
//
// Separate from the generic PATCH above on purpose: associating an uploaded
// object requires a server-side ownership check the generic PATCH has no
// way to perform on an arbitrary formData blob (see services/documents.ts).
// Uses the exact same revision-protected update as PATCH underneath, so
// normal 409 conflict handling applies unchanged.
sessions.post('/:sessionId/documents/:docType', async (c) => {
  const sessionId = c.req.param('sessionId');
  const docType = c.req.param('docType');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const applier = DOC_TYPE_APPLIERS[docType];
  if (!applier) return c.json({ error: `Unknown document type: ${docType}` }, 422);

  const authResult = await loadOwnedSession(c, sessionId);
  if (!authResult.ok) return authResult.response;
  const submittedBlock = rejectIfSubmitted(authResult.session);
  if (submittedBlock) return submittedBlock;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = associateDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  // Ownership: the object must have been uploaded by THIS authenticated
  // user via a real prior POST /api/uploads — never trust the objectKey
  // string alone ("object-key secrecy is never treated as authorization").
  // A 403, not 404: the session itself was already confirmed to exist and
  // be owned above; this is refusing permission over a specific input
  // value, which covers cross-user objects, forged/never-uploaded keys, and
  // already-deleted objects identically (findOwnedUpload can't distinguish
  // them, by design — there is nothing more specific to safely disclose).
  const owned = await findOwnedUpload(c.env.DB, { objectKey: parsed.data.objectKey, userId: payload.uid });
  if (!owned) {
    return c.json({ error: 'This file was not found or does not belong to you. Please upload it again.' }, 403);
  }

  // Whatever currently occupies this slot, read BEFORE any writes — this is
  // the object to clean up, and only once the new one is safely saved.
  const previous = await findCurrentSlotDocument(c.env.DB, { sessionId, docType });

  let storedFormData: Record<string, unknown>;
  try {
    storedFormData = JSON.parse(authResult.session.form_data_json || '{}');
  } catch {
    storedFormData = {};
  }
  const nextFormData = applier(storedFormData, toFileMeta(owned));

  const updateResult = await updateSessionWithRevision(c.env.DB, {
    sessionId,
    expectedRevision: parsed.data.revision,
    ownerUserId: payload.uid,
    formDataJson: JSON.stringify(nextFormData),
  });

  if (!updateResult.ok) {
    if (updateResult.reason === 'not_found') return c.json({ error: 'Session not found' }, 404);
    // Nothing has been written yet at this point — the slot-bookkeeping
    // update below only happens after this succeeds — so a stale revision
    // here leaves the newly uploaded object simply unassociated, exactly
    // like a failed association should (M13 hardening §7).
    return c.json(
      {
        error: 'Conflict',
        message: 'This session was updated elsewhere since you last read it.',
        currentRevision: updateResult.current.revision,
        current: serializeSession(updateResult.current),
      },
      409,
    );
  }

  // Only now — the new object is safely, authoritatively associated with
  // the session — record it as occupying this slot and clean up whatever
  // used to be here. Either step failing is logged and best-effort; it
  // never turns an already-successful association into a failure response
  // (M13 hardening §4: never roll back a successful replace).
  try {
    await associateUploadToSlot(c.env.DB, { objectKey: parsed.data.objectKey, sessionId, docType });
  } catch (e) {
    console.error('[sessions] slot bookkeeping update failed after successful association:', e);
  }

  if (previous && previous.object_key !== parsed.data.objectKey) {
    const cleanup = await deleteOwnedUpload(c.env, { objectKey: previous.object_key, userId: payload.uid });
    if (!cleanup.ok) {
      console.error(`[sessions] best-effort cleanup of replaced document ${previous.object_key} failed: ${cleanup.reason}`);
    }
  }

  return c.json(serializeSession(updateResult.session), 200);
});

// ── DELETE /api/sessions/:sessionId/documents/:docType — remove ────────────
//
// Ordering prioritizes consistency over storage tidiness (M13 hardening
// §5): the session is updated to no longer reference this slot FIRST; the
// actual R2/D1 deletion happens only after that succeeds. A temporarily
// orphaned R2 object is an accepted, documented risk — the session ever
// pointing at an object that has already been deleted is not.
sessions.delete('/:sessionId/documents/:docType', async (c) => {
  const sessionId = c.req.param('sessionId');
  const docType = c.req.param('docType');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const applier = DOC_TYPE_APPLIERS[docType];
  if (!applier) return c.json({ error: `Unknown document type: ${docType}` }, 422);

  const authResult = await loadOwnedSession(c, sessionId);
  if (!authResult.ok) return authResult.response;
  const submittedBlock = rejectIfSubmitted(authResult.session);
  if (submittedBlock) return submittedBlock;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = removeDocumentSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  const current = await findCurrentSlotDocument(c.env.DB, { sessionId, docType });

  let storedFormData: Record<string, unknown>;
  try {
    storedFormData = JSON.parse(authResult.session.form_data_json || '{}');
  } catch {
    storedFormData = {};
  }
  const nextFormData = applier(storedFormData, null);

  const updateResult = await updateSessionWithRevision(c.env.DB, {
    sessionId,
    expectedRevision: parsed.data.revision,
    ownerUserId: payload.uid,
    formDataJson: JSON.stringify(nextFormData),
  });

  if (!updateResult.ok) {
    if (updateResult.reason === 'not_found') return c.json({ error: 'Session not found' }, 404);
    return c.json(
      {
        error: 'Conflict',
        message: 'This session was updated elsewhere since you last read it.',
        currentRevision: updateResult.current.revision,
        current: serializeSession(updateResult.current),
      },
      409,
    );
  }

  if (current) {
    const cleanup = await deleteOwnedUpload(c.env, { objectKey: current.object_key, userId: payload.uid });
    if (!cleanup.ok) {
      console.error(`[sessions] best-effort delete of removed document ${current.object_key} failed: ${cleanup.reason}`);
    }
  }

  return c.json(serializeSession(updateResult.session), 200);
});

// ── POST /api/sessions/:sessionId/submit — final application submission ────
//
// M16 (ADR-029). Deliberately its own dedicated route, not "PATCH
// stepStates.review = completed" through the generic PATCH above: that
// path's own per-step validation only checks the ONE step being set, which
// for `type: 'review'` is unconditionally valid (validateStep returns {}
// for it) — it has no way to enforce "every OTHER required step in the
// packet is actually done." Real packet-wide completeness, document
// promotion, and the application-row creation all happen here, together,
// server-authoritatively — see services/submission.ts for the full design.
sessions.post('/:sessionId/submit', async (c) => {
  const sessionId = c.req.param('sessionId');
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const parsed = submitSessionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  const result = await submitSession(c.env, {
    sessionId,
    expectedRevision: parsed.data.revision,
    ownerUserId: payload.uid,
  });

  switch (result.kind) {
    case 'submitted':
      return c.json({ applicationId: result.applicationId, submittedAt: result.submittedAt, alreadySubmitted: false }, 201);

    case 'already_submitted':
      // Same shape as a fresh success — a retry, a double tap, or reopening
      // this screen after submitting must all land on the identical
      // confirmation state, not an error.
      return c.json({ applicationId: result.applicationId, submittedAt: null, alreadySubmitted: true }, 200);

    case 'incomplete':
      return c.json(
        {
          error: 'Your application is not ready to submit yet.',
          incompleteSteps: result.incompleteSteps,
        },
        422,
      );

    case 'not_found':
      return c.json({ error: 'Session not found' }, 404);

    case 'unknown_packet':
      return c.json({ error: `Session references an unknown packet` }, 500);

    case 'conflict':
      return c.json(
        {
          error: 'Conflict',
          message: 'This session was updated elsewhere since you last read it.',
          currentRevision: result.current.revision,
          current: serializeSession(result.current),
        },
        409,
      );

    case 'error':
      return c.json({ error: result.message }, 500);
  }
});
