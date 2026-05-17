import { rateLimit } from 'express-rate-limit';

// Global per-IP rate limit applied before all routes. Generous enough that
// normal interactive browsing (UI bundle load, polling stats, audit views)
// stays well under the cap, but tight enough to bound abuse against
// filesystem-touching endpoints (cert upload/delete, auth-provider test,
// SPA catch-all that does fs.stat per request). Tune via config if a
// deployment needs different limits.

export const globalRateLimit = (opts = {}) =>
  rateLimit({
    windowMs: opts.windowMs ?? 60_000,
    limit: opts.limit ?? 600,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'too many requests' },
  });
