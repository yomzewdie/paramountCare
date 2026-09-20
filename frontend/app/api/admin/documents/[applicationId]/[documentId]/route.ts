import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

// Generic proxy for any applicant-uploaded document (voided check, vaccine
// proof, identity/credential documents) — mirrors the existing
// app/api/admin/i9-pdf/[applicationId]/route.ts proxy pattern exactly, but
// forwards the Worker's own Content-Type/Content-Disposition instead of a
// hardcoded PDF-only pair, since documents here can be PDF, JPEG, or PNG.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string; documentId: string }> },
) {
  const { applicationId, documentId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
  const upstream = await fetch(
    `${apiBase}/api/admin/application/${applicationId}/documents/${documentId}/download`,
    {
      headers: { cookie: `admin_token=${token}` },
      cache: 'no-store',
    },
  );

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => 'Unknown error');
    return NextResponse.json({ error: body }, { status: upstream.status });
  }

  const fileBytes = await upstream.arrayBuffer();
  return new NextResponse(fileBytes, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? 'attachment',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
