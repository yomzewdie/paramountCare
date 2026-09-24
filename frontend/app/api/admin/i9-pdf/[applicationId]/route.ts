import { NextRequest } from 'next/server';
import { proxyAdminDownload } from '@/lib/admin-proxy';

// Streams the signed I-9 Section 1 PDF; never cached, no storage URL exposed.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await params;
  return proxyAdminDownload(`/api/admin/application/${encodeURIComponent(applicationId)}/i9-pdf`, {
    contentType: 'application/pdf',
    disposition: 'attachment; filename="I9-Section1-signed.pdf"',
  });
}
