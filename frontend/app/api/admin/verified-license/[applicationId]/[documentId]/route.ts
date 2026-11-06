import { NextRequest } from 'next/server';
import { isCrossOrigin, jsonError, proxyAdminJson, proxyAdminUpload } from '@/lib/admin-proxy';

// Replace or remove one Verified License. The browser supplies only a numeric
// document id; the Worker is the authority on the admin's role and on that id
// being a Verified License of this application.
type Params = { params: Promise<{ applicationId: string; documentId: string }> };

async function workerPath({ params }: Params): Promise<string | null> {
  const { applicationId, documentId } = await params;
  if (!/^\d+$/.test(documentId)) return null;
  return `/api/admin/application/${encodeURIComponent(applicationId)}/verified-license/${documentId}`;
}

export async function PUT(req: NextRequest, context: Params) {
  if (isCrossOrigin(req)) return jsonError('Forbidden', 403);
  const path = await workerPath(context);
  if (!path) return jsonError('Invalid document id', 400);
  return proxyAdminUpload(path, req, 'PUT');
}

export async function DELETE(req: NextRequest, context: Params) {
  if (isCrossOrigin(req)) return jsonError('Forbidden', 403);
  const path = await workerPath(context);
  if (!path) return jsonError('Invalid document id', 400);
  return proxyAdminJson(path, { method: 'DELETE' });
}
