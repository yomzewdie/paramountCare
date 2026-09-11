// A 6-digit numeric code, deliberately low-entropy for mobile UX (type it in
// by hand) — unlike the high-entropy tokens in services/opaqueTokens.ts
// (refresh tokens, invitation tokens), this is NOT meant to be
// brute-force-resistant on its own. Its security comes from a short
// expiration and a capped number of verification attempts (see
// routes/auth.ts verify-email), not from the code space itself.

export const VERIFICATION_CODE_EXPIRY_SECONDS = 10 * 60; // 10 minutes
export const MAX_VERIFICATION_ATTEMPTS = 5;
export const VERIFICATION_RESEND_COOLDOWN_SECONDS = 60;

export function generateVerificationCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  const code = bytes[0] % 1_000_000;
  return code.toString().padStart(6, '0');
}

/**
 * A plain SHA-256(code) hash — used for the invitation/refresh tokens in
 * opaqueTokens.ts — is safe for a 256-bit random value, but not for a
 * 6-digit code: with only 1,000,000 possibilities, anyone who reads the
 * `code_hash` column out of a leaked/backed-up D1 file can hash all one
 * million candidates in well under a second and recover every outstanding
 * code. Keying the hash with a secret the database itself doesn't hold
 * (HMAC-SHA256, secret = EMAIL_VERIFICATION_SECRET, a Cloudflare secret) means
 * a D1 leak alone is not enough — the attacker also needs the secret, which
 * never appears in D1, in `wrangler.jsonc`, or in application logs.
 */
async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

export async function hashVerificationCode(code: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
