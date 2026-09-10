import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { signJwt, verifyJwt } from '../utils/jwt';
import { verifyPassword } from '../services/auth';
import { findAdminUserByEmail } from '../db/queries/adminUsers';

export const auth = new Hono<AppEnv>();

const COOKIE_NAME = 'admin_token';
const COOKIE_OPTS = 'HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800';

auth.post('/login', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  const { email, password } = body as { email?: string; password?: string };
  if (!email || !password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  const user = await findAdminUserByEmail(c.env.DB, email.toLowerCase().trim());

  // Constant-time path: always call verifyPassword even on miss so timing
  // doesn't reveal whether the email exists.
  const sentinel = 'pbkdf2:100000:AAAAAAAAAAAAAAAAAAAAAA==:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, sentinel).then(() => false);

  if (!ok || !user) {
    return c.json({ error: 'Invalid email or password' }, 401);
  }

  const token = await signJwt({ sub: user.email, role: user.role }, c.env.ADMIN_JWT_SECRET);
  c.header('Set-Cookie', `${COOKIE_NAME}=${token}; ${COOKIE_OPTS}`);

  return c.json({ email: user.email, role: user.role });
});

auth.post('/logout', (c) => {
  // Expire the cookie immediately
  c.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
  return c.json({ ok: true });
});

auth.get('/me', async (c) => {
  const cookieHeader = c.req.header('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  const token = match?.[1];

  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const payload = await verifyJwt(token, c.env.ADMIN_JWT_SECRET);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  return c.json({ email: payload.sub, role: payload.role });
});
