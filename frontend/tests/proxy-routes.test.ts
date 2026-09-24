import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { jsonResponse, mockCookies, stubFetch } from './helpers';

let cookieJar: Record<string, string> = {};
vi.mock('next/headers', () => ({ cookies: async () => mockCookies(cookieJar).cookies() }));

process.env.WORKER_API_BASE_URL = 'https://worker.test';

import { GET as getDocument } from '@/app/api/admin/documents/[applicationId]/[documentId]/route';
import { GET as getW4 } from '@/app/api/admin/w4-pdf/[applicationId]/route';
import { GET as getI9 } from '@/app/api/admin/i9-pdf/[applicationId]/route';
import { GET as listInvites, POST as createInvite } from '@/app/api/admin/invites/route';
import { POST as resendInvite } from '@/app/api/admin/invites/[id]/resend/route';
import { POST as revokeInvite } from '@/app/api/admin/invites/[id]/revoke/route';

beforeEach(() => {
  cookieJar = { admin_token: 'admin-jwt-value' };
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const p = <T,>(v: T) => ({ params: Promise.resolve(v) });
const post = (url: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  new NextRequest(`http://localhost:3000${url}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: 'localhost:3000', ...init.headers },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

describe('protected downloads', () => {
  it('generic document download: forwards only application + numeric document id, with the admin cookie', async () => {
    const f = stubFetch(() => new Response('file-bytes', { headers: { 'content-type': 'image/jpeg', 'content-disposition': 'attachment; filename="check.jpg"' } }));
    const res = await getDocument(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'APP-1', documentId: '42' }));

    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://worker.test/api/admin/application/APP-1/documents/42/download');
    expect((init!.headers as Record<string, string>).cookie).toBe('admin_token=admin-jwt-value');
    expect(res.headers.get('content-type')).toBe('image/jpeg');
    expect(res.headers.get('content-disposition')).toContain('check.jpg');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe('file-bytes');
  });

  it('rejects a non-numeric document id without calling the Worker (no arbitrary key/path)', async () => {
    const f = stubFetch(() => new Response('x'));
    for (const bad of ['abc', '1/../2', 'uploads/2026/x.pdf', '1.5', '']) {
      const res = await getDocument(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'APP-1', documentId: bad }));
      expect(res.status).toBe(400);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it('URL-encodes the application id so it cannot alter the upstream path', async () => {
    const f = stubFetch(() => new Response('x'));
    await getDocument(new NextRequest('http://localhost:3000/x'), p({ applicationId: '../../auth/logout-all', documentId: '1' }));
    expect(f.mock.calls[0][0]).toBe('https://worker.test/api/admin/application/..%2F..%2Fauth%2Flogout-all/documents/1/download');
  });

  it.each([
    ['W-4', getW4, '/api/admin/application/APP-1/w4-pdf'],
    ['I-9', getI9, '/api/admin/application/APP-1/i9-pdf'],
  ] as const)('%s download is proxied privately with no-store', async (_name, handler, upstreamPath) => {
    const f = stubFetch(() => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }));
    const res = await handler(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'APP-1' }));
    expect(res.status).toBe(200);
    expect(f.mock.calls[0][0]).toBe(`https://worker.test${upstreamPath}`);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
  });

  it.each([
    ['document', () => getDocument(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'A', documentId: '1' }))],
    ['W-4', () => getW4(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'A' }))],
    ['I-9', () => getI9(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'A' }))],
  ])('%s download without an admin cookie is 401 and never reaches the Worker', async (_n, call) => {
    cookieJar = {};
    const f = stubFetch(() => new Response('x'));
    expect((await call()).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('relays only the Worker\'s short error string, never a raw upstream body', async () => {
    stubFetch(() => jsonResponse({ error: 'Signed W-4 PDF not found for this application', stack: 'internal-detail' }, 404));
    const res = await getW4(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'A' }));
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain('Signed W-4 PDF not found');
    expect(text).not.toContain('internal-detail');
  });

  it('a Worker 403 (non-admin token) is passed through as 403', async () => {
    stubFetch(() => jsonResponse({ error: 'Forbidden' }, 403));
    expect((await getI9(new NextRequest('http://localhost:3000/x'), p({ applicationId: 'A' }))).status).toBe(403);
  });
});

describe('invitation proxy routes', () => {
  it('GET list forwards pagination only, with the admin cookie', async () => {
    const f = stubFetch(() => jsonResponse({ data: [], pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 } }));
    const res = await listInvites(new NextRequest('http://localhost:3000/api/admin/invites?pageSize=50&page=2&evil=1&email=x'));
    expect(res.status).toBe(200);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://worker.test/api/admin/invites?page=2&pageSize=50');
    expect((init!.headers as Record<string, string>).cookie).toBe('admin_token=admin-jwt-value');
  });

  it('POST create forwards {email} and passes emailDelivery "sent" through', async () => {
    const f = stubFetch(() => jsonResponse({ id: 1, email: 'a@example.com', status: 'pending', emailDelivery: 'sent' }, 201));
    const res = await createInvite(post('/api/admin/invites', { body: { email: ' a@example.com ', extra: 'ignored' } }));
    expect(res.status).toBe(201);
    expect((await res.json()).emailDelivery).toBe('sent');
    expect(JSON.parse(String(f.mock.calls[0][1]!.body))).toEqual({ email: 'a@example.com' });
  });

  it('POST create passes emailDelivery "failed" through (invitation preserved)', async () => {
    stubFetch(() => jsonResponse({ id: 2, email: 'b@example.com', status: 'pending', emailDelivery: 'failed' }, 201));
    const res = await createInvite(post('/api/admin/invites', { body: { email: 'b@example.com' } }));
    expect(res.status).toBe(201);
    expect((await res.json()).emailDelivery).toBe('failed');
  });

  it('POST create validates input locally: non-JSON content type → 415, missing email → 422', async () => {
    const f = stubFetch(() => jsonResponse({}, 201));
    const wrongType = new NextRequest('http://localhost:3000/api/admin/invites', {
      method: 'POST', headers: { 'Content-Type': 'text/plain', host: 'localhost:3000' }, body: 'email=a@example.com',
    });
    expect((await createInvite(wrongType)).status).toBe(415);
    expect((await createInvite(post('/api/admin/invites', { body: {} }))).status).toBe(422);
    expect(f).not.toHaveBeenCalled();
  });

  it('POST create relays the Worker\'s conflict message (duplicate outstanding invite)', async () => {
    stubFetch(() => jsonResponse({ error: 'An outstanding invitation already exists for this email — use resend instead', inviteId: 9 }, 409));
    const res = await createInvite(post('/api/admin/invites', { body: { email: 'a@example.com' } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('use resend instead');
  });

  it('resend and revoke proxy to the right Worker path', async () => {
    const f = stubFetch(() => jsonResponse({ id: 5, status: 'pending', email: 'a@example.com', emailDelivery: 'sent' }));
    expect((await resendInvite(post('/api/admin/invites/5/resend'), p({ id: '5' }))).status).toBe(200);
    expect(f.mock.calls[0][0]).toBe('https://worker.test/api/admin/invites/5/resend');

    stubFetch(() => jsonResponse({ id: 5, status: 'revoked' }));
    const g = stubFetch(() => jsonResponse({ id: 5, status: 'revoked' }));
    expect((await revokeInvite(post('/api/admin/invites/5/revoke'), p({ id: '5' }))).status).toBe(200);
    expect(g.mock.calls[0][0]).toBe('https://worker.test/api/admin/invites/5/revoke');
  });

  it('rejects a non-numeric invitation id without calling the Worker', async () => {
    const f = stubFetch(() => jsonResponse({}));
    expect((await resendInvite(post('/x'), p({ id: '5/../../x' }))).status).toBe(400);
    expect((await revokeInvite(post('/x'), p({ id: 'abc' }))).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it('state-changing routes reject cross-origin requests', async () => {
    const f = stubFetch(() => jsonResponse({}));
    const evil = { Origin: 'https://evil.example' };
    expect((await createInvite(post('/api/admin/invites', { body: { email: 'a@example.com' }, headers: evil }))).status).toBe(403);
    expect((await resendInvite(post('/x', { headers: evil }), p({ id: '1' }))).status).toBe(403);
    expect((await revokeInvite(post('/x', { headers: evil }), p({ id: '1' }))).status).toBe(403);
    expect(f).not.toHaveBeenCalled();
  });

  it('accepts a same-origin request', async () => {
    stubFetch(() => jsonResponse({ id: 1, emailDelivery: 'sent' }));
    const ok = { Origin: 'http://localhost:3000' };
    expect((await resendInvite(post('/x', { headers: ok }), p({ id: '1' }))).status).toBe(200);
  });

  it('all invitation routes are 401 without an admin cookie and never reach the Worker', async () => {
    cookieJar = {};
    const f = stubFetch(() => jsonResponse({}));
    expect((await listInvites(new NextRequest('http://localhost:3000/api/admin/invites'))).status).toBe(401);
    expect((await createInvite(post('/api/admin/invites', { body: { email: 'a@example.com' } }))).status).toBe(401);
    expect((await resendInvite(post('/x'), p({ id: '1' }))).status).toBe(401);
    expect((await revokeInvite(post('/x'), p({ id: '1' }))).status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('a network failure to the Worker is reported as 502 with a generic message', async () => {
    stubFetch(() => { throw new Error('connect ECONNREFUSED 10.0.0.1:443'); });
    const res = await listInvites(new NextRequest('http://localhost:3000/api/admin/invites'));
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('10.0.0.1');
  });
});
