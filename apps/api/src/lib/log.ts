/**
 * The redacting logger (design.md §9.8, ER-SEC-4). All logging in webhook and auth
 * handlers goes through `safeLog()` — pinned by a static contract test
 * (seam-isolation.contract.test.ts) that forbids raw `console.*` calls in those files
 * unless the file also imports this module. `safeLog` redacts E.164-shaped numbers and
 * email addresses before anything is emitted, so accidental logging of personal data
 * never reaches Workers logs/analytics.
 */

const E164_PATTERN = /\+[1-9]\d{1,14}/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

function redact(value: string): string {
  return value.replace(E164_PATTERN, '[redacted-e164]').replace(EMAIL_PATTERN, '[redacted-email]');
}

/** Recursively redacts string values inside plain JSON-serialisable structures. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out;
  }
  return value;
}

export type LogLevel = 'info' | 'warn' | 'error';

export interface SafeLogMeta {
  [key: string]: unknown;
}

/** The only logging entry point allowed in webhook/auth handlers and middleware. */
export function safeLog(level: LogLevel, message: string, meta: SafeLogMeta = {}): void {
  const line = JSON.stringify({
    level,
    message: redact(message),
    ...(redactDeep(meta) as Record<string, unknown>),
    ts: new Date().toISOString(),
  });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}
