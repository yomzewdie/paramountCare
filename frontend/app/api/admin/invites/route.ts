import { NextRequest } from 'next/server';
import { isCrossOrigin, jsonError, proxyAdminJson } from '@/lib/admin-proxy';

// GET  /api/admin/invites  — list invitations (paginated)
// POST /api/admin/invites  — create + email an invitation
//
// Thin proxy to the Worker's /api/admin/invites. The Worker never returns an
// invitation code, token, or hash, and this layer adds none — the code is
// delivered to the applicant by email only.

export async function GET(req: NextRequest) {
  const qs = new URLSearchParams();
  for (const key of ['page', 'pageSize'] as const) {
    const v = req.nextUrl.searchParams.get(key);
    if (v && /^\d+$/.test(v)) qs.set(key, v);
  }
  return proxyAdminJson(`/api/admin/invites?${qs.toString()}`, { method: 'GET' });
}

export async function POST(req: NextRequest) {
  if (isCrossOrigin(req)) return jsonError('Forbidden', 403);
  if (!req.headers.get('content-type')?.includes('application/json')) {
    return jsonError('Content-Type must be application/json', 415);
  }

  const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  if (!email) return jsonError('Email is required', 422);

  return proxyAdminJson('/api/admin/invites', { method: 'POST', body: { email } });
}
