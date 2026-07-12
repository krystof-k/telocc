import { Hono } from 'hono';
import type { Deps } from './deps.ts';
import { securityHeaders } from './middleware/security-headers.ts';
import { healthRoute } from './routes/health.ts';

/**
 * Assembles the Hono app from injected deps — the one factory both runtimes and the
 * contract-test harness call (design.md §1, testing.md). Route modules are added
 * milestone by milestone; M0 wires only the health check.
 */
export function buildApp(deps: Deps) {
  const app = new Hono();

  app.use('*', securityHeaders);
  app.route('/health', healthRoute(deps));

  return app;
}

export type App = ReturnType<typeof buildApp>;
