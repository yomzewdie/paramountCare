import { NextRequest } from 'next/server';
import { proxyAdminDownload } from '@/lib/admin-proxy';

// Streams the signed W-4 PDF. It contains the applicant's full SSN (see
// worker/src/services/w4pdf.ts), so it is never cached and no storage URL is
// ever exposed to the browser.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await params;
  return proxyAdminDownload(`/api/admin/application/${encodeURIComponent(applicationId)}/w4-pdf`, {
    contentType: 'application/pdf',
    disposition: 'attachment; filename="W4-signed.pdf"',
  });
}
