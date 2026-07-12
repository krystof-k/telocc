import type { EmailSender } from '../../apps/api/src/lib/email.ts';

export interface CapturedEmail {
  to: string;
  subject: string;
  text: string;
  sentAt: Date;
}

export interface CaptureMailbox {
  /** Injected as `deps.email` — the `dev` in-process mailbox port (design.md §6). */
  email: EmailSender;
  sent: CapturedEmail[];
  /** Most recently sent message to `to`, or throws if none exists. */
  latestFor(to: string): CapturedEmail;
  clear(): void;
}

/**
 * A fake `EmailSender` that records every message instead of delivering it — the
 * contract-test equivalent of the `dev` mailbox (design.md §6, §12).
 */
export function createCaptureMailbox(now: () => Date = () => new Date()): CaptureMailbox {
  const sent: CapturedEmail[] = [];
  const mailbox: CaptureMailbox = {
    email: {
      async send(msg) {
        sent.push({ ...msg, sentAt: now() });
      },
    },
    sent,
    latestFor(to) {
      const messages = sent.filter((m) => m.to === to);
      const latest = messages.at(-1);
      if (!latest) {
        throw new Error(`captureMailbox: no email was sent to ${to}`);
      }
      return latest;
    },
    clear() {
      sent.length = 0;
    },
  };
  return mailbox;
}

/**
 * Extracts a magic-link token from an email's body. The contract assumes the dev
 * mailbox's message text contains the verification URL with a `token=` query param,
 * matching `GET /api/auth/magic-link/verify` (design.md §7) — documented in
 * tests/helpers/README.md as a constraint on M2's `EmailSender` copy.
 */
export function extractMagicLinkToken(email: CapturedEmail): string {
  const match = email.text.match(/[?&]token=([^\s&"'<>]+)/);
  if (!match?.[1]) {
    throw new Error(
      `extractMagicLinkToken: no token= query param found in email text: ${email.text}`,
    );
  }
  return decodeURIComponent(match[1]);
}
