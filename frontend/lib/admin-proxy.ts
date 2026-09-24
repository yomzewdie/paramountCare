// Server-side helpers for the /api/admin/** Route Handlers that proxy the
// browser's admin actions to the Worker. The browser only ever talks to this
// Next.js origin; the admin_token cookie is forwarded server-side and the
// Worker remains the authority on authentication, role, and ownership.

import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getWorkerBaseUrl } from './server-config';

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * State-changing proxy routes accept only same-origin browser requests. The
 * admin_token cookie is already SameSite=Strict; this is a second, explicit
 * layer. A request with no Origin header (non-browser client, same-origin GET
 * navigation) is not rejected here — it still needs a valid admin cookie.
 */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function getAdminToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('admin_token')?.value || null;
}

/** Forward a JSON request to the Worker as the signed-in admin. */
export async function proxyAdminJson(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<NextResponse> {
  const token = await getAdminToken();
  if (!token) return jsonError('Unauthorized', 401);

  let upstream: Response;
  try {
    upstream = await fetch(`${getWorkerBaseUrl()}${path}`, {
      method: init.method,
      headers: {
        cookie: `admin_token=${token}`,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: 'no-store',
    });
  } catch {
    return jsonError('Unable to reach the server. Please try again.', 502);
  }

  const parsed = (await upstream.json().catch(() => null)) as Record<string, unknown> | null;
  if (!upstream.ok) {
    // Only the Worker's own short `error` string is relayed — never a raw
    // upstream body.
    const message = typeof parsed?.error === 'string' ? parsed.error : 'Request failed.';
    return jsonError(message, upstream.status);
  }
  return NextResponse.json(parsed ?? {}, { status: upstream.status, headers: NO_STORE });
}

/** Stream a protected file from the Worker without exposing storage keys. */
export async function proxyAdminDownload(
  path: string,
  fallback: { contentType: string; disposition: string } | null,
): Promise<NextResponse> {
  const token = await getAdminToken();
  if (!token) return jsonError('Unauthorized', 401);

  let upstream: Response;
  try {
    upstream = await fetch(`${getWorkerBaseUrl()}${path}`, {
      headers: { cookie: `admin_token=${token}` },
      cache: 'no-store',
    });
  } catch {
    return jsonError('Unable to reach the server. Please try again.', 502);
  }

  if (!upstream.ok) {
    const parsed = (await upstream.json().catch(() => null)) as { error?: unknown } | null;
    return jsonError(typeof parsed?.error === 'string' ? parsed.error : 'Download failed.', upstream.status);
  }

  const bytes = await upstream.arrayBuffer();
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': upstream.headers.get('content-type') ?? fallback?.contentType ?? 'application/octet-stream',
      'Content-Disposition': upstream.headers.get('content-disposition') ?? fallback?.disposition ?? 'attachment',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
