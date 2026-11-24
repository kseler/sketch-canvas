import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { generateRoute } from './generate';

// The HTTP routes, without starting a server, so tests can call them with app.request().
export function createApp(): Hono {
  const app = new Hono();
  // Open to every origin for now. Restrict to the web app's origin before the generate pipeline
  // spends money (tracked in the security plan).
  app.use('/api/*', cors());
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/generate', generateRoute);
  return app;
}
