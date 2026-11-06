import { Hono } from 'hono';
import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env';
import { VERIFICATION_KINDS, VERIFICATION_STATUSES, type VerificationKind } from '../db/queries/clinicianRecords';
import { REVIEW_STATUSES } from '../db/queries/documentReviews';
import {
  clearClinician,
  documentReviews,
  loadClinicianContext,
  placeOnHold,
  resumeFromHold,
  revokeClearance,
  setVerificationStatus,
  workflowDetail,
  type ClinicianContext,
  type WorkflowResult,
} from '../services/clinicianWorkflow';
import { candidateFieldsSchema, createCandidate, createCandidateSchema, createInvitation, storeCandidateResume, updateCandidate } from '../services/candidates';
import { decideDocumentReview, resendCorrectionNotice } from '../services/documentReviews';
import { serveStoredFile } from '../services/storedFiles';
import { reconcileCorrectionDocuments } from '../services/corrections';

// ── /api/admin/clinicians/* — the recruiter's clinician workflow ─────────────
//
// Mounted inside routes/admin.ts, behind its requireAuth + requireRole('admin',
// 'super_admin'): applicants and anonymous callers never reach these. Every
// action is keyed by the clinician record id and answers with the refreshed
// workflow view, so the portal always redraws from what the server holds.

export const clinicianAdmin = new Hono<AppEnv>();

function validationError(c: Context<AppEnv>, error: z.ZodError) {
  return c.json({ error: 'Validation failed', issues: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
}

async function jsonBody(c: Context<AppEnv>): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

type Loaded = { ok: true; ctx: ClinicianContext; adminId: number } | { ok: false; response: Response };

/** The admin's role from their record, not the token, so a change takes
 * effect at once — for the override itself and for what the portal offers. */
async function adminRole(c: Context<AppEnv>): Promise<string> {
  const admin = await c.env.DB.prepare('SELECT role FROM admin_users WHERE id = ?').bind(c.get('jwtPayload')!.uid).first<{ role: string }>();
  return admin?.role ?? '';
}

async function load(c: Context<AppEnv>): Promise<Loaded> {
  const payload = c.get('jwtPayload');
  if (!payload) return { ok: false, response: c.json({ error: 'Unauthorized' }, 401) };
  const id = c.req.param('id') ?? '';
  if (!/^\d+$/.test(id)) return { ok: false, response: c.json({ error: 'Clinician not found' }, 404) };
  let ctx = await loadClinicianContext(c.env.DB, Number(id));
  if (!ctx) return { ok: false, response: c.json({ error: 'Clinician not found' }, 404) };
  // An admin always sees, and decides on, a corrected application whose
  // documents are in step with the applicant's session (services/corrections.ts).
  if (ctx.session && ctx.application && ctx.reviews.some((r) => r.correction_open)) {
    await reconcileCorrectionDocuments(c.env.DB, ctx.session, ctx.record.id);
    ctx = (await loadClinicianContext(c.env.DB, Number(id)))!;
  }
  return { ok: true, ctx, adminId: payload.uid };
}

async function respond(c: Context<AppEnv>, recordId: number, result: WorkflowResult, extra: Record<string, unknown> = {}) {
  if (!result.ok) return c.json({ error: result.error, ...(result.incomplete ? { incomplete: result.incomplete } : {}) }, result.status);
  const ctx = (await loadClinicianContext(c.env.DB, recordId))!;
  return c.json({ ...(await workflowDetail(c.env.DB, ctx, await adminRole(c))), ...extra });
}

// ── New Applicants ───────────────────────────────────────────────────────────

clinicianAdmin.post('/', async (c) => {
  const parsed = createCandidateSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);
  const created = await createCandidate(c.env.DB, c.get('jwtPayload')!.uid, parsed.data);
  if (!created.ok) return c.json({ error: created.error, clinicianId: created.clinicianId }, 409);
  const ctx = (await loadClinicianContext(c.env.DB, created.record.id))!;
  return c.json(await workflowDetail(c.env.DB, ctx, await adminRole(c)), 201);
});

clinicianAdmin.get('/:id', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  return c.json(await workflowDetail(c.env.DB, loaded.ctx, await adminRole(c)));
});

clinicianAdmin.patch('/:id', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const parsed = candidateFieldsSchema.strict().safeParse(await jsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);
  const updated = await updateCandidate(c.env.DB, loaded.ctx, loaded.adminId, parsed.data);
  if (!updated.ok) return c.json({ error: updated.error }, updated.status);
  return respond(c, loaded.ctx.record.id, { ok: true });
});

clinicianAdmin.put('/:id/resume', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  let file: unknown;
  try {
    file = (await c.req.raw.formData()).get('file');
  } catch {
    return c.json({ error: 'Expected multipart/form-data.' }, 400);
  }
  const stored = await storeCandidateResume(c.env, loaded.ctx.record, loaded.adminId, file);
  if (!stored.ok) return c.json({ error: stored.error }, stored.status);
  return respond(c, loaded.ctx.record.id, { ok: true });
});

for (const mode of ['download', 'preview'] as const) {
  clinicianAdmin.get(`/:id/resume/${mode}`, async (c) => {
    const loaded = await load(c);
    if (!loaded.ok) return loaded.response;
    const { resume_object_key: key, resume_file_name: name } = loaded.ctx.record;
    if (!key || !name) return c.json({ error: 'No resume on file for this clinician' }, 404);
    return serveStoredFile(c, key, name, mode);
  });
}

const invitationSchema = z.object({ useCandidateResume: z.boolean().optional() }).strict();

clinicianAdmin.post('/:id/invitation', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const parsed = invitationSchema.safeParse((await jsonBody(c)) ?? {});
  if (!parsed.success) return validationError(c, parsed.error);
  const created = await createInvitation(c.env, { email: loaded.ctx.record.email, adminId: loaded.adminId, useCandidateResume: parsed.data.useCandidateResume });
  if (!created.ok) return c.json({ error: created.error, ...(created.inviteId ? { inviteId: created.inviteId } : {}) }, created.status);
  return respond(c, loaded.ctx.record.id, { ok: true }, { emailDelivery: created.emailDelivery });
});

// ── On Hold ──────────────────────────────────────────────────────────────────

const reasonSchema = z.object({ reason: z.string().max(500).optional() }).strict();

clinicianAdmin.post('/:id/hold', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const parsed = reasonSchema.safeParse((await jsonBody(c)) ?? {});
  if (!parsed.success) return validationError(c, parsed.error);
  return respond(c, loaded.ctx.record.id, await placeOnHold(c.env.DB, loaded.ctx, loaded.adminId, parsed.data.reason));
});

clinicianAdmin.post('/:id/resume-onboarding', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const result = await resumeFromHold(c.env, loaded.ctx, loaded.adminId);
  return respond(c, loaded.ctx.record.id, result, result.ok ? { correctionNoticesSent: result.correctionNoticesSent ?? 0 } : {});
});

// ── Internal verification ────────────────────────────────────────────────────

const verificationSchema = z.object({ status: z.enum(VERIFICATION_STATUSES) }).strict();

clinicianAdmin.put('/:id/verifications/:kind', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const kind = c.req.param('kind') as VerificationKind;
  if (!VERIFICATION_KINDS.includes(kind)) return c.json({ error: 'Unknown verification' }, 404);
  const parsed = verificationSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);
  return respond(c, loaded.ctx.record.id, await setVerificationStatus(c.env.DB, loaded.ctx, loaded.adminId, kind, parsed.data.status));
});

// ── Document review ──────────────────────────────────────────────────────────

const reviewSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  note: z.string().max(2000).nullable().optional(),
  /** The review's updatedAt as the admin saw it (null: no review yet). */
  expectedUpdatedAt: z.string().nullable().optional(),
}).strict();

clinicianAdmin.put('/:id/document-reviews/:requirement', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const parsed = reviewSchema.safeParse(await jsonBody(c));
  if (!parsed.success) return validationError(c, parsed.error);
  const { ctx } = loaded;
  const { requirements } = documentReviews(ctx);
  const requirement = c.req.param('requirement')!;
  const state = requirements.find((r) => r.requirement === requirement);
  const decided = await decideDocumentReview(c.env, {
    record: ctx.record,
    states: requirements,
    requirement,
    status: parsed.data.status,
    note: parsed.data.note ?? null,
    adminId: loaded.adminId,
    expectedUpdatedAt: parsed.data.expectedUpdatedAt !== undefined ? parsed.data.expectedUpdatedAt : state?.updatedAt ?? null,
    applicationId: ctx.application?.application_id ?? null,
    sessionId: ctx.session?.session_id ?? null,
  });
  if (!decided.ok) return c.json({ error: decided.error }, decided.status);
  return respond(c, ctx.record.id, { ok: true }, decided.notification ? { correctionNotification: decided.notification } : {});
});

clinicianAdmin.post('/:id/document-reviews/:requirement/notify', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const { ctx } = loaded;
  const result = await resendCorrectionNotice(c.env, {
    record: ctx.record, requirement: c.req.param('requirement')!, adminId: loaded.adminId,
    applicationId: ctx.application?.application_id ?? null, sessionId: ctx.session?.session_id ?? null,
  });
  if (!result.ok) return c.json({ error: result.error }, result.status);
  return respond(c, ctx.record.id, { ok: true });
});

// ── Clearance ────────────────────────────────────────────────────────────────

const clearanceSchema = z.object({ override: z.boolean().optional(), reason: z.string().max(500).optional() }).strict();

clinicianAdmin.post('/:id/clearance', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const parsed = clearanceSchema.safeParse((await jsonBody(c)) ?? {});
  if (!parsed.success) return validationError(c, parsed.error);
  return respond(c, loaded.ctx.record.id, await clearClinician(c.env.DB, loaded.ctx, {
    adminId: loaded.adminId, adminRole: await adminRole(c), override: !!parsed.data.override, reason: parsed.data.reason,
  }));
});

clinicianAdmin.post('/:id/clearance/revoke', async (c) => {
  const loaded = await load(c);
  if (!loaded.ok) return loaded.response;
  const parsed = reasonSchema.safeParse((await jsonBody(c)) ?? {});
  if (!parsed.success) return validationError(c, parsed.error);
  return respond(c, loaded.ctx.record.id, await revokeClearance(c.env.DB, loaded.ctx, loaded.adminId, parsed.data.reason));
});
