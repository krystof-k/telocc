/**
 * The EmailSender port (decisions.md #16). `dev` (in-process mailbox) and `resend`
 * implementations land in M2 — this is the two-line interface only.
 */
export interface EmailSender {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}
