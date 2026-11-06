import { NextRequest } from 'next/server';
import { jsonError, proxyAdminDownload } from '@/lib/admin-proxy';

// The document viewer's preview of an in-progress applicant's file, under the
// same rules as the download beside it. The Worker serves a PDF, JPEG or PNG
// inline and answers 415 for anything else.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string; uploadId: string }> },
) {
  const { sessionId, uploadId } = await params;
  if (!/^\d+$/.test(uploadId)) return jsonError('Invalid document id', 400);

  return proxyAdminDownload(
    `/api/admin/sessions/${encodeURIComponent(sessionId)}/documents/${uploadId}/preview`,
    null,
  );
}
