import type { MiddlewareHandler } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { verifyJwt } from '../utils/jwt';

function extractToken(c: Context<AppEnv>): string | undefined {
  const authHeader = c.req.header('Authorization') ?? c.req.header('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  const cookieHeader = c.req.header('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match?.[1];
}

// Centralized access-token verification for every protected route, admin and
// applicant alike. Two transports are supported so the same middleware works
// for native mobile clients (Authorization: Bearer <token>, no cookies) and
// the existing admin web app (HttpOnly admin_token cookie, unchanged from
// before — the admin frontend requires no changes for this to keep working).
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = extractToken(c);
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyJwt(token, c.env.ADMIN_JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  c.set('jwtPayload', payload);
  await next();
};
