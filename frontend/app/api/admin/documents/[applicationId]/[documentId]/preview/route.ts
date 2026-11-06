import { NextRequest } from 'next/server';
import { jsonError, proxyAdminDownload } from '@/lib/admin-proxy';

// The document viewer's preview of the same protected document the download
// route serves, by application id and numeric document id only. The Worker
// decides whether the file may be shown inline (a PDF, JPEG or PNG recorded
// at upload) and answers 415 for anything else; its Content-Type and inline
// Content-Disposition are forwarded as-is.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string; documentId: string }> },
) {
  const { applicationId, documentId } = await params;
  if (!/^\d+$/.test(documentId)) return jsonError('Invalid document id', 400);

  return proxyAdminDownload(
    `/api/admin/application/${encodeURIComponent(applicationId)}/documents/${documentId}/preview`,
    null,
  );
}
