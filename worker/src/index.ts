import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './env';
import { health } from './routes/health';
import { onboarding } from './routes/onboarding';
import { uploads } from './routes/uploads';
import { auth } from './routes/auth';
import { admin } from './routes/admin';
import { sessions } from './routes/sessions';
import { invites } from './routes/invites';
import { inviteValidation } from './routes/inviteValidation';

// Routes are chained (rather than called as separate statements) so that
// TypeScript can infer the merged route type below. Runtime registration
// order and behavior are unchanged either way — this only affects what the
// exported `AppType` type carries for hono/client consumers (see
// packages/api-client).
const app = new Hono<AppEnv>()
  .use('*', cors())
  .route('/health', health)
  .route('/api/auth', auth)
  .route('/api/admin', admin)
  .route('/api/admin/invites', invites)
  .route('/api/invites', inviteValidation)
  .route('/api', onboarding)
  .route('/api/uploads', uploads)
  .route('/api/sessions', sessions);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export type AppType = typeof app;
export default app;
