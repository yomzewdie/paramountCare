// Human-typeable invitation codes — replaces the 256-bit opaque token
// (services/opaqueTokens.ts) as what's actually shown to an applicant.
// Design (Official Forms/Invitation-Flow redesign, 2026-09):
//   - 10 characters, Crockford Base32 alphabet (32 symbols: 0-9 and A-Z minus
//     I, L, O, U) — purpose-built for exactly this "a person transcribes it
//     by hand" problem: no visually-confusable pairs, naturally
//     case-insensitive (always normalized to uppercase).
//   - 10 * log2(32) = 50 bits of entropy (~1.13 quadrillion possibilities).
//     Deliberately more than the 6-digit email-verification code (~20 bits):
//     a verification code is scoped to an already-known user (an attacker
//     must already know who to target), but a correct invite-code guess
//     alone claims an arbitrary applicant's identity slot with no such
//     precondition — a materially worse failure mode that warrants more
//     headroom, not the same amount.
//   - Hashed with a KEYED hash (HMAC-SHA256), not the plain SHA-256 used for
//     the 256-bit token: a plain hash is fine for 256 bits (infeasible to
//     brute-force regardless of who holds the hash), but NOT for 50 bits —
//     a single modern high-end GPU does on the order of 10 billion plain
//     SHA-256/sec, so a leaked `token_hash` column alone would let an
//     attacker recover every outstanding code in ~31 hours of offline
//     compute. HMAC with a secret the database itself never holds
//     (INVITE_CODE_SECRET, a Cloudflare secret) closes that gap the same
//     way services/emailVerification.ts's keyed hash already does for the
//     6-digit code — see that file's own doc comment for the identical
//     reasoning. Online (rate-limited) guessing is defended by the 50-bit
//     space itself; this is what defends against an offline D1 leak.
//   - Deliberately a NEW, separate secret from EMAIL_VERIFICATION_SECRET —
//     same domain-separation reasoning already established in this codebase
//     for ADMIN_JWT_SECRET vs EMAIL_VERIFICATION_SECRET (see env.ts): they
//     protect different things, and rotating one should never have to
//     reason about whether it silently invalidates the other.
//
// Storage: the resulting hex digest is stored in the EXISTING
// onboarding_invites.token_hash column — same shape (a 64-hex-char SHA-256
// family digest) as the old plain hash, so no schema change is needed. Only
// what feeds that column (this file) and how it's looked up (unchanged:
// db/queries/onboardingInvites.ts's findOnboardingInviteByTokenHash) differ.
//
// Secret provisioning (OPERATIONAL RULE): INVITE_CODE_SECRET is a Cloudflare
// secret, never a wrangler.jsonc `vars` entry and never committed anywhere —
// set per environment with `wrangler secret put INVITE_CODE_SECRET --env
// <env>` (mirrors how EMAIL_VERIFICATION_SECRET/ADMIN_JWT_SECRET are already
// provisioned). Rotating this secret invalidates every outstanding
// invitation code: each stored token_hash is HMAC(code, the secret in effect
// when it was created), so a code hashed under the old secret will never
// match a lookup hashed under the new one, with no way to distinguish that
// case from an invalid code (by design — see the generic-error handling in
// routes/inviteValidation.ts and routes/auth.ts). The UAT/production secret
// must therefore stay stable across ordinary deployments; only rotate it
// deliberately, and only after accepting that every invite issued under the
// old value must be revoked and reissued (see the invitation-code-flow UAT
// cleanup notes for the equivalent one-time migration this same redesign
// already required).

const INVITE_CODE_LENGTH = 10;
// Crockford Base32: 0-9, A-Z minus I, L, O, U (avoids 0/O, 1/I/L confusion).
const INVITE_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Generates a new raw invitation code (never stored — returned to the
 * caller once, to be emailed). */
export function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(INVITE_CODE_LENGTH));
  let code = '';
  for (const b of bytes) {
    // Rejection-free modulo bias exists here (256 % 32 === 0, so this is
    // actually exact, not biased) — 32 divides 256 evenly, so every
    // alphabet symbol has exactly an 8/256 chance per byte.
    code += INVITE_CODE_ALPHABET[b % INVITE_CODE_ALPHABET.length];
  }
  return code;
}

/** Uppercases and strips whitespace/dashes so "abcd-ef123 4" and
 * "ABCDEF1234" are the same code — applied identically before hashing on
 * both the generating side (defensive; generateInviteCode() never emits
 * anything but the exact alphabet already) and, critically, on every
 * lookup, so a code copy/pasted with a stray space or a display-added
 * separator still matches. Never throws — always returns a string, even
 * if empty. */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]+/g, '');
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

/** HMAC-SHA256(normalizedCode, secret) — see this file's own top-of-file
 * doc comment for why this must be keyed, not a plain hash. Callers must
 * normalize before calling this (this function does not normalize itself,
 * so it stays a pure "hash exactly what I was given" primitive — matching
 * hashOpaqueToken()'s own shape). */
export async function hashInviteCode(normalizedCode: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(normalizedCode));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
