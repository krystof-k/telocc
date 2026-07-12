/**
 * Shared Hono `Variables` typing (design.md §6 "org-scoping pattern"): session
 * middleware resolves `userId`, org middleware resolves the single `membership` and
 * sets `orgId`/`role`. Every route/middleware module uses the same `AppEnv` so
 * `c.set`/`c.get` stay typed consistently across sub-routers mounted via `app.route`.
 */
export interface AppEnv {
  Variables: {
    userId?: string;
    orgId?: string;
    role?: 'owner';
    /** Cache for the parsed request-body email (routes/auth.ts) so a `.clone()` read
     * for rate-limit identification and the handler's own read never race the same
     * underlying stream twice. `undefined` = not yet read; `null` = read, no email. */
    bodyEmail?: string | null;
  };
}
