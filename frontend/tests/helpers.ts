import { vi } from 'vitest';

export const TEST_SECRET = 'test-only-admin-jwt-secret-not-for-production-use';

function b64url(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signTestJwt(
  claims: Record<string, unknown>,
  secret: string = TEST_SECRET,
): Promise<string> {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(claims));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${header}.${body}`)));
  return `${header}.${body}.${b64url(sig)}`;
}

export const inOneHour = () => Math.floor(Date.now() / 1000) + 3600;

/** Mock of next/headers' cookies() for route-handler tests. */
export function mockCookies(values: Record<string, string>) {
  return {
    cookies: async () => ({ get: (name: string) => (name in values ? { name, value: values[name] } : undefined) }),
  };
}

/** Replaces global fetch; returns the mock so tests can assert on calls. */
export function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => impl(String(url), init));
  vi.stubGlobal('fetch', fn);
  return fn;
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
