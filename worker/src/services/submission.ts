import {
  getPacket,
  isStepValid,
  defaultFormData,
  type OnboardingFormData,
  type DirectDepositBankAccount,
  type StepStates,
} from '@pcs/shared';
import { generateApplicationId } from '../utils/applicationId';
import { generateI9Pdf, type I9PdfInput } from '../services/i9pdf';
import { generateW4Pdf, type W4PdfInput } from '../services/w4pdf';
import { findSessionById, type OnboardingSessionRow } from '../db/queries/onboardingSessions';
import { findLiveUploadsForSession, type UploadedDocumentRow } from '../db/queries/uploadedDocuments';
import { isDocumentActiveForSubmission, activeVaccineProofDocuments } from './vaccineProof';
import { findApplicationById } from '../db/queries/applications';
import { insertDocumentIfNotExistsStmt, findDocumentsByApplicationId } from '../db/queries/documents';
import { insertAuditLogStmt } from '../db/queries/auditLogs';
import {
  insertApplicationIfEligibleStmt,
  promoteDocumentIfEligibleStmt,
  insertAuditLogIfEligibleStmt,
  submitSessionStmt,
} from '../db/queries/submission';
import { sendApplicantConfirmation, sendAdminNotification } from './email';

export interface SubmissionEnv {
  DB: D1Database;
  UPLOADS_BUCKET: R2Bucket;
  RESEND_API_KEY?: string;
  ADMIN_NOTIFICATION_EMAIL?: string;
}

export interface IncompleteStepInfo {
  id: string;
  label: string;
}

export type SubmitSessionResult =
  | { kind: 'submitted'; applicationId: string; submittedAt: string }
  | { kind: 'already_submitted'; applicationId: string }
  | { kind: 'incomplete'; incompleteSteps: IncompleteStepInfo[] }
  | { kind: 'conflict'; current: OnboardingSessionRow }
  | { kind: 'not_found' }
  | { kind: 'unknown_packet' }
  | { kind: 'error'; message: string };

function withDefaults(formData: Record<string, unknown>): OnboardingFormData {
  return { ...defaultFormData, ...formData } as unknown as OnboardingFormData;
}

/** Never persist a raw SSN, I-9 signature image, or bank account/routing
 * number inside `applications.payload_json` — this is a fresh design
 * decision for this new endpoint's own stored snapshot (see ADR-029 §4),
 * extending (not copying verbatim) the same redaction principle the
 * legacy `/api/submit-onboarding` route already applies to the one
 * sensitive field its own narrower payload happens to carry
 * (`i9Data.ssn`). Mobile's full OnboardingFormData snapshot has two more
 * genuinely sensitive fields the legacy payload never had reason to
 * redact (`w4Data.ssn`, direct deposit bank details) — redacted the same
 * way, not left exposed just because no prior code touched them. */
function redactSensitiveFormData(data: OnboardingFormData): Record<string, unknown> {
  const redactAccount = (acct: DirectDepositBankAccount): DirectDepositBankAccount => ({
    ...acct,
    accountNumber: acct.accountNumber ? '[redacted]' : '',
    routingNumber: acct.routingNumber ? '[redacted]' : '',
  });

  return {
    ...data,
    // Same rule as document promotion: no vaccination-proof reference for a vaccine whose final answer is a declination.
    vaccineProofDocuments: activeVaccineProofDocuments(data.vaccineProofDocuments, data.acknowledgements),
    i9Data: {
      ...data.i9Data,
      ssn: data.i9Data.ssn ? '[redacted]' : '',
      i9SignatureDataUrl: data.i9Data.i9SignatureDataUrl ? '[stored in R2 as signed PDF]' : '',
    },
    w4Data: {
      ...data.w4Data,
      ssn: data.w4Data.ssn ? '[redacted]' : '',
    },
    directDepositData: {
      ...data.directDepositData,
      primaryAccount: redactAccount(data.directDepositData.primaryAccount),
      additionalAccount: redactAccount(data.directDepositData.additionalAccount),
    },
  };
}

interface I9GenerationContext {
  applicationId: string;
  effectiveFormData: OnboardingFormData;
  now: string;
}

/**
 * Renders I-9 PDF bytes — and ONLY renders them; no D1/R2 writes happen
 * here. This is the DETERMINISTIC half of finalization (durability
 * follow-up to M16): given the same applicant data, it either always
 * succeeds or always fails the same way (a rendering/encoding problem —
 * e.g. a legal name outside pdf-lib's WinAnsi-only standard fonts — is
 * not something a retry with IDENTICAL, now-immutable data can ever fix
 * on its own). Being pure with respect to storage/DB state is exactly
 * what makes it safe to call as a PREFLIGHT check before committing the
 * submission at all (see submitSession's own use of this), and safe to
 * call again, unconditionally, on a later repair attempt.
 *
 * Fetches two optional, large, rarely-changing binary assets from R2 —
 * the official I-9 template and a Unicode-capable font — both tolerant
 * of being absent (falls back to the built-in summary layout / WinAnsi
 * standard fonts respectively), matching the one established pattern
 * this codebase already uses for exactly this kind of asset (ops
 * provides it via a one-time `wrangler r2 object put`, never bundled
 * into this Worker's own deployed code — see services/i9pdf.ts).
 */
async function renderI9Pdf(env: SubmissionEnv, ctx: I9GenerationContext): Promise<Uint8Array> {
  let templateBytes: Uint8Array | null = null;
  try {
    const templateObj = await env.UPLOADS_BUCKET.get('templates/i9-2024.pdf');
    if (templateObj) templateBytes = new Uint8Array(await templateObj.arrayBuffer());
  } catch { /* falls back to generateI9Pdf's own default rendering */ }

  let unicodeFontBytes: Uint8Array | null = null;
  try {
    const fontObj = await env.UPLOADS_BUCKET.get('fonts/i9-unicode.ttf');
    if (fontObj) unicodeFontBytes = new Uint8Array(await fontObj.arrayBuffer());
  } catch { /* falls back to WinAnsi standard fonts */ }

  return generateI9Pdf(toI9PdfInput(ctx.effectiveFormData, ctx.applicationId, ctx.now), templateBytes, unicodeFontBytes);
}

export interface PersistI9PdfResult {
  /** False means finalization genuinely failed — the caller must NOT
   * report submission success to the client (see submitSession's own
   * handling). True covers both "already healthy" and "just persisted." */
  ok: boolean;
  /** True only when THIS call is the one that actually created the
   * missing application_documents record (never true for a racing
   * caller that lost the conditional insert, and never true when
   * nothing needed persisting) — the signal submitSession uses to decide
   * whether to send confirmation emails exactly once. */
  changed: boolean;
}

/**
 * Persists ALREADY-RENDERED PDF bytes — the R2 PUT, a race-safe
 * conditional `application_documents` insert, and a best-effort audit
 * log. This is the TRANSIENT half of finalization: once rendering has
 * already succeeded, only storage I/O remains, and storage I/O can fail
 * for reasons a plain retry genuinely can fix (a network blip, a
 * momentary R2/D1 hiccup) — unlike a rendering/encoding failure, which
 * cannot.
 *
 * Race safety: the DB write is a single conditional
 * `INSERT ... WHERE NOT EXISTS (...)` statement
 * (`insertDocumentIfNotExistsStmt` — the same technique
 * `db/queries/submission.ts` already uses for the main batch), not a
 * separate check-then-insert. Two concurrent retries racing to persist
 * the SAME missing artifact can both redundantly PUT bytes to the same
 * deterministic R2 key (R2's own per-object atomicity guarantees no
 * torn/corrupted object either way — a GET always returns one complete
 * write or the other, never a mix), but only ONE of their conditional
 * INSERTs actually creates the `application_documents` row; the other's
 * WHERE NOT EXISTS evaluates false against the just-committed row and
 * affects zero rows. Exactly one logical I-9 document, regardless of how
 * many callers race.
 */
async function persistI9Pdf(
  env: SubmissionEnv,
  p: { applicationId: string; pdfBytes: Uint8Array; effectiveFormData: OnboardingFormData; now: string },
): Promise<PersistI9PdfResult> {
  const i9ObjectKey = `i9/${p.applicationId}/i9-section1-signed.pdf`;
  try {
    // Idempotent no matter who calls this — a fresh winning submission
    // can never have an existing record, but checking costs nothing and
    // means this function is safe to call unconditionally from anywhere.
    const existingDocs = await findDocumentsByApplicationId(env.DB, p.applicationId);
    if (existingDocs.some((d) => d.object_key === i9ObjectKey)) return { ok: true, changed: false };

    await env.UPLOADS_BUCKET.put(i9ObjectKey, p.pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });

    const insertResult = await insertDocumentIfNotExistsStmt(env.DB, {
      applicationId: p.applicationId,
      objectKey: i9ObjectKey,
      fileName: `I9-Section1-${p.applicationId}.pdf`,
      fileSize: p.pdfBytes.byteLength,
      uploadedAt: p.now,
    }).run();

    const won = (insertResult.meta.changes ?? 0) > 0;
    if (won) {
      // Audit logging is best-effort observability, not a correctness
      // dependency — deliberately NOT re-checked for a matching race
      // guard the way the document row itself is: a duplicate audit
      // entry would be harmless noise, but skipping it here (rather than
      // batching it with the conditional insert above) keeps the one
      // statement whose atomicity actually matters simple and provably
      // correct on its own.
      try {
        await insertAuditLogStmt(env.DB, {
          applicationId: p.applicationId,
          action: 'i9_pdf_generated',
          metadataJson: JSON.stringify({ objectKey: i9ObjectKey, signatureType: p.effectiveFormData.i9Data.i9SignatureType }),
          createdAt: p.now,
        }).run();
      } catch (e) {
        console.error('[submission] I-9 PDF audit log insert failed (non-fatal):', e);
      }
    }
    return { ok: true, changed: won };
  } catch (e) {
    console.error('[submission] I-9 PDF persistence failed (transient storage failure — application already submitted, a retry will repair):', e);
    return { ok: false, changed: false };
  }
}

export type EnsureI9PdfResult = PersistI9PdfResult;

/**
 * Repair path for a session that is ALREADY 'submitted' (a retry, a
 * concurrent race loser, or the applicant simply reopening Review):
 * checks whether a healthy I-9 PDF already exists and, if not, re-renders
 * AND persists it from scratch. The object key is fully deterministic
 * (`i9/<applicationId>/i9-section1-signed.pdf`), so existence is always
 * checked first and this is a no-op once healthy.
 *
 * Re-rendering here can, in principle, still hit the same deterministic
 * rendering failure `submitSession`'s own preflight check (see
 * `renderI9Pdf`) is designed to catch before ever reaching this point —
 * but only for a session that somehow became 'submitted' WITHOUT going
 * through that preflight (e.g. one submitted under pre-durability-fix
 * code). For any NEW submission going through the current code path,
 * this repair path only ever needs to recover from a TRANSIENT
 * (persistence) failure, since rendering was already proven to succeed
 * before the session was ever allowed to become submitted.
 */
async function ensureI9PdfGenerated(env: SubmissionEnv, ctx: I9GenerationContext): Promise<EnsureI9PdfResult> {
  const i9ObjectKey = `i9/${ctx.applicationId}/i9-section1-signed.pdf`;

  // Two independent facts, checked separately, because either one can
  // exist without the other after a partial prior failure: the R2 PUT
  // could have succeeded while the follow-up DB write (recording it in
  // application_documents) then failed. Using ONLY the R2 object's
  // existence as the idempotency key would permanently skip repairing
  // that DB gap; using ONLY the DB row would risk re-rendering (wasted
  // work, though harmless) an object that's already there.
  let objectExists = false;
  try {
    objectExists = (await env.UPLOADS_BUCKET.head(i9ObjectKey)) !== null;
  } catch (e) {
    console.error('[submission] I-9 PDF R2 existence check failed (will still attempt generation):', e);
  }
  const existingDocs = await findDocumentsByApplicationId(env.DB, ctx.applicationId);
  const recordExists = existingDocs.some((d) => d.object_key === i9ObjectKey);

  if (objectExists && recordExists) return { ok: true, changed: false }; // fully healthy

  let pdfBytes: Uint8Array;
  if (objectExists) {
    // Repair only the missing DB record — the real PDF bytes already
    // exist and are never regenerated once written.
    try {
      const obj = await env.UPLOADS_BUCKET.get(i9ObjectKey);
      if (!obj) throw new Error('I-9 PDF object reported present by head() but get() returned null');
      pdfBytes = new Uint8Array(await obj.arrayBuffer());
    } catch (e) {
      console.error('[submission] I-9 PDF re-read for DB-only repair failed:', e);
      return { ok: false, changed: false };
    }
  } else {
    try {
      pdfBytes = await renderI9Pdf(env, ctx);
    } catch (e) {
      console.error('[submission] I-9 PDF rendering failed on repair attempt:', e);
      return { ok: false, changed: false };
    }
  }

  return persistI9Pdf(env, { applicationId: ctx.applicationId, pdfBytes, effectiveFormData: ctx.effectiveFormData, now: ctx.now });
}

// ── W-4 finalization ─────────────────────────────────────────────────────────
//
// Mirrors the I-9 finalization functions above exactly in shape and
// invariants (deterministic preflight render / transient persist / race-safe
// idempotent repair) — see each I-9 function's own doc comment for the
// reasoning, which applies here unchanged. Kept as fully separate functions
// and its own context type (rather than reusing I9GenerationContext) so this
// addition never has to modify any I-9 code.
//
// One deliberate difference from I-9: generateW4Pdf has no fallback layout
// and no safe/silent field setters — a missing template or a renamed/
// removed AcroForm field throws immediately (see services/w4pdf.ts's own
// doc comment). renderW4Pdf does not swallow a missing template into a
// null the way renderI9Pdf's own template fetch does; it surfaces the
// R2 miss as a real error instead.
interface W4GenerationContext {
  applicationId: string;
  effectiveFormData: OnboardingFormData;
  now: string;
}

function toW4PdfInput(data: OnboardingFormData, applicationId: string, now: string): W4PdfInput {
  const w4 = data.w4Data;
  return {
    firstNameMI: w4.firstNameMI,
    lastName: w4.lastName,
    ssn: w4.ssn,
    address: w4.address,
    cityStateZip: w4.cityStateZip,
    filingStatus: w4.filingStatus,
    multipleJobs: w4.multipleJobs,
    qualifyingChildren: w4.qualifyingChildren,
    otherDependents: w4.otherDependents,
    totalDependents: w4.totalDependents,
    otherIncome: w4.otherIncome,
    deductions: w4.deductions,
    extraWithholding: w4.extraWithholding,
    exemptFromWithholding: w4.exemptFromWithholding,
    typedSignature: w4.typedSignature,
    signedDate: w4.signedDate,
    applicationId,
    generatedAt: new Date(now).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC',
  };
}

/** Renders W-4 PDF bytes only — no D1/R2 writes. See renderI9Pdf's own doc
 * comment for why a pure rendering step is safe to use as both a preflight
 * check and a later repair attempt. Reuses the SAME `fonts/i9-unicode.ttf`
 * R2 asset I-9 already reads — it is a generic Unicode-capable font for
 * rendering applicant-entered names, not something I-9-specific despite its
 * key name, and provisioning a second identical font under a different key
 * would be pure ops overhead for no benefit. */
async function renderW4Pdf(env: SubmissionEnv, ctx: W4GenerationContext): Promise<Uint8Array> {
  const templateObj = await env.UPLOADS_BUCKET.get('templates/w4-2026.pdf');
  if (!templateObj) {
    throw new Error('W-4 template (templates/w4-2026.pdf) is not present in R2 — cannot generate the official W-4 PDF.');
  }
  const templateBytes = new Uint8Array(await templateObj.arrayBuffer());

  let unicodeFontBytes: Uint8Array | null = null;
  try {
    const fontObj = await env.UPLOADS_BUCKET.get('fonts/i9-unicode.ttf');
    if (fontObj) unicodeFontBytes = new Uint8Array(await fontObj.arrayBuffer());
  } catch { /* falls back to WinAnsi standard fonts */ }

  return generateW4Pdf(toW4PdfInput(ctx.effectiveFormData, ctx.applicationId, ctx.now), templateBytes, unicodeFontBytes);
}

export type PersistW4PdfResult = PersistI9PdfResult;

/** Persists already-rendered W-4 PDF bytes. See persistI9Pdf's own doc
 * comment for the race-safety argument (a single conditional
 * `INSERT ... WHERE NOT EXISTS`) — identical here, just against the W-4
 * object key. */
async function persistW4Pdf(
  env: SubmissionEnv,
  p: { applicationId: string; pdfBytes: Uint8Array; now: string },
): Promise<PersistW4PdfResult> {
  const w4ObjectKey = `w4/${p.applicationId}/w4-2026-signed.pdf`;
  try {
    const existingDocs = await findDocumentsByApplicationId(env.DB, p.applicationId);
    if (existingDocs.some((d) => d.object_key === w4ObjectKey)) return { ok: true, changed: false };

    await env.UPLOADS_BUCKET.put(w4ObjectKey, p.pdfBytes, { httpMetadata: { contentType: 'application/pdf' } });

    const insertResult = await insertDocumentIfNotExistsStmt(env.DB, {
      applicationId: p.applicationId,
      objectKey: w4ObjectKey,
      fileName: `W4-${p.applicationId}.pdf`,
      fileSize: p.pdfBytes.byteLength,
      uploadedAt: p.now,
    }).run();

    const won = (insertResult.meta.changes ?? 0) > 0;
    if (won) {
      try {
        await insertAuditLogStmt(env.DB, {
          applicationId: p.applicationId,
          action: 'w4_pdf_generated',
          metadataJson: JSON.stringify({ objectKey: w4ObjectKey }),
          createdAt: p.now,
        }).run();
      } catch (e) {
        console.error('[submission] W-4 PDF audit log insert failed (non-fatal):', e);
      }
    }
    return { ok: true, changed: won };
  } catch (e) {
    console.error('[submission] W-4 PDF persistence failed (transient storage failure — application already submitted, a retry will repair):', e);
    return { ok: false, changed: false };
  }
}

export type EnsureW4PdfResult = PersistW4PdfResult;

/** Repair path for a session that is ALREADY 'submitted' — see
 * ensureI9PdfGenerated's own doc comment for the full reasoning (identical
 * here): checks R2 object existence and the DB record independently, since
 * either can exist without the other after a partial prior failure, and
 * only re-renders/re-persists whichever half is actually missing. */
async function ensureW4PdfGenerated(env: SubmissionEnv, ctx: W4GenerationContext): Promise<EnsureW4PdfResult> {
  const w4ObjectKey = `w4/${ctx.applicationId}/w4-2026-signed.pdf`;

  let objectExists = false;
  try {
    objectExists = (await env.UPLOADS_BUCKET.head(w4ObjectKey)) !== null;
  } catch (e) {
    console.error('[submission] W-4 PDF R2 existence check failed (will still attempt generation):', e);
  }
  const existingDocs = await findDocumentsByApplicationId(env.DB, ctx.applicationId);
  const recordExists = existingDocs.some((d) => d.object_key === w4ObjectKey);

  if (objectExists && recordExists) return { ok: true, changed: false };

  let pdfBytes: Uint8Array;
  if (objectExists) {
    try {
      const obj = await env.UPLOADS_BUCKET.get(w4ObjectKey);
      if (!obj) throw new Error('W-4 PDF object reported present by head() but get() returned null');
      pdfBytes = new Uint8Array(await obj.arrayBuffer());
    } catch (e) {
      console.error('[submission] W-4 PDF re-read for DB-only repair failed:', e);
      return { ok: false, changed: false };
    }
  } else {
    try {
      pdfBytes = await renderW4Pdf(env, ctx);
    } catch (e) {
      console.error('[submission] W-4 PDF rendering failed on repair attempt:', e);
      return { ok: false, changed: false };
    }
  }

  return persistW4Pdf(env, { applicationId: ctx.applicationId, pdfBytes, now: ctx.now });
}

/** Runs both I-9's and W-4's self-healing repair together — used by every
 * "already submitted" code path in submitSession (the idempotent-retry
 * branch and the race-loser branch), so the two are never repaired by two
 * separately-maintained call sites that could drift out of sync. Reports
 * failure if EITHER artifact's repair fails; reports changed if EITHER one
 * actually did the repairing (submitSession uses this to decide whether
 * this is the first moment the application is genuinely complete, and
 * therefore when confirmation emails should go out). */
async function ensureAllPdfsGenerated(
  env: SubmissionEnv,
  ctx: { applicationId: string; effectiveFormData: OnboardingFormData; now: string },
): Promise<{ ok: boolean; changed: boolean }> {
  const i9Result = await ensureI9PdfGenerated(env, ctx);
  if (!i9Result.ok) return { ok: false, changed: false };
  const w4Result = await ensureW4PdfGenerated(env, ctx);
  if (!w4Result.ok) return { ok: false, changed: false };
  return { ok: true, changed: i9Result.changed || w4Result.changed };
}

/** Best-effort, non-fatal, exactly-once-per-application email dispatch —
 * factored out so both the winning-submission path and the
 * already-submitted repair path (which only reaches this once, the
 * moment `ensureI9PdfGenerated` actually transitions the application
 * from incomplete to complete) send the identical pair of emails. */
async function sendConfirmationEmails(
  env: SubmissionEnv,
  p: { session: OnboardingSessionRow; applicationId: string; effectiveFormData: OnboardingFormData; submittedAt: string },
): Promise<void> {
  const { RESEND_API_KEY, ADMIN_NOTIFICATION_EMAIL } = env;
  if (!RESEND_API_KEY || !ADMIN_NOTIFICATION_EMAIL) return;

  const email = p.session.email ?? p.effectiveFormData.personalInfo.email;
  const firstName = p.session.first_name ?? p.effectiveFormData.personalInfo.firstName;
  const lastName = p.session.last_name ?? p.effectiveFormData.personalInfo.lastName;
  const results = await Promise.allSettled([
    sendApplicantConfirmation(RESEND_API_KEY, { to: email, firstName, applicationId: p.applicationId, submittedAt: p.submittedAt }),
    sendAdminNotification(RESEND_API_KEY, ADMIN_NOTIFICATION_EMAIL, {
      firstName, lastName, applicationId: p.applicationId, submittedAt: p.submittedAt, status: 'pending_review',
    }),
  ]);
  for (const [label, r] of [['applicant_confirmation', results[0]], ['admin_notification', results[1]]] as const) {
    if (r.status === 'rejected') console.error(`[submission] email.${label} failed:`, r.reason);
  }
}

function toI9PdfInput(data: OnboardingFormData, applicationId: string, now: string): I9PdfInput {
  const p = data.personalInfo;
  const i9 = data.i9Data;
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    middleInitial: p.middleInitial,
    otherLastNames: p.otherLastNames,
    address: p.address,
    aptNumber: p.aptNumber,
    city: p.city,
    state: p.state,
    zip: p.zip,
    email: p.email,
    phone: p.phone,
    dateOfBirth: i9.dateOfBirth,
    ssn: i9.ssn,
    citizenshipStatus: i9.citizenshipStatus,
    alienRegistrationNumber: i9.alienRegistrationNumber,
    alienWorkAuthExpiration: i9.alienWorkAuthExpiration,
    alienWorkAuthType: i9.alienWorkAuthType,
    alienNumber: i9.alienNumber,
    i94Number: i9.i94Number,
    foreignPassportNumber: i9.foreignPassportNumber,
    foreignPassportCountry: i9.foreignPassportCountry,
    i9SignatureDataUrl: i9.i9SignatureDataUrl,
    i9SignatureType: i9.i9SignatureType,
    i9TypedSignature: i9.i9TypedSignature,
    i9SignedDate: i9.i9SignedDate,
    applicationId,
    generatedAt: new Date(now).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC',
  };
}

/**
 * The real final-submission boundary for the authenticated mobile/session
 * architecture (M16) — see ADR-029. Mirrors what the existing web
 * `/api/submit-onboarding` route already does for a real Paramount
 * applicant (create an `applications` row, promote documents, generate the
 * signed I-9 PDF, send confirmation emails) but adapted to this app's own
 * authenticated, revision-protected, packet-aware session model rather
 * than that route's unauthenticated, client-driven payload.
 *
 * Never trusts a client-supplied "I'm ready" flag: completeness is
 * re-derived here, fresh, from the session's own authoritative
 * step_states/form_data at the moment of the call (`isPacketComplete` +
 * a defense-in-depth per-step `isStepValid` re-check), exactly like
 * routes/sessions.ts's PATCH handler already does when a single step is
 * newly marked completed — this applies the same discipline to the whole
 * packet at once, the one place it actually matters.
 *
 * Idempotent by construction: `onboarding_sessions.status` transitions
 * 'active' -> 'submitted' exactly once, via a single atomic D1 batch
 * (db/queries/submission.ts) guarded by the caller's `expectedRevision` —
 * a double tap, a network retry, a lost-response-then-retry, or two
 * different devices racing all resolve to the SAME outcome: whichever
 * request's guard matched wins and creates the one application row; every
 * other request (including one arriving after the winner, even with what
 * was a valid revision when it was read) safely finds `status ===
 * 'submitted'` and returns the existing application's id rather than
 * erroring or duplicating anything.
 */
export async function submitSession(
  env: SubmissionEnv,
  p: { sessionId: string; expectedRevision: number; ownerUserId: number },
): Promise<SubmitSessionResult> {
  const session = await findSessionById(env.DB, p.sessionId);
  if (!session || session.user_id !== p.ownerUserId) {
    return { kind: 'not_found' };
  }

  // The Worker only ever writes values validated against StepStatus (see
  // schemas/sessions.ts's stepStatusSchema) — loosely typed here only
  // because it round-tripped through JSON, same reasoning as
  // serializeSession()/mobile's deriveProgress(). Parsed once, up front,
  // so it's available both for a fresh submission AND for the
  // already-submitted self-healing check below.
  let stepStatesRaw: Record<string, string> = {};
  let storedFormData: Record<string, unknown> = {};
  try { stepStatesRaw = JSON.parse(session.step_states_json || '{}'); } catch { /* {} */ }
  try { storedFormData = JSON.parse(session.form_data_json || '{}'); } catch { /* {} */ }
  const stepStates = stepStatesRaw as StepStates;
  const effectiveFormData = withDefaults(storedFormData);

  // Already submitted (a genuine prior success, a concurrent winner, or a
  // retry of a request whose response never arrived) — never re-validate
  // packet completeness or re-run the DB batch again. This IS still a
  // free opportunity to self-heal a missing/incomplete I-9 PDF from a
  // prior partial failure (M16 hardening — see ensureI9PdfGenerated's own
  // doc comment); that check is itself fully idempotent, so re-running it
  // on every idempotent re-submit is safe and cheap once healthy.
  //
  // Critically, a STILL-failing repair here must NOT be reported as
  // success either — the same "never silently succeed while a required
  // artifact is missing" invariant applies on every retry, not just the
  // very first attempt (see submitSession's own top-level doc comment).
  if (session.status === 'submitted') {
    if (!session.application_id) {
      return { kind: 'error', message: 'Session is marked submitted but has no application reference.' };
    }
    const applicationId = session.application_id;
    const result = await ensureAllPdfsGenerated(env, { applicationId, effectiveFormData, now: new Date().toISOString() });
    if (!result.ok) {
      return { kind: 'error', message: 'Your application was received but could not be fully finalized. Please try submitting again.' };
    }
    if (result.changed) {
      // This retry is the one that actually repaired the missing
      // artifact — the first moment the application is genuinely
      // complete, so this is when confirmation emails go out (never
      // sent earlier, since the winning request itself failed before
      // reaching its own email step).
      await sendConfirmationEmails(env, { session, applicationId, effectiveFormData, submittedAt: session.updated_at });
    }
    return { kind: 'already_submitted', applicationId };
  }

  if (session.status !== 'active') {
    return { kind: 'error', message: `Session status "${session.status}" cannot be submitted.` };
  }

  const packet = getPacket(session.packet_id);
  if (!packet) return { kind: 'unknown_packet' };

  // Server-authoritative readiness. Deliberately NOT a direct call to the
  // shared `isPacketComplete(packet, stepStates)` here: that function
  // (correctly, for every OTHER caller) requires every required step
  // INCLUDING `review` itself to already be 'completed' — but `review` is
  // the step THIS action completes, so requiring it up front would make
  // submission permanently impossible. This re-derives the same
  // "every required, non-review step is completed" check `review`'s own
  // stepState is expected to summarize, plus a per-step `isStepValid`
  // re-check as defense-in-depth against a stepStates entry claiming
  // 'completed' for data that would no longer actually pass validation.
  const requiredSteps = packet.steps.filter((s) => s.required && s.type !== 'review');
  const incompleteSteps: IncompleteStepInfo[] = requiredSteps
    .filter((s) => stepStates[s.id] !== 'completed' || !isStepValid(s.id, effectiveFormData, s))
    .map((s) => ({ id: s.id, label: s.label }));

  if (incompleteSteps.length > 0) {
    return { kind: 'incomplete', incompleteSteps };
  }

  const applicationId = generateApplicationId();
  const now = new Date().toISOString();
  const guard = { sessionId: p.sessionId, expectedRevision: p.expectedRevision, ownerUserId: p.ownerUserId };

  // Preflight: render the I-9 PDF BEFORE committing anything. This is a
  // pure operation with respect to storage/DB state (see renderI9Pdf's
  // own doc comment) — a rendering failure here (e.g. a legal name
  // outside pdf-lib's WinAnsi-only standard fonts, a real, non-
  // hypothetical input) must be caught while the session is still fully
  // 'active' and editable, never after it becomes submitted and
  // immutable. If this throws, nothing is created: no application row,
  // no session-status transition, no confirmation email — the applicant
  // sees an honest error instead of a permanently-stuck "successfully
  // submitted but missing required paperwork" application.
  let i9PdfBytes: Uint8Array;
  try {
    i9PdfBytes = await renderI9Pdf(env, { applicationId, effectiveFormData, now });
  } catch (e) {
    console.error('[submission] I-9 PDF preflight rendering failed — nothing was committed, session remains active:', e);
    return {
      kind: 'error',
      message: 'We could not generate your I-9 form with the information provided. Please contact your onboarding coordinator for help completing this step.',
    };
  }

  // Same preflight discipline as I-9, immediately above: a W-4 rendering
  // failure (a missing/renamed AcroForm field, or the template itself
  // missing from R2 — see services/w4pdf.ts and renderW4Pdf's own doc
  // comments) must be caught here, before anything is committed, never
  // after the session becomes submitted and immutable.
  let w4PdfBytes: Uint8Array;
  try {
    w4PdfBytes = await renderW4Pdf(env, { applicationId, effectiveFormData, now });
  } catch (e) {
    console.error('[submission] W-4 PDF preflight rendering failed — nothing was committed, session remains active:', e);
    return {
      kind: 'error',
      message: 'We could not generate your W-4 form with the information provided. Please contact your onboarding coordinator for help completing this step.',
    };
  }

  // Only documents that are still "active" for the applicant's FINAL answers
  // are promoted: a vaccination proof uploaded before the applicant switched
  // that vaccine to a declination stays on the (now-submitted) session but
  // never becomes part of the application's documents.
  const liveUploads: UploadedDocumentRow[] = (
    await findLiveUploadsForSession(env.DB, {
      sessionId: p.sessionId,
      userId: p.ownerUserId,
    })
  ).filter((doc) => isDocumentActiveForSubmission(doc.doc_type, effectiveFormData.acknowledgements));

  const stmts: D1PreparedStatement[] = [
    insertApplicationIfEligibleStmt(env.DB, {
      ...guard,
      applicationId,
      firstName: session.first_name ?? effectiveFormData.personalInfo.firstName,
      lastName: session.last_name ?? effectiveFormData.personalInfo.lastName,
      email: session.email ?? effectiveFormData.personalInfo.email,
      phone: session.phone ?? effectiveFormData.personalInfo.phone,
      payloadJson: JSON.stringify(redactSensitiveFormData(effectiveFormData)),
      submittedAt: now,
    }),
    ...liveUploads.map((doc) =>
      promoteDocumentIfEligibleStmt(env.DB, {
        ...guard,
        applicationId,
        objectKey: doc.object_key,
        fileName: doc.file_name,
        fileSize: doc.file_size,
        uploadedAt: doc.uploaded_at,
        docType: doc.doc_type,
      }),
    ),
    insertAuditLogIfEligibleStmt(env.DB, {
      ...guard,
      applicationId,
      action: 'application_submitted',
      metadataJson: JSON.stringify({ source: 'mobile_session', packetId: packet.id, documentCount: liveUploads.length }),
      createdAt: now,
    }),
    // Last: the actual session transition. Its own meta.changes is the
    // authority on whether THIS request won the submission.
    submitSessionStmt(env.DB, {
      ...guard,
      applicationId,
      stepStatesJson: JSON.stringify({ ...stepStates, review: 'completed' }),
    }),
  ];

  let batchResults: D1Result[];
  try {
    batchResults = await env.DB.batch(stmts);
  } catch (e) {
    console.error('[submission] D1 batch failed:', e);
    return { kind: 'error', message: 'Failed to submit your application. Please try again.' };
  }

  const sessionUpdateResult = batchResults[batchResults.length - 1];
  const won = (sessionUpdateResult.meta.changes ?? 0) > 0;

  if (!won) {
    // The guard didn't hold at transaction time — either a concurrent
    // request already won (re-check below) or the caller's revision was
    // genuinely stale (someone edited a required step since Review last
    // loaded). Re-read to tell the two apart.
    const current = await findSessionById(env.DB, p.sessionId);
    if (!current) return { kind: 'not_found' };
    if (current.status === 'submitted' && current.application_id) {
      // This request lost the race, but it's really just another form of
      // "retry into an already-submitted session" — the same
      // never-silently-succeed-while-incomplete invariant applies here
      // too, not only on a request made after a visible response.
      const raceApplicationId = current.application_id;
      const result = await ensureAllPdfsGenerated(env, { applicationId: raceApplicationId, effectiveFormData, now });
      if (!result.ok) {
        return { kind: 'error', message: 'Your application was received but could not be fully finalized. Please try submitting again.' };
      }
      if (result.changed) {
        await sendConfirmationEmails(env, { session: current, applicationId: raceApplicationId, effectiveFormData, submittedAt: current.updated_at });
      }
      return { kind: 'already_submitted', applicationId: raceApplicationId };
    }
    return { kind: 'conflict', current };
  }

  // Won the transition — the application row, promoted documents, and
  // audit event are already durably, atomically committed and NEVER
  // rolled back because of what happens next. Rendering already
  // succeeded (the preflight above), so all that remains is PERSISTING
  // those already-generated bytes — the one part of finalization that
  // can still fail, but only for TRANSIENT (storage) reasons, which the
  // idempotent repair path (ensureI9PdfGenerated, used by every future
  // retry into this now-submitted session) can actually fix. Report
  // failure here, not success, if persistence didn't actually complete —
  // the DB submission itself is untouched either way.
  const persistResult = await persistI9Pdf(env, { applicationId, pdfBytes: i9PdfBytes, effectiveFormData, now });
  if (!persistResult.ok) {
    return { kind: 'error', message: 'Your application was received but could not be fully finalized. Please try submitting again.' };
  }

  const w4PersistResult = await persistW4Pdf(env, { applicationId, pdfBytes: w4PdfBytes, now });
  if (!w4PersistResult.ok) {
    return { kind: 'error', message: 'Your application was received but could not be fully finalized. Please try submitting again.' };
  }

  await sendConfirmationEmails(env, { session, applicationId, effectiveFormData, submittedAt: now });

  return { kind: 'submitted', applicationId, submittedAt: now };
}

/** Read-only lookup for a submitted session's application snapshot —
 * used by the mobile app to restore the confirmation/submitted state
 * after an app restart (M16 requirement: success state must survive a
 * restart, not just live in transient screen state). */
export async function findSubmittedApplication(env: { DB: D1Database }, applicationId: string) {
  return findApplicationById(env.DB, applicationId);
}
