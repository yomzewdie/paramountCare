import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import { requireApplicant } from '../middleware/requireApplicant';
import { createSessionSchema, updateSessionSchema, associateDocumentSchema, removeDocumentSchema, submitSessionSchema } from '../schemas/sessions';
import { generateSessionId } from '../utils/sessionId';
import {
  MAX_ATTACHMENTS_PER_DOCUMENT,
  RESUME_DOC_TYPE,
  allowsMultipleAttachments,
  documentAttachmentsFor,
  getPacket,
  isApplicantDocType,
  isStepValid,
  computeOverallCompletion,
  defaultFormData,
  withDocumentAttachments,
  docTypesForRequirement,
  requiredDocumentGroups,
  requirementForDocType,
  type OnboardingFormData,
  type UploadedFile,
} from '@pcs/shared';
import {
  insertSessionOrGetExisting,
  findSessionById,
  findActiveSessionForUser,
  updateSessionWithRevision,
  type OnboardingSessionRow,
} from '../db/queries/onboardingSessions';
import { findOwnedUpload, findSlotDocuments, associateUploadToSlot } from '../db/queries/uploadedDocuments';
import { deleteOwnedUpload } from '../services/documents';
import { RESUME_CONTENT_TYPES } from './uploads';
import { submitSession } from '../services/submission';
import { findClinicianRecordByUserId } from '../db/queries/clinicianRecords';
import { isObjectPromoted } from '../db/queries/documents';
import { reconcileCorrectionDocuments } from '../services/corrections';
import { hasOpenCorrection, openCorrections, recordApplicantDocumentChange } from '../services/documentReviews';
import { ensureCandidateResumePromoted } from '../services/candidates';

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

// ── Targeted corrections after submission ────────────────────────────────────
//
// The one exception to post-submission immutability: when a recruiter asks
// for a correction (document_reviews.correction_open), the applicant may
// change the files of THAT document requirement — and nothing else. Every
// other answer and document stays locked, enforced here per request; the
// application itself is the same one (no resubmission, no regenerated I-9 or
// W-4). The application's documents follow the session's (services/
// corrections.ts): a new file becomes current; a replaced or removed submitted
// file is kept, marked superseded, never deleted.
type DocumentAccess = 'editable' | 'correction' | 'locked';

async function documentAccess(db: D1Database, session: OnboardingSessionRow, docType: string): Promise<DocumentAccess> {
  if (session.status !== 'submitted') return 'editable';
  const record = session.user_id !== null ? await findClinicianRecordByUserId(db, session.user_id) : null;
  return record && (await hasOpenCorrection(db, record.id, docType)) ? 'correction' : 'locked';
}

function leavesRequiredDocumentEmpty(session: OnboardingSessionRow, nextFormData: Record<string, unknown>, docType: string): boolean {
  const packet = getPacket(session.packet_id);
  const requirement = requirementForDocType(docType);
  if (!packet || !requiredDocumentGroups(packet, nextFormData).some((g) => g.key === requirement)) return false;
  return docTypesForRequirement(requirement).every((type) => documentAttachmentsFor(nextFormData, type).length === 0);
}

/** A file no longer part of a requirement is deleted — unless it was
 * submitted: that is kept, and recorded as superseded by the reconciliation. */
async function retireDocument(env: AppEnv['Bindings'], p: { objectKey: string; userId: number }): Promise<void> {
  if (await isObjectPromoted(env.DB, p.objectKey)) return;
  const cleanup = await deleteOwnedUpload(env, { objectKey: p.objectKey, userId: p.userId });
  if (!cleanup.ok) console.error(`[sessions] best-effort delete of ${p.objectKey} failed: ${cleanup.reason}`);
}

/** Brings the application's documents in step with a corrected session
 * (services/corrections.ts). Never fails the request: whatever didn't apply
 * is repaired the next time the applicant or an admin looks. */
async function reconcileAfterCorrection(db: D1Database, session: OnboardingSessionRow): Promise<void> {
  try {
    const record = session.user_id !== null ? await findClinicianRecordByUserId(db, session.user_id) : null;
    if (record) await reconcileCorrectionDocuments(db, session, record.id);
  } catch (e) {
    console.error('[sessions] correction document reconciliation failed; it is retried on the next request:', e);
  }
}

/** Applies a document change to the recruiter's review: a reviewed
 * requirement goes back to Pending (audited). Never fails the request. */
async function afterDocumentChange(db: D1Database, session: OnboardingSessionRow, docType: string): Promise<void> {
  try {
    const record = session.user_id !== null ? await findClinicianRecordByUserId(db, session.user_id) : null;
    if (record) await recordApplicantDocumentChange(db, { clinicianId: record.id, docType, applicationId: session.application_id, sessionId: session.session_id });
  } catch (e) {
    console.error('[sessions] document review reset failed after a document change:', e);
  }
}

// ── Server-owned formData keys ───────────────────────────────────────────────
//
// Every document reference is written ONLY by the ownership-verified document
// routes below, each backed by the upload ledger. The generic PATCH replaces
// formData wholesale, and clients legitimately re-send everything they last
// read — including these keys — so a client's value is not an error, just
// never used: what is stored always wins. A client therefore can't fabricate a
// document, point at someone else's file, or complete a document step without
// a real upload, and installed builds keep working unchanged.
const SERVER_OWNED_FORM_DATA_KEYS = [
  'resumeDocument',
  'uploadedDocuments',
  'vaccineProofDocuments',
  'directDepositProofDocument',
  'documentAttachments',
] as const;

function withServerOwnedKeys(incoming: Record<string, unknown>, stored: Record<string, unknown>): Record<string, unknown> {
  const out = { ...incoming };
  for (const key of SERVER_OWNED_FORM_DATA_KEYS) {
    if (key in stored) out[key] = stored[key];
    else delete out[key];
  }
  return out;
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

  // An applicant invited with "Use existing resume for onboarding" has that
  // resume as their own (services/candidates.ts) — on a new session, or on a
  // later visit if an earlier attempt didn't finish.
  const session = await ensureCandidateResumePromoted(c.env, { userId: payload.uid, session: insertResult.session });

  return c.json(serializeSession(session), insertResult.created ? 201 : 200);
});

// ── GET /api/sessions/:sessionId/corrections ─────────────────────────────────
//
// Documents a recruiter asked this applicant to correct, with the reason —
// read-only: only the Admin Portal can change a review.
sessions.get('/:sessionId/corrections', async (c) => {
  const result = await loadOwnedSession(c, c.req.param('sessionId'));
  if (!result.ok) return result.response;
  const record = result.session.user_id !== null ? await findClinicianRecordByUserId(c.env.DB, result.session.user_id) : null;
  if (record && result.session.status === 'submitted') await reconcileAfterCorrection(c.env.DB, result.session);
  return c.json({ corrections: record ? await openCorrections(c.env.DB, record.id) : [] });
});

// ── GET /api/sessions/mine — resume entry point after logging in ────────────
// Must be registered before /:sessionId so "mine" isn't captured as an id.

sessions.get('/mine', async (c) => {
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const row = await findActiveSessionForUser(c.env.DB, payload.uid);
  if (!row) return c.json({ error: 'No active session' }, 404);

  return c.json(serializeSession(await ensureCandidateResumePromoted(c.env, { userId: payload.uid, session: row })));
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
  let storedFormData: Record<string, unknown>;
  try {
    storedFormData = JSON.parse(authResult.session.form_data_json || '{}');
  } catch {
    storedFormData = {};
  }
  const incomingFormData = p.formData ? withServerOwnedKeys(p.formData, storedFormData) : undefined;

  if (p.stepStates) {
    const packet = getPacket(authResult.session.packet_id);
    if (!packet) {
      return c.json({ error: `Session references an unknown packet: ${authResult.session.packet_id}` }, 500);
    }

    const effectiveFormData = withDefaults({ ...storedFormData, ...(incomingFormData ?? {}) });

    // Clients re-send the FULL stepStates on every save (see mobile's
    // stepPatch.ts), so every previously-completed step is re-checked here
    // on every save of any step. When validation rules tighten (UAT
    // feedback: fixed-choice employment fields, supervisorTitle on
    // references), a step completed under the old rules would otherwise
    // block every unrelated save in that session. A step that was ALREADY
    // 'completed' in storage and was ALREADY invalid against the stored data
    // is that pre-existing condition, not something this request introduced
    // — it is not re-rejected here. Newly completing a step, or turning a
    // still-valid completed step invalid, is rejected exactly as before, and
    // final submission (services/submission.ts) still re-validates every
    // required step, so such a step must be fixed before submitting.
    let storedStepStates: Record<string, string> = {};
    try {
      storedStepStates = JSON.parse(authResult.session.step_states_json || '{}');
    } catch {
      storedStepStates = {};
    }
    const storedEffectiveFormData = withDefaults(storedFormData);

    for (const [stepId, status] of Object.entries(p.stepStates)) {
      if (status !== 'completed') continue;
      const step = packet.steps.find((s) => s.id === stepId);
      if (!step) {
        return c.json({ error: `Unknown step id for this packet: ${stepId}` }, 422);
      }
      const valid = isStepValid(stepId, effectiveFormData, step);
      if (!valid) {
        const preExistingInvalidCompletion =
          storedStepStates[stepId] === 'completed' && !isStepValid(stepId, storedEffectiveFormData, step);
        if (preExistingInvalidCompletion) continue;
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
    formDataJson: incomingFormData ? JSON.stringify(incomingFormData) : undefined,
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
// An explicit allow-list of document requirements (@pcs/shared's
// isApplicantDocType), not a generic "write to any formData key the client
// names" endpoint. Each requirement is a group of attachments, read and
// written through documentAttachments.ts; a single attachment is stored
// exactly as it always has been. See docs/ARCHITECTURE_DECISION_RECORDS.md
// ADR-026.
interface DocumentFileMeta extends UploadedFile {
  objectKey: string;
  uploadedAt: string;
}

// Slot-specific file types, checked against the type the upload ledger
// recorded (never anything client-supplied at association time).
// `/api/uploads` is slot-agnostic, so every slot is restricted here: the
// resume accepts PDF, DOC, or DOCX (a document, never a photo); every other
// slot keeps the PDF/JPG/PNG set it has always had. DOC/DOCX files are only
// ever stored and handed back as downloads — never parsed, converted,
// rendered, or executed by the Worker.
const DEFAULT_DOC_TYPE_CONTENT_TYPES: ReadonlySet<string> = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const DOC_TYPE_ALLOWED_CONTENT_TYPES: Record<string, ReadonlySet<string>> = {
  [RESUME_DOC_TYPE]: new Set(RESUME_CONTENT_TYPES),
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

  if (!isApplicantDocType(docType)) return c.json({ error: `Unknown document type: ${docType}` }, 422);

  const authResult = await loadOwnedSession(c, sessionId);
  if (!authResult.ok) return authResult.response;
  const access = await documentAccess(c.env.DB, authResult.session, docType);
  if (access === 'locked') return rejectIfSubmitted(authResult.session)!;

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

  // Left unassociated (not deleted) on rejection: the applicant still owns
  // the object, and the client's own orphan cleanup removes it.
  const allowedTypes = DOC_TYPE_ALLOWED_CONTENT_TYPES[docType] ?? DEFAULT_DOC_TYPE_CONTENT_TYPES;
  if (!allowedTypes.has(owned.content_type)) {
    return c.json(
      {
        error: docType === RESUME_DOC_TYPE
          ? 'Your resume must be a PDF, DOC, or DOCX file.'
          : 'This document must be a PDF, JPG, or PNG file.',
      },
      415,
    );
  }

  const { mode, replaceObjectKey, objectKey } = parsed.data;
  const keepsOtherAttachments = mode === 'add' || !!replaceObjectKey;

  if (keepsOtherAttachments && !allowsMultipleAttachments(docType)) {
    return c.json({ error: 'This document accepts a single file.' }, 422);
  }
  // A file already attached to a different requirement stays where it is.
  if (keepsOtherAttachments && owned.doc_type && owned.doc_type !== docType) {
    return c.json({ error: 'This file is already attached to another document.' }, 422);
  }

  let storedFormData: Record<string, unknown>;
  try {
    storedFormData = JSON.parse(authResult.session.form_data_json || '{}');
  } catch {
    storedFormData = {};
  }

  const current = documentAttachmentsFor(storedFormData, docType);
  const newFile = toFileMeta(owned);
  let nextFiles: UploadedFile[];
  if (replaceObjectKey) {
    if (!current.some((f) => f.objectKey === replaceObjectKey)) {
      return c.json({ error: 'The attachment to replace was not found.' }, 404);
    }
    nextFiles = current.map((f) => (f.objectKey === replaceObjectKey ? newFile : f));
  } else if (mode === 'add') {
    // A retry of an association whose response was lost is a no-op, not a duplicate.
    nextFiles = current.some((f) => f.objectKey === objectKey) ? current : [...current, newFile];
  } else {
    nextFiles = [newFile];
  }
  if (nextFiles.length > MAX_ATTACHMENTS_PER_DOCUMENT) {
    return c.json({ error: `A document can have at most ${MAX_ATTACHMENTS_PER_DOCUMENT} attachments.` }, 422);
  }

  // What this leaves behind, read BEFORE any writes — these are the objects
  // to clean up, and only once the new file is safely saved. Nothing else in
  // the requirement is touched: adding removes nothing, and replacing one
  // attachment removes only that one.
  const staleKeys = mode === 'add'
    ? []
    : replaceObjectKey
      ? [replaceObjectKey]
      : (await findSlotDocuments(c.env.DB, { sessionId, docType })).map((row) => row.object_key);

  const nextFormData = withDocumentAttachments(storedFormData, docType, nextFiles);

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
    await associateUploadToSlot(c.env.DB, { objectKey, sessionId, docType });
  } catch (e) {
    console.error('[sessions] slot bookkeeping update failed after successful association:', e);
  }

  // A correction to a submitted requirement: the application's documents now
  // follow the session (the new file current, a replaced one superseded).
  if (access === 'correction') await reconcileAfterCorrection(c.env.DB, updateResult.session);

  for (const staleKey of staleKeys) {
    if (staleKey === objectKey) continue;
    await retireDocument(c.env, { objectKey: staleKey, userId: payload.uid });
  }
  await afterDocumentChange(c.env.DB, authResult.session, docType);

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

  if (!isApplicantDocType(docType)) return c.json({ error: `Unknown document type: ${docType}` }, 422);

  const authResult = await loadOwnedSession(c, sessionId);
  if (!authResult.ok) return authResult.response;
  const access = await documentAccess(c.env.DB, authResult.session, docType);
  if (access === 'locked') return rejectIfSubmitted(authResult.session)!;

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

  let storedFormData: Record<string, unknown>;
  try {
    storedFormData = JSON.parse(authResult.session.form_data_json || '{}');
  } catch {
    storedFormData = {};
  }

  // With an objectKey, exactly that attachment goes and the rest stay;
  // without one, the whole requirement is cleared.
  const removeOneKey = parsed.data.objectKey;
  const currentFiles = documentAttachmentsFor(storedFormData, docType);
  if (removeOneKey && !currentFiles.some((f) => f.objectKey === removeOneKey)) {
    return c.json({ error: 'The attachment to remove was not found.' }, 404);
  }
  const removedKeys = removeOneKey
    ? [removeOneKey]
    : (await findSlotDocuments(c.env.DB, { sessionId, docType })).map((row) => row.object_key);
  const nextFormData = withDocumentAttachments(
    storedFormData,
    docType,
    removeOneKey ? currentFiles.filter((f) => f.objectKey !== removeOneKey) : [],
  );
  // A correction to a submitted application fixes a required document; it
  // never leaves one empty (an optional one may simply be removed).
  if (access === 'correction' && leavesRequiredDocumentEmpty(authResult.session, nextFormData, docType)) {
    return c.json({ error: 'Upload the corrected document before removing the last file — this document is required.' }, 422);
  }

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

  if (access === 'correction') await reconcileAfterCorrection(c.env.DB, updateResult.session);
  for (const removedKey of removedKeys) {
    await retireDocument(c.env, { objectKey: removedKey, userId: payload.uid });
  }
  await afterDocumentChange(c.env.DB, authResult.session, docType);

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
