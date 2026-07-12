/**
 * NOT the runtime Better Auth instance — that gets wired in apps/api during M2
 * (session/org middleware, EmailSender port, rate limiting). This file exists
 * solely to drive `@better-auth/cli generate`, which introspects a betterAuth()
 * config to emit the matching Drizzle schema (design.md §3.1, milestones.md M0).
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { magicLink } from 'better-auth/plugins/magic-link';

export const auth = betterAuth({
  database: drizzleAdapter({}, { provider: 'pg' }),
  session: {
    // IP/UA tracking disabled — data minimisation (ER-SEC-4, design.md §3.1).
  },
  advanced: {
    useSecureCookies: true,
    ipAddress: {
      disableIpTracking: true,
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async () => {
        // wired for real in apps/api (M2)
      },
    }),
  ],
});
