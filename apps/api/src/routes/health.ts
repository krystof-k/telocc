import { Hono } from 'hono';
import type { Deps } from '../deps.ts';

export function healthRoute(_deps: Deps) {
  const app = new Hono();
  app.get('/', (c) => c.json({ ok: true, service: 'telocc-api' }));
  return app;
}
