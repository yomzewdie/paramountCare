import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';
import { verifyJwt } from '../utils/jwt';

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const cookieHeader = c.req.header('cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  const token = match?.[1];

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
