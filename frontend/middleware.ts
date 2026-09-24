import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminToken } from '@/lib/admin-token';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isAdminApi = pathname.startsWith('/api/admin');

  // Guard /admin/** pages and the /api/admin/** proxy routes — skip the login
  // page itself to avoid redirect loops.
  if (!isAdminApi && (!pathname.startsWith('/admin') || pathname.startsWith('/admin/login'))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;
  const secret = process.env.ADMIN_JWT_SECRET ?? '';

  if (!token || !secret || !(await verifyAdminToken(token, secret))) {
    // API/proxy callers (downloads, invitation actions) get a plain 401, not
    // an HTML redirect they cannot act on.
    if (isAdminApi) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

    const loginUrl = new URL('/admin/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
