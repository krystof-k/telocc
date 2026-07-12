/**
 * Twilio adapter barrel. Import only via the `@telocc/telephony/twilio` subpath — the
 * single composition point (`apps/api/src/deps.ts`, wired behind
 * `TELEPHONY_PROVIDER=twilio`) is the only file outside this package permitted to do so
 * (design.md §4.6 leak prevention).
 */
export * from './config.ts';
export * from './provider.ts';
export * from './rest.ts';
export * from './signature.ts';
export * from './twiml.ts';
export * from './webhook-parse.ts';
