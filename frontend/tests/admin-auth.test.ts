import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { verifyAdminToken } from '@/lib/admin-token';
import { safeRedirectTarget } from '@/lib/safe-redirect';
import { middleware } from '@/middleware';
import { TEST_SECRET, signTestJwt, inOneHour } from './helpers';

beforeEach(() => {
  process.env.ADMIN_JWT_SECRET = TEST_SECRET;
});

describe('verifyAdminToken', () => {
  it('accepts a valid admin token', async () => {
    expect(await verifyAdminToken(await signTestJwt({ role: 'admin', exp: inOneHour() }), TEST_SECRET)).toBe(true);
  });

  it('accepts a valid super_admin token', async () => {
    expect(await verifyAdminToken(await signTestJwt({ role: 'super_admin', exp: inOneHour() }), TEST_SECRET)).toBe(true);
  });

  it('rejects a validly-signed APPLICANT token (applicant auth is not admin auth)', async () => {
    expect(await verifyAdminToken(await signTestJwt({ role: 'applicant', userType: 'applicant', exp: inOneHour() }), TEST_SECRET)).toBe(false);
  });

  it('rejects a token with no role claim', async () => {
    expect(await verifyAdminToken(await signTestJwt({ exp: inOneHour() }), TEST_SECRET)).toBe(false);
  });

  it('rejects an expired token', async () => {
    expect(await verifyAdminToken(await signTestJwt({ role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }), TEST_SECRET)).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    expect(await verifyAdminToken(await signTestJwt({ role: 'admin', exp: inOneHour() }, 'some-other-secret'), TEST_SECRET)).toBe(false);
  });

  it('rejects garbage', async () => {
    expect(await verifyAdminToken('not-a-jwt', TEST_SECRET)).toBe(false);
    expect(await verifyAdminToken('a.b.c', TEST_SECRET)).toBe(false);
  });
});

describe('safeRedirectTarget (login open-redirect guard)', () => {
  it('keeps same-site absolute paths', () => {
    expect(safeRedirectTarget('/admin/applications?page=2')).toBe('/admin/applications?page=2');
  });
  it('rejects absolute URLs, protocol-relative and backslash targets', () => {
    expect(safeRedirectTarget('https://evil.example')).toBe('/admin');
    expect(safeRedirectTarget('//evil.example')).toBe('/admin');
    expect(safeRedirectTarget('/\\evil.example')).toBe('/admin');
    expect(safeRedirectTarget('evil')).toBe('/admin');
  });
});

describe('middleware — admin authentication guard', () => {
  const req = (path: string, token?: string) =>
    new NextRequest(`http://localhost:3000${path}`, { headers: token ? { cookie: `admin_token=${token}` } : {} });

  it('redirects an unauthenticated admin page request to login, preserving the target', async () => {
    const res = await middleware(req('/admin/applications'));
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/admin/login');
    expect(loc.searchParams.get('redirect')).toBe('/admin/applications');
  });

  it('redirects the invitations page too', async () => {
    const res = await middleware(req('/admin/invitations'));
    expect(new URL(res.headers.get('location')!).pathname).toBe('/admin/login');
  });

  it('answers an unauthenticated /api/admin request with 401 JSON, not a redirect', async () => {
    for (const path of ['/api/admin/invites', '/api/admin/w4-pdf/APP-1', '/api/admin/documents/APP-1/3', '/api/admin/i9-pdf/APP-1']) {
      const res = await middleware(req(path));
      expect(res.status).toBe(401);
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('lets the login page through without a token', async () => {
    const res = await middleware(req('/admin/login'));
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it('lets a valid admin token through admin pages and admin API routes', async () => {
    const token = await signTestJwt({ role: 'admin', exp: inOneHour() });
    for (const path of ['/admin/applications', '/api/admin/invites']) {
      const res = await middleware(req(path, token));
      expect(res.status).toBe(200);
      expect(res.headers.get('location')).toBeNull();
    }
  });

  it('rejects an applicant token on admin pages (redirect) and admin API (401)', async () => {
    const token = await signTestJwt({ role: 'applicant', exp: inOneHour() });
    expect((await middleware(req('/admin/applications', token))).status).toBe(307);
    expect((await middleware(req('/api/admin/invites', token))).status).toBe(401);
  });

  it('fails closed when ADMIN_JWT_SECRET is not configured', async () => {
    const token = await signTestJwt({ role: 'admin', exp: inOneHour() });
    delete process.env.ADMIN_JWT_SECRET;
    expect((await middleware(req('/admin/applications', token))).status).toBe(307);
  });
});
