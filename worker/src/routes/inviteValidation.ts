import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { validateInviteCodeSchema } from '../schemas/inviteValidation';
import { normalizeInviteCode, hashInviteCode } from '../services/inviteCode';
import { findOnboardingInviteByTokenHash } from '../db/queries/onboardingInvites';
import { maskEmail } from '../utils/maskEmail';

export const inviteValidation = new Hono<AppEnv>();

// ── POST /api/invites/validate ────────────────────────────────────────────────
//
// Public, unauthenticated, read-only — deliberately never mutates
// onboarding_invites. Exists purely so the mobile app can preview the
// invited email BEFORE the applicant commits to setting a password; the
// actual claim happens at POST /api/auth/applicant/register.
//
// Every failure reason (not found / expired / revoked / used) collapses
// into ONE generic response — matching applicant/register's own established
// pattern of never revealing which reason applies to an unauthenticated
// caller. The success response returns only a MASKED email
// ("y***@gmail.com"), never the full address — see utils/maskEmail.ts.
//
// Rate limiting: this endpoint has no app-level limiter by design (see
// services/inviteCode.ts's own entropy analysis — the 50-bit code space is
// the real defense against online guessing; this is defense-in-depth on top
// of it, not a substitute for it). It MUST sit behind a Cloudflare Rate
// Limiting Rule in every real environment before going live:
//   - Match: Method = POST AND URI Path = "/api/invites/validate"
//   - Also apply the same rule to POST /api/auth/applicant/register (it
//     re-validates the same code as its first step).
//   - Threshold: ~10 requests per IP per minute (tune after real UAT usage
///    data — this is a starting point, not a measured value).
//   - Action: Block, returning HTTP 429 (the mobile client already maps any
//     429 from either endpoint to a friendly "Too many attempts" message —
//     see mobile/src/utils/errors.ts).
// NOT yet configured in UAT or anywhere else — this is edge/dashboard
// configuration, outside this codebase, and deliberately not done as part
// of this change (see the implementation notes for this feature).
inviteValidation.post('/validate', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const result = validateInviteCodeSchema.safeParse(body);
  if (!result.success) {
    return c.json(
      { error: 'Validation failed', issues: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
      422,
    );
  }

  // Never logged, here or anywhere else on this path — not the raw value,
  // not the normalized value.
  const normalized = normalizeInviteCode(result.data.code);
  const tokenHash = await hashInviteCode(normalized, c.env.INVITE_CODE_SECRET);
  const invite = await findOnboardingInviteByTokenHash(c.env.DB, tokenHash);

  const invalid = () =>
    c.json({ error: 'INVITE_CODE_INVALID', message: "We couldn't find that invitation code. Please check and try again." }, 404);

  if (!invite || invite.used_at || invite.revoked_at) return invalid();
  if (new Date(invite.expires_at).getTime() < Date.now()) return invalid();

  return c.json({ email: maskEmail(invite.email) });
});
