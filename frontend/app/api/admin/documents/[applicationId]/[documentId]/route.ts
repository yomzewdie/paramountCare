import { NextRequest } from 'next/server';
import { jsonError, proxyAdminDownload } from '@/lib/admin-proxy';

// Generic proxy for any applicant-uploaded document (voided check, vaccine
// proof, identity/credential documents). The browser supplies only the
// application id and a numeric document id — never a storage key — and the
// Worker enforces that the document belongs to that application. The
// Worker's own Content-Type/Content-Disposition (already sanitized and
// allowlisted there) are forwarded as-is.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string; documentId: string }> },
) {
  const { applicationId, documentId } = await params;
  if (!/^\d+$/.test(documentId)) return jsonError('Invalid document id', 400);

  return proxyAdminDownload(
    `/api/admin/application/${encodeURIComponent(applicationId)}/documents/${documentId}/download`,
    null,
  );
}
