import type { Db } from '@telocc/db';
import { user as userTable } from '@telocc/db';
import { eq } from 'drizzle-orm';
import type { App } from '../../apps/api/src/app.ts';
import { type CaptureMailbox, extractMagicLinkToken } from './mailbox.ts';

/** `POST /api/auth/sign-in/magic-link` (design.md §6, §7). */
export async function requestMagicLink(app: App, email: string): Promise<Response> {
  return app.request('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  });
}

function cookieHeaderFrom(res: Response): { cookieHeader: string; setCookieHeaders: string[] } {
  const withGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookieHeaders =
    typeof withGetSetCookie.getSetCookie === 'function'
      ? withGetSetCookie.getSetCookie()
      : (() => {
          const single = res.headers.get('set-cookie');
          return single ? [single] : [];
        })();
  const cookieHeader = setCookieHeaders.map((c) => c.split(';')[0]).join('; ');
  return { cookieHeader, setCookieHeaders };
}

export interface MagicLinkLoginResult {
  requestResponse: Response;
  verifyResponse: Response;
  cookieHeader: string;
  setCookieHeaders: string[];
}

/**
 * Drives the real magic-link boundary end to end: request → capture the dev mailbox →
 * extract the token → verify → return a `Cookie:` header value usable on subsequent
 * requests. Used by every contract file that needs "a logged-in owner", not only
 * auth.contract.test.ts — deliberately never a DB-fixture shortcut around the session
 * cookie mechanism (docs/testing.md, brief.md "validate at real boundaries").
 */
export async function loginViaMagicLink(
  app: App,
  mailbox: CaptureMailbox,
  email: string,
): Promise<MagicLinkLoginResult> {
  const requestResponse = await requestMagicLink(app, email);
  const captured = mailbox.latestFor(email);
  const token = extractMagicLinkToken(captured);
  const verifyResponse = await app.request(
    `/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`,
  );
  const { cookieHeader, setCookieHeaders } = cookieHeaderFrom(verifyResponse);
  return { requestResponse, verifyResponse, cookieHeader, setCookieHeaders };
}

/** Looks up the Better-Auth `user.id` created by a magic-link login, by email. */
export async function findUserIdByEmail(db: Db, email: string): Promise<string> {
  const rows = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, email));
  const row = rows[0];
  if (!row) {
    throw new Error(`findUserIdByEmail: no user row found for ${email}`);
  }
  return row.id;
}
