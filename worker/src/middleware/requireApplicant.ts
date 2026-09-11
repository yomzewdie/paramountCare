import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../env';

// Defense-in-depth alongside the ownership check in routes/sessions.ts: an
// admin's valid token must never be usable to create/claim/read an onboarding
// session, even though it passes requireAuth (any valid, unexpired token).
export const requireApplicant: MiddlewareHandler<AppEnv> = async (c, next) => {
  const payload = c.get('jwtPayload');
  if (!payload) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (payload.userType !== 'applicant') {
    return c.json({ error: 'Forbidden' }, 403);
  }
  await next();
};
