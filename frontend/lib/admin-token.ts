// Edge-runtime-safe (Web Crypto only) verification of the admin_token JWT,
// shared by middleware.ts. Signature and expiry are checked, and — unlike
// the previous inline version — so is the `role` claim: the Worker signs
// applicant and admin access tokens with the same secret, so a signature
// alone does not prove the bearer is an admin. (The Worker's own
// requireRole is still the authoritative check on every API call; this
// keeps an applicant token from even reaching the admin page shell.)

const ALG = { name: 'HMAC', hash: 'SHA-256' } as const;
export const ADMIN_ROLES = ['admin', 'super_admin'] as const;

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function verifyAdminToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ALG, false, ['verify']);
    const [header, body, sigB64] = parts;
    const sigBytes = b64urlDecode(sigB64);
    const valid = await crypto.subtle.verify(
      ALG,
      key,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      new TextEncoder().encode(`${header}.${body}`),
    );
    if (!valid) return false;

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as { exp?: number; role?: string };
    if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return false;
    return typeof payload.role === 'string' && (ADMIN_ROLES as readonly string[]).includes(payload.role);
  } catch {
    return false;
  }
}
