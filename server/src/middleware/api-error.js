import {
  AuthError,
  CertbotError,
  ConfigError,
  ForbiddenError,
  HaproxyError,
  ReloadError,
  StateError,
  ValidationError,
} from '../lib/errors.js';
import { localizeMessage } from '../lib/api-response.js';
import { log } from '../lib/logger.js';

// Catch-all error middleware. Translates the error's i18n code (added by
// the domain classes in lib/errors.js) into the request's locale, picks an
// appropriate HTTP status from the class, and emits the standard response
// shape:
//
//   { error: { code, message }, issues?, output?, hints? }
//
// Errors that pre-date the i18n refactor (or come from third-party packages
// without a `.code`) fall back to a generic `api.unknownError` envelope so
// the SPA never receives a raw English crash dump.

const STATUS_BY_NAME = Object.freeze({
  ValidationError: 422,
  StateError: 500,
  HaproxyError: 502,
  CertbotError: 502,
  ReloadError: 503,
  ConfigError: 500,
  AuthError: 401,
  ForbiddenError: 403,
});

const ERROR_TYPES = Object.freeze([
  ValidationError,
  StateError,
  HaproxyError,
  CertbotError,
  ReloadError,
  ConfigError,
  AuthError,
  ForbiddenError,
]);

const statusForError = err => {
  for (const Cls of ERROR_TYPES) {
    if (err instanceof Cls) {
      return STATUS_BY_NAME[err.name] ?? 500;
    }
  }
  return 500;
};

const resolveCode = err => {
  if (typeof err.code === 'string' && err.code.length > 0) {
    return err.code;
  }
  return 'api.unknownError';
};

const resolveMessage = (req, err) => {
  if (typeof err.code === 'string' && err.code.length > 0) {
    return localizeMessage(req, err.code, err.replacements ?? {});
  }
  // Unknown / external error — translate the generic fallback, log the
  // original english `.message` separately so operators can still grep
  // for the actual cause.
  return localizeMessage(req, 'api.unknownError');
};

export const apiError = () => (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = statusForError(err);
  const code = resolveCode(err);
  const message = resolveMessage(req, err);
  log.api.error('request failed', {
    name: err.name,
    code,
    rawMessage: err.message,
    method: req.method,
    path: req.originalUrl,
    status,
    issues: err.issues,
    output: err.output,
    hints: err.hints,
  });
  res.status(status).json({
    error: { code, message },
    issues: err.issues && err.issues.length > 0 ? err.issues : undefined,
    output: err.output ? err.output : undefined,
    hints: err.hints && err.hints.length > 0 ? err.hints : undefined,
  });
};
