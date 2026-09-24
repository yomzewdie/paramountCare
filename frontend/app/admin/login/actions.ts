'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { loginAdmin } from '@/lib/auth';
import { safeRedirectTarget } from '@/lib/safe-redirect';

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

  // Forward the httpOnly cookie from the worker response into the browser.
  // The worker sends: admin_token=<jwt>; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800
  // We parse out just the value and set it ourselves so Next.js controls the attributes.
  const tokenMatch = result.setCookieHeader.match(/admin_token=([^;]+)/);
  if (tokenMatch) {
    const cookieStore = await cookies();
    cookieStore.set('admin_token', tokenMatch[1], {
      httpOnly:  true,
      secure:    process.env.NODE_ENV === 'production',
      sameSite:  'strict',
      path:      '/',
      maxAge:    8 * 60 * 60,
    });
  }

  redirect(safeRedirectTarget(redirectTo));
}
