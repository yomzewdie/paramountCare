import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ applicationId: string }> },
) {
  const { applicationId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get('admin_token')?.value ?? '';

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
  const upstream = await fetch(
    `${apiBase}/api/admin/application/${applicationId}/i9-pdf`,
    {
      headers: { cookie: `admin_token=${token}` },
      cache: 'no-store',
    },
  );

  if (!upstream.ok) {
    const body = await upstream.text().catch(() => 'Unknown error');
    return NextResponse.json({ error: body }, { status: upstream.status });
  }

  const pdf = await upstream.arrayBuffer();
  return new NextResponse(pdf, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="I9-Section1-${applicationId}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
