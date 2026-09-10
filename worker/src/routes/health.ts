import { Hono } from 'hono';
import type { AppEnv } from '../env';

const health = new Hono<AppEnv>();

health.get('/', (c) => {
  return c.json({ status: 'ok', service: 'nursing-onboarding-api' });
});

export { health };
