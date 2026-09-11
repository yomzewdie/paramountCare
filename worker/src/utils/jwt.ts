// JWT HS256 via Web Crypto — no third-party dependency.

export type UserType = 'admin' | 'applicant';

export interface JwtPayload {
  sub: string;       // email — kept as the email for both token kinds so
                      // existing consumers reading `sub` as an email
                      // (e.g. GET /api/auth/me for admin) are unaffected.
  uid: number;        // numeric id in admin_users or users, per userType.
  role: string;       // 'super_admin' | 'admin' | 'applicant'
  userType: UserType;
  jti: string;         // random per-issuance id — guarantees two tokens
                        // issued with identical claims in the same second
                        // (e.g. immediate refresh) are never byte-identical.
  iat: number;
  exp: number;
}

const ALG = { name: 'HMAC', hash: 'SHA-256' } as const;

// Default access-token lifetime for newly-issued applicant/mobile tokens.
// Admin's login call site passes its own (longer, unchanged) expiry
// explicitly — see worker/src/routes/auth.ts.
export const DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 minutes

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(padded);
  // Allocated via `new Uint8Array(length)` rather than `Uint8Array.from(...)`
  // specifically so the result is typed as backed by a plain ArrayBuffer
  // (not the wider ArrayBufferLike, which also covers SharedArrayBuffer) —
  // TypeScript 5.7+'s generic Uint8Array typing means `.from()`'s result
  // isn't assignable to `BufferSource` (used by crypto.subtle.verify below)
  // without this. Behaviorally identical either way.
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    ALG,
    false,
    ['sign', 'verify'],
  );
}

export async function signJwt(
  payload: Omit<JwtPayload, 'iat' | 'exp' | 'jti'>,
  secret: string,
  expirySeconds: number = DEFAULT_ACCESS_TOKEN_EXPIRY_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const full: JwtPayload = { ...payload, jti: crypto.randomUUID(), iat: now, exp: now + expirySeconds };

  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body   = b64url(new TextEncoder().encode(JSON.stringify(full)));
  const signing = `${header}.${body}`;

  const key = await importKey(secret);
  const sig = await crypto.subtle.sign(ALG, key, new TextEncoder().encode(signing));
  return `${signing}.${b64url(sig)}`;
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, body, sigB64] = parts;
  const signing = `${header}.${body}`;

  try {
    const key = await importKey(secret);
    const valid = await crypto.subtle.verify(
      ALG,
      key,
      b64urlDecode(sigB64),
      new TextEncoder().encode(signing),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(body))) as JwtPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
