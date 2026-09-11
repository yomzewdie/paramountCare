-- ─────────────────────────────────────────────────────────────────────────────
-- Invite-only applicant registration + email verification
-- ─────────────────────────────────────────────────────────────────────────────
-- Product decision: applicants may not register on their own. An account may
-- only be created from a valid, admin-issued invitation, and the account
-- cannot sign in (or access onboarding) until its email is verified. See the
-- product-decision addendum in docs/ARCHITECTURE_DECISION_RECORDS.md.
--
-- Purely additive; neither table existed before, so there is nothing to
-- migrate or backfill.

-- ── Onboarding invitations ──────────────────────────────────────────────────
-- One row per invitation. Only ONE token is ever valid for a given row at a
-- time: "resend" rotates token_hash/expires_at on the SAME row rather than
-- creating a second row, so there is never more than one live credential per
-- invitation (see routes/invites.ts).
CREATE TABLE IF NOT EXISTS onboarding_invites (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  email        TEXT NOT NULL,
  -- SHA-256 hash of the raw invite token (worker/src/services/opaqueTokens.ts)
  -- — the raw value is never stored, only ever emailed to the applicant once.
  token_hash   TEXT UNIQUE NOT NULL,
  expires_at   TEXT NOT NULL,
  -- Set exactly once, atomically together with the applicant's user row, when
  -- registration succeeds — see claimInviteAndCreateUser() in
  -- db/queries/onboardingInvites.ts. A NULL here (and revoked_at NULL, and
  -- expires_at in the future) is what "outstanding" means for duplicate-invite
  -- prevention in routes/invites.ts.
  used_at      TEXT,
  revoked_at   TEXT,
  -- Internal-only, never returned by serializeInvite(): a fresh high-entropy
  -- value written atomically alongside used_at by claimInviteAndCreateUser(),
  -- so the follow-up INSERT into users can prove ITS OWN claim attempt was
  -- the one that actually won the race, rather than merely checking used_at
  -- IS NOT NULL (which two near-simultaneous claims could both observe as
  -- true) or comparing used_at's own timestamp (which two claims landing in
  -- the same millisecond could coincidentally share).
  claim_nonce  TEXT,
  -- References the existing admin_users table (not a new/invented identity
  -- table) — only an authenticated admin can create an invitation.
  created_by   INTEGER NOT NULL REFERENCES admin_users(id),
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_onboarding_invites_email      ON onboarding_invites(email);
CREATE INDEX IF NOT EXISTS idx_onboarding_invites_token_hash ON onboarding_invites(token_hash);

-- ── Email verification codes ────────────────────────────────────────────────
-- One row per user — a new code always overwrites the previous one (via
-- INSERT ... ON CONFLICT(user_id) DO UPDATE, see
-- db/queries/emailVerificationCodes.ts), which is exactly what "the newest
-- code invalidates older codes" means here: there is only ever one row, so
-- generating a new code destroys the old one's validity by construction —
-- no separate history table or explicit invalidation step needed.
CREATE TABLE IF NOT EXISTS email_verification_codes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id),
  -- HMAC-SHA256(code, EMAIL_VERIFICATION_SECRET) — a keyed hash, not plain
  -- SHA-256(code). A 6-digit code is deliberately low-entropy (1,000,000
  -- possibilities) for mobile UX, so a plain hash would let anyone who reads
  -- this column out of a leaked/backed-up D1 file brute-force every
  -- outstanding code offline in well under a second; the secret key (a
  -- Cloudflare secret, never stored in D1) is what prevents that. attempt_count
  -- + short expiry remain the defense against ONLINE guessing — see
  -- worker/src/services/emailVerification.ts and routes/auth.ts verify-email.
  code_hash     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
