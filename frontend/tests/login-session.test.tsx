import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { ADMIN_COOKIE_NAME } from '@/lib/admin-token';
import { readSetCookie, getSetCookieLines } from '@/lib/set-cookie';
import { loginAdmin } from '@/lib/auth';
import { middleware } from '@/middleware';
import { TEST_SECRET, signTestJwt, inOneHour, jsonResponse, stubFetch } from './helpers';

// ── next/headers + next/navigation doubles ───────────────────────────────────
const events: string[] = [];
const cookieSet = vi.fn((name: string, value: string, opts: Record<string, unknown>) => {
  events.push(`cookie:${name}`);
  void value; void opts;
});
class RedirectSignal extends Error {
  constructor(public url: string) { super(`NEXT_REDIRECT:${url}`); }
}
vi.mock('next/headers', () => ({ cookies: async () => ({ set: cookieSet, get: () => undefined, delete: () => undefined }) }));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { events.push(`redirect:${url}`); throw new RedirectSignal(url); },
}));

import { loginAction } from '@/app/admin/login/actions';
import AdminLoginPage from '@/app/admin/login/page';

const WORKER = 'https://worker-uat.example.dev';

function workerLoginResponse(role: string, jwt: string, extraCookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  // Exactly what the Worker sends (worker/src/routes/auth.ts): TWO Set-Cookie headers.
  headers.append('Set-Cookie', `admin_token=${jwt}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800`);
  headers.append('Set-Cookie', `admin_refresh_token=REFRESH-SECRET-VALUE; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=2592000`);
  for (const c of extraCookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify({ email: 'admin@example.com', role }), { status: 200, headers });
}

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function runLogin(fields: Record<string, string>): Promise<string> {
  try {
    await loginAction(form(fields));
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error('loginAction did not redirect');
}

beforeEach(() => {
  events.length = 0;
  cookieSet.mockClear();
  vi.stubEnv('WORKER_API_BASE_URL', WORKER);
  vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');
  process.env.ADMIN_JWT_SECRET = TEST_SECRET;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('reading the Worker\'s Set-Cookie headers', () => {
  it('extracts admin_token — and only admin_token — from multiple Set-Cookie headers', () => {
    const res = workerLoginResponse('admin', 'JWT.PAYLOAD.SIG');
    expect(getSetCookieLines(res.headers)).toHaveLength(2);
    expect(readSetCookie(res.headers, 'admin_token')).toEqual({ value: 'JWT.PAYLOAD.SIG', maxAgeSeconds: 28800 });
    expect(readSetCookie(res.headers, 'admin_refresh_token')?.value).toBe('REFRESH-SECRET-VALUE');
  });

  it('does not match a cookie that merely ends with the name', () => {
    const h = new Headers();
    h.append('Set-Cookie', 'not_admin_token=nope; Path=/');
    expect(readSetCookie(h, 'admin_token')).toBeNull();
  });

  it('falls back to a cookie-aware split when getSetCookie() is unavailable (Expires commas do not break it)', () => {
    const folded =
      'admin_token=JWT.A.B; Path=/; Expires=Thu, 24 Sep 2026 13:44:42 GMT; Max-Age=28800, admin_refresh_token=R; Path=/api/auth; Expires=Sat, 24 Oct 2026 13:44:42 GMT';
    const fake = { get: (n: string) => (n.toLowerCase() === 'set-cookie' ? folded : null) } as unknown as Headers;
    expect(getSetCookieLines(fake)).toHaveLength(2);
    expect(readSetCookie(fake, 'admin_token')).toEqual({ value: 'JWT.A.B', maxAgeSeconds: 28800 });
  });

  it('treats a deletion (empty value) as absent', () => {
    const h = new Headers();
    h.append('Set-Cookie', 'admin_token=; Path=/; Max-Age=0');
    expect(readSetCookie(h, 'admin_token')).toBeNull();
  });
});

describe('loginAdmin (server → Worker)', () => {
  it('calls the Worker at WORKER_API_BASE_URL (regression: it used to read only NEXT_PUBLIC_API_BASE_URL)', async () => {
    const f = stubFetch(() => workerLoginResponse('admin', 'JWT.A.B'));
    const r = await loginAdmin('admin@example.com', 'pw');
    expect(f.mock.calls[0][0]).toBe(`${WORKER}/api/auth/login`);
    expect(r).toMatchObject({ ok: true, role: 'admin', adminToken: 'JWT.A.B', adminTokenMaxAgeSeconds: 28800 });
  });

  it('returns the admin token but never the refresh token', async () => {
    stubFetch(() => workerLoginResponse('admin', 'JWT.A.B'));
    const r = await loginAdmin('admin@example.com', 'pw');
    expect(JSON.stringify(r)).not.toContain('REFRESH-SECRET-VALUE');
  });

  it('a 200 with NO admin_token cookie is a failed login, not a silent success', async () => {
    stubFetch(() => jsonResponse({ email: 'admin@example.com', role: 'admin' }));
    const r = await loginAdmin('admin@example.com', 'pw');
    expect(r).toMatchObject({ ok: false });
  });

  it('bad credentials → Worker message, unreachable Worker → generic message', async () => {
    stubFetch(() => jsonResponse({ error: 'Invalid email or password' }, 401));
    expect(await loginAdmin('a@b.co', 'x')).toEqual({ ok: false, message: 'Invalid email or password' });
    stubFetch(() => { throw new TypeError('fetch failed'); });
    expect(await loginAdmin('a@b.co', 'x')).toMatchObject({ ok: false, message: 'Unable to reach the server. Please try again.' });
  });

  it('fails clearly (not with localhost) when no Worker URL is configured in production', async () => {
    vi.stubEnv('WORKER_API_BASE_URL', '');
    vi.stubEnv('NODE_ENV', 'production');
    const f = stubFetch(() => workerLoginResponse('admin', 'x'));
    const r = await loginAdmin('a@b.co', 'x');
    expect(r).toMatchObject({ ok: false });
    expect(f).not.toHaveBeenCalled();
  });
});

describe('loginAction (Server Action) — valid credentials', () => {
  it.each(['admin', 'super_admin'])('%s: sets the portal admin_token cookie, THEN redirects to /admin/applications, and middleware accepts it', async (role) => {
    const jwt = await signTestJwt({ role, userType: 'admin', exp: inOneHour() });
    stubFetch(() => workerLoginResponse(role, jwt));

    const target = await runLogin({ email: 'admin@example.com', password: 'pw', redirect: '/admin/applications' });

    expect(target).toBe('/admin/applications');
    expect(cookieSet).toHaveBeenCalledTimes(1);
    const [name, value, opts] = cookieSet.mock.calls[0];
    expect(name).toBe(ADMIN_COOKIE_NAME);
    expect(name).toBe('admin_token');
    expect(value).toBe(jwt);
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/', maxAge: 28800 });
    // cookie is written strictly before the redirect that ends the action
    expect(events).toEqual(['cookie:admin_token', 'redirect:/admin/applications']);

    // the cookie value the action issued is accepted by the middleware guard
    const res = await middleware(new NextRequest('http://localhost:3000/admin/applications', { headers: { cookie: `${name}=${value}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('marks the cookie Secure in a production (HTTPS) deployment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    stubFetch(() => workerLoginResponse('admin', 'JWT.A.B'));
    await runLogin({ email: 'a@b.co', password: 'pw', redirect: '/admin/applications' });
    expect(cookieSet.mock.calls[0][2]).toMatchObject({ secure: true, httpOnly: true });
  });

  it('does not store the Worker refresh token, and never puts a token in the redirect URL', async () => {
    stubFetch(() => workerLoginResponse('admin', 'JWT.A.B'));
    const target = await runLogin({ email: 'a@b.co', password: 'pw', redirect: '/admin/applications' });
    expect(cookieSet.mock.calls.map((c) => c[0])).toEqual(['admin_token']);
    expect(JSON.stringify(cookieSet.mock.calls)).not.toContain('REFRESH-SECRET-VALUE');
    expect(target).not.toContain('JWT');
  });

  it('a Worker 200 without an admin_token cookie sets no cookie and returns to login with an error', async () => {
    stubFetch(() => jsonResponse({ email: 'a@b.co', role: 'admin' }));
    const target = await runLogin({ email: 'a@b.co', password: 'pw', redirect: '/admin/applications' });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(target).toMatch(/^\/admin\/login\?error=/);
  });

  it('ignores an external redirect target', async () => {
    stubFetch(() => workerLoginResponse('admin', 'JWT.A.B'));
    expect(await runLogin({ email: 'a@b.co', password: 'pw', redirect: '//evil.example' })).toBe('/admin');
  });
});

describe('loginAction — invalid credentials', () => {
  it('sets no cookie, redirects to login with the error, and the login page displays it', async () => {
    stubFetch(() => jsonResponse({ error: 'Invalid email or password' }, 401));
    const target = await runLogin({ email: 'a@b.co', password: 'wrong', redirect: '/admin/applications' });

    expect(cookieSet).not.toHaveBeenCalled();
    const url = new URL(target, 'http://localhost');
    expect(url.pathname).toBe('/admin/login');
    expect(url.searchParams.get('error')).toBe('Invalid email or password');

    const html = renderToStaticMarkup(
      await AdminLoginPage({ searchParams: Promise.resolve({ error: url.searchParams.get('error')!, redirect: '/admin/applications' }) }),
    );
    expect(html).toContain('Invalid email or password');
  });

  it('requires email and password without calling the Worker', async () => {
    const f = stubFetch(() => workerLoginResponse('admin', 'x'));
    const target = await runLogin({ email: '', password: '', redirect: '/admin' });
    expect(target).toContain('/admin/login?error=');
    expect(f).not.toHaveBeenCalled();
    expect(cookieSet).not.toHaveBeenCalled();
  });
});
