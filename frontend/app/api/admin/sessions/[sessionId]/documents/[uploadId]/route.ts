import { NextRequest } from 'next/server';
import { jsonError, proxyAdminDownload } from '@/lib/admin-proxy';

// Download of a file an applicant still onboarding has attached. The browser
// supplies only the session id and a numeric upload id — never a storage key —
// and the Worker serves it only if that upload is a live, counted document of
// that session. Its Content-Type/Content-Disposition are forwarded as-is.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; uploadId: string }> },
) {
  const { sessionId, uploadId } = await params;
  if (!/^\d+$/.test(uploadId)) return jsonError('Invalid document id', 400);

  return proxyAdminDownload(
    `/api/admin/sessions/${encodeURIComponent(sessionId)}/documents/${uploadId}/download`,
    null,
  );
}
