import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

export function requireRole(...roles: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const payload = c.get('jwtPayload');
    if (!payload || !roles.includes(payload.role)) {
      return c.json({ error: 'Forbidden' }, 403);
    }
    await next();
  };
}
