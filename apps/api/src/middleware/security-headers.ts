import { secureHeaders } from 'hono/secure-headers';

/**
 * design.md §9.6: CSP `default-src 'self'` (single-origin SPA, no third-party
 * origins), HSTS, nosniff, `frame-ancestors 'none'`, `Referrer-Policy: same-origin`.
 */
export const securityHeaders = secureHeaders({
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    frameAncestors: ["'none'"],
  },
  xContentTypeOptions: 'nosniff',
  referrerPolicy: 'same-origin',
  strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
});
