import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { requireAuth } from '../middleware/requireAuth';
import { requireRole } from '../middleware/requireRole';
import { createInviteSchema } from '../schemas/invites';
import { generateInviteCode, normalizeInviteCode, hashInviteCode } from '../services/inviteCode';
import { sendApplicantInvitation } from '../services/email';
import { findUserByEmail } from '../db/queries/users';
import {
  insertOnboardingInvite,
  findOnboardingInviteById,
  findOutstandingInviteForEmail,
  listOnboardingInvites,
  rotateOnboardingInvite,
  revokeOnboardingInvite,
  type OnboardingInviteRow,
} from '../db/queries/onboardingInvites';
import { isoInSeconds } from '../utils/time';

export const invites = new Hono<AppEnv>();

// Only admin/super_admin may manage invitations — applicants have no route
// here at all.
invites.use('*', requireAuth);
invites.use('*', requireRole('admin', 'super_admin'));

const INVITE_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7 days

function inviteStatus(row: OnboardingInviteRow): 'used' | 'revoked' | 'expired' | 'pending' {
  if (row.used_at) return 'used';
  if (row.revoked_at) return 'revoked';
  if (new Date(row.expires_at).getTime() < Date.now()) return 'expired';
  return 'pending';
}

// Never includes token_hash — the raw token is only ever emailed once, and
// its hash never needs to leave the server after that.
function serializeInvite(row: OnboardingInviteRow) {
  return {
    id: row.id,
    email: row.email,
    status: inviteStatus(row),
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function sendInviteEmail(
  c: { env: { RESEND_API_KEY: string } },
  email: string,
  code: string,
  expiresAt: string,
) {
  if (!c.env.RESEND_API_KEY) {
    console.warn('[invites] email skipped: RESEND_API_KEY not configured');
    return;
  }
  try {
    // The code, never a link — see services/email.ts's sendApplicantInvitation.
    await sendApplicantInvitation(c.env.RESEND_API_KEY, { to: email, code, expiresAt });
  } catch (e) {
    // Non-fatal — the invite row already exists; the admin can use "resend"
    // if the applicant never receives it. Matches the existing non-fatal
    // email pattern in routes/onboarding.ts.
    console.error('[invites] failed to send invitation email:', e);
  }
}

// ── POST /api/admin/invites — create ─────────────────────────────────────────

invites.post('/', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = createInviteSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) }, 422);
  }

  const email = result.data.email.toLowerCase().trim();
  const payload = c.get('jwtPayload');
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const existingUser = await findUserByEmail(c.env.DB, email);
  if (existingUser) {
    return c.json({ error: 'An account with this email is already registered' }, 409);
  }

  const outstanding = await findOutstandingInviteForEmail(c.env.DB, email);
  if (outstanding) {
    return c.json({ error: 'An outstanding invitation already exists for this email — use resend instead', inviteId: outstanding.id }, 409);
  }

  const rawCode = generateInviteCode();
  const tokenHash = await hashInviteCode(normalizeInviteCode(rawCode), c.env.INVITE_CODE_SECRET);
  const expiresAt = isoInSeconds(INVITE_EXPIRY_SECONDS);

  const invite = await insertOnboardingInvite(c.env.DB, {
    email,
    tokenHash,
    expiresAt,
    createdBy: payload.uid,
  });

  await sendInviteEmail(c, email, rawCode, expiresAt);

  return c.json(serializeInvite(invite), 201);
});

// ── GET /api/admin/invites — list ────────────────────────────────────────────

invites.get('/', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') ?? '20', 10) || 20));
  const email = c.req.query('email')?.trim().toLowerCase() || undefined;

  const { invites: rows, total } = await listOnboardingInvites(c.env.DB, { page, pageSize, email });

  return c.json({
    data: rows.map(serializeInvite),
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });
});

// ── POST /api/admin/invites/:id/resend — rotate token, re-send ─────────────

invites.post('/:id/resend', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid invite id' }, 400);

  const existing = await findOnboardingInviteById(c.env.DB, id);
  if (!existing) return c.json({ error: 'Invitation not found' }, 404);

  const rawCode = generateInviteCode();
  const tokenHash = await hashInviteCode(normalizeInviteCode(rawCode), c.env.INVITE_CODE_SECRET);
  const expiresAt = isoInSeconds(INVITE_EXPIRY_SECONDS);

  const result = await rotateOnboardingInvite(c.env.DB, id, { tokenHash, expiresAt });
  if (!result.ok) {
    if (result.reason === 'already_used') return c.json({ error: 'This invitation has already been used' }, 409);
    if (result.reason === 'revoked') return c.json({ error: 'This invitation has been revoked — create a new one instead' }, 409);
    return c.json({ error: 'Invitation not found' }, 404);
  }

  await sendInviteEmail(c, existing.email, rawCode, expiresAt);

  const updated = await findOnboardingInviteById(c.env.DB, id);
  return c.json(serializeInvite(updated!));
});

// ── POST /api/admin/invites/:id/revoke ───────────────────────────────────────

invites.post('/:id/revoke', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  if (Number.isNaN(id)) return c.json({ error: 'Invalid invite id' }, 400);

  const result = await revokeOnboardingInvite(c.env.DB, id);
  if (!result.ok) {
    if (result.reason === 'already_used') return c.json({ error: 'This invitation has already been used and cannot be revoked' }, 409);
    return c.json({ error: 'Invitation not found' }, 404);
  }

  const updated = await findOnboardingInviteById(c.env.DB, id);
  return c.json(serializeInvite(updated!));
});
