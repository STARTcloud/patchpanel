// Domain error classes. Every error carries an i18n `code` (e.g.
// 'peer.token.missing') that the api-error middleware translates at
// response time via req.__(). The internal `.message` defaults to the
// code so logs and stack traces still show a meaningful identifier;
// callers can override with `options.message` for developer-facing
// detail. `options.replacements` carries {{template}} substitutions
// the translator applies to the localized string.

export class ApiError extends Error {
  constructor(code, options = {}) {
    const { message, replacements, cause } = options;
    super(message ?? code, { cause });
    this.name = 'ApiError';
    this.code = code;
    this.replacements = replacements ?? {};
  }
}

export class ValidationError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'ValidationError';
    this.issues = options.issues ?? [];
  }
}

export class StateError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'StateError';
  }
}

export class HaproxyError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'HaproxyError';
    this.output = options.output ?? '';
    this.hints = [];
  }
}

export class CertbotError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'CertbotError';
    this.exitCode = options.exitCode ?? null;
    this.output = options.output ?? '';
  }
}

export class ConfigError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'ConfigError';
  }
}

export class ReloadError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'ReloadError';
  }
}

export class AuthError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends ApiError {
  constructor(code, options = {}) {
    super(code, options);
    this.name = 'ForbiddenError';
  }
}
