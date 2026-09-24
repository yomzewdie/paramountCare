import { NextRequest } from 'next/server';
import { isCrossOrigin, jsonError, proxyAdminJson } from '@/lib/admin-proxy';

// POST /api/admin/invites/:id/revoke — proxied to the Worker, which decides
// whether the invitation's current state allows it.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (isCrossOrigin(req)) return jsonError('Forbidden', 403);
  const { id } = await params;
  if (!/^\d+$/.test(id)) return jsonError('Invalid invitation id', 400);
  return proxyAdminJson(`/api/admin/invites/${id}/revoke`, { method: 'POST' });
}
