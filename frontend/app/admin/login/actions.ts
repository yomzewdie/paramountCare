'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginAdmin } from '@/lib/auth';
import { ADMIN_COOKIE_NAME } from '@/lib/admin-token';
import { safeRedirectTarget } from '@/lib/safe-redirect';

const DEFAULT_SESSION_SECONDS = 8 * 60 * 60;

// Never longer than the default, and a missing/zero Worker Max-Age falls back
// to it rather than producing an immediately-expiring cookie.
function sessionSeconds(workerMaxAge: number | null): number {
  return workerMaxAge && workerMaxAge > 0 ? Math.min(workerMaxAge, DEFAULT_SESSION_SECONDS) : DEFAULT_SESSION_SECONDS;
}

export async function loginAction(formData: FormData): Promise<void> {
  const email    = (formData.get('email')    as string | null) ?? '';
  const password = (formData.get('password') as string | null) ?? '';
  const redirectTo = (formData.get('redirect') as string | null) ?? '/admin';

  if (!email || !password) {
    redirect(`/admin/login?error=${encodeURIComponent('Email and password are required.')}&redirect=${encodeURIComponent(redirectTo)}`);
  }

  const result = await loginAdmin(email, password);

  if (!result.ok) {
    redirect(`/admin/login?error=${encodeURIComponent(result.message)}&redirect=${encodeURIComponent(redirectTo)}`);
  }

  // The Worker call was server-to-server, so its Set-Cookie never reached the
  // browser. Issue the portal's OWN HttpOnly session cookie on this origin.
  // (The Worker's refresh token is intentionally not carried over — the portal
  // session lasts the access-token lifetime.) This must happen BEFORE
  // redirect(), which throws to end the action.
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE_NAME, result.adminToken, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path:     '/',
    maxAge:   sessionSeconds(result.adminTokenMaxAgeSeconds),
  });

  redirect(safeRedirectTarget(redirectTo));
}
