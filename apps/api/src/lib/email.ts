/**
 * The EmailSender port (decisions.md #16). `dev` (in-process mailbox) and `resend`
 * implementations below.
 */
export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}

export interface DevMailboxMessage {
  to: string;
  subject: string;
  text: string;
  sentAt: Date;
}

export interface DevEmailSender extends EmailSender {
  readonly sent: DevMailboxMessage[];
}

/**
 * `EMAIL_PROVIDER=dev` — an in-process mailbox (design.md §6/§12). Real deliveries are
 * never sent; messages are recorded for the `/dev/mailbox` panel (M4's route surfaces
 * this list; the sender itself is wired here so `deps.ts` has something real to use in
 * dev/demo without waiting on that route).
 */
export function createDevEmailSender(now: () => Date = () => new Date()): DevEmailSender {
  const sent: DevMailboxMessage[] = [];
  return {
    sent,
    async send(msg) {
      sent.push({ ...msg, sentAt: now() });
    },
  };
}

/** `EMAIL_PROVIDER=resend` — production implementation (owner supplies the API key). */
export function createResendEmailSender(params: { apiKey: string; from: string }): EmailSender {
  return {
    async send(msg) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${params.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: params.from,
          to: msg.to,
          subject: msg.subject,
          text: msg.text,
        }),
      });
      if (!res.ok) {
        throw new Error(`resend: send failed with status ${res.status}`);
      }
    },
  };
}
