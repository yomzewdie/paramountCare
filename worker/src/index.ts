import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { health } from './routes/health';
import { onboarding } from './routes/onboarding';

const app = new Hono();

app.use('*', cors());

app.route('/health', health);
app.route('/api', onboarding);

app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
