import { NextRequest } from 'next/server';
import { isCrossOrigin, jsonError, proxyAdminUpload } from '@/lib/admin-proxy';

// Admin-only Verified License upload. The Worker is the authority on the
// admin's role, the application, and the file itself; this only forwards the
// signed-in admin's request.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  if (isCrossOrigin(req)) return jsonError('Forbidden', 403);
  const { applicationId } = await params;
  return proxyAdminUpload(`/api/admin/application/${encodeURIComponent(applicationId)}/verified-license`, req);
}
