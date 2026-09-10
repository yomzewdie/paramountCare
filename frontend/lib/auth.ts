// Auth helpers for Server Actions and Server Components.

function getApiBase(): string {
  return process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8787';
}

export interface LoginResult {
  ok: true;
  email: string;
  role: string;
  setCookieHeader: string;
}

export interface LoginError {
  ok: false;
  message: string;
}

export async function loginAdmin(
  email: string,
  password: string,
): Promise<LoginResult | LoginError> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, message: 'Unable to reach the server. Please try again.' };
  }

  if (!res.ok) {
    let msg = 'Invalid email or password.';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch { /* ignore */ }
    return { ok: false, message: msg };
  }

  const body = (await res.json()) as { email: string; role: string };
  const setCookieHeader = res.headers.get('set-cookie') ?? '';

  return { ok: true, email: body.email, role: body.role, setCookieHeader };
}

export async function logoutAdmin(): Promise<void> {
  await fetch(`${getApiBase()}/api/auth/logout`, { method: 'POST' });
}
