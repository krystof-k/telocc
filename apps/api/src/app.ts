import { Hono } from 'hono';
import type { Deps } from './deps.ts';
import { buildBetterAuth } from './lib/auth.ts';
import type { AppEnv } from './lib/context.ts';
import { requireOrg } from './middleware/org.ts';
import { securityHeaders } from './middleware/security-headers.ts';
import { requireSession } from './middleware/session.ts';
import { authRoutes } from './routes/auth.ts';
import { healthRoute } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { orgsRoutes } from './routes/orgs.ts';

/** Method+path pairs reachable with a session but no org yet (design.md §6). */
function bypassesOrgGate(method: string, path: string): boolean {
  return (method === 'GET' && path === '/api/me') || (method === 'POST' && path === '/api/orgs');
}

/**
 * Assembles the Hono app from injected deps — the one factory both runtimes and the
 * contract-test harness call (design.md §1, testing.md). Route modules are added
 * milestone by milestone.
 */
export function buildApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  const auth = buildBetterAuth(deps);

  app.use('*', securityHeaders);
  app.route('/health', healthRoute(deps));

  // Mounted before the `/api/*` gate below so magic-link/session/sign-out endpoints
  // stay public — Hono's routing terminates at this sub-app's handler (it never calls
  // `next()`), so requests under `/api/auth/*` never reach the gate middleware
  // registered afterward.
  app.route('/api/auth', authRoutes(deps, auth));

  // Session + org gate for everything else under `/api/*` (design.md §6 "Org-scoping
  // pattern"): 401 with no session, 403 with a session but no membership — except the
  // two routes an org-less-but-logged-in user must be able to reach.
  app.use('/api/*', requireSession(auth));
  app.use('/api/*', async (c, next) => {
    if (bypassesOrgGate(c.req.method, c.req.path)) return next();
    return requireOrg(deps.db)(c, next);
  });

  app.route('/api/me', meRoutes(deps));
  app.route('/api', orgsRoutes(deps));

  return app;
}

export type App = ReturnType<typeof buildApp>;
