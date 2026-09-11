// Generic high-entropy opaque-token primitives via Web Crypto, shared by
// refresh tokens (services/refreshTokens.ts) and onboarding invitation
// tokens (routes/invites.ts). All are the same kind of value — a random
// 256-bit secret, hashed at rest — just used for different purposes. (Not
// used for email verification codes, which are deliberately low-entropy for
// mobile UX — see services/emailVerification.ts.)

const RAW_TOKEN_BYTES = 32; // 256 bits

function toB64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Generates a new raw opaque token (never stored — returned to the caller once). */
export function generateOpaqueToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(RAW_TOKEN_BYTES));
  return toB64Url(bytes);
}

/**
 * SHA-256 hex digest of a raw opaque token. A high-entropy random value
 * (unlike a user-chosen password) cannot be feasibly guessed or brute-forced,
 * so a plain fast hash is the correct, standard choice — PBKDF2 (used for
 * passwords) would only add cost with no security benefit here.
 */
export async function hashOpaqueToken(rawToken: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawToken));
  return toHex(digest);
}

/** Constant-time string comparison, for comparing hash digests without a timing side channel. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
