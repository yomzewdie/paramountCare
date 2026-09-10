import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv } from './env';
import { health } from './routes/health';
import { onboarding } from './routes/onboarding';
import { uploads } from './routes/uploads';
import { auth } from './routes/auth';
import { admin } from './routes/admin';

const app = new Hono<AppEnv>();

app.use('*', cors());

app.route('/health',     health);
app.route('/api/auth',   auth);
app.route('/api/admin',  admin);
app.route('/api',        onboarding);
app.route('/api/uploads', uploads);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
