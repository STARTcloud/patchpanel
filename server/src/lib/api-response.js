import { t } from './i18n.js';

// Build the standard error response body. Every patchpanel 4xx/5xx response
// emits this shape so the SPA and external scripts can branch on a stable
// `code` while operators read the localized `message`.
//
//   { error: { code: 'peer.token.missing', message: 'Token is required…' } }
//
// `errorResponse(req, code)` translates via req.__() when the i18n
// middleware has run on this request; otherwise it falls back to the
// default-locale `t()` helper so non-request call sites (background jobs,
// tests) still produce a localized message.
//
// Callers add status code + optional sibling fields (issues, hints, output,
// ok flags) by spreading: res.status(400).json({ ok: false, ...errorResponse(req, 'x.y') }).

const localize = (req, code, replacements) => {
  if (req && typeof req.__ === 'function') {
    return req.__(code, replacements);
  }
  return t(code, undefined, replacements);
};

export const errorResponse = (req, code, replacements = {}) => ({
  error: {
    code,
    message: localize(req, code, replacements),
  },
});

// Convenience for cases where the caller needs just the localized string
// (e.g. a thrown Error's message, an audit detail). Same locale-resolution
// behaviour as errorResponse() but returns the bare string.
export const localizeMessage = (req, code, replacements = {}) => localize(req, code, replacements);
