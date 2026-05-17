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
import * as logger from '../lib/logger.js';

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

const errorTypes = [
  ValidationError,
  StateError,
  HaproxyError,
  CertbotError,
  ReloadError,
  ConfigError,
  AuthError,
  ForbiddenError,
];

const statusForError = err => {
  for (const Cls of errorTypes) {
    if (err instanceof Cls) {
      return STATUS_BY_NAME[err.name] ?? 500;
    }
  }
  return 500;
};

export const apiError = () => (err, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = statusForError(err);
  logger.error('request failed', {
    name: err.name,
    message: err.message,
    method: req.method,
    path: req.originalUrl,
    status,
    issues: err.issues,
    output: err.output,
    hints: err.hints,
  });
  res.status(status).json({
    error: err.name ?? 'Error',
    message: err.message ?? 'internal error',
    issues: err.issues ?? undefined,
    output: err.output ?? undefined,
    hints: err.hints && err.hints.length > 0 ? err.hints : undefined,
  });
};
