export class StateError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StateError';
  }
}

export class ValidationError extends Error {
  constructor(message, issues, options) {
    super(message, options);
    this.name = 'ValidationError';
    this.issues = issues ?? [];
  }
}

export class HaproxyError extends Error {
  constructor(message, output, options) {
    super(message, options);
    this.name = 'HaproxyError';
    this.output = output ?? '';
    this.hints = [];
  }
}

export class CertbotError extends Error {
  constructor(message, opts) {
    const { exitCode, output, ...rest } = opts ?? {};
    super(message, rest);
    this.name = 'CertbotError';
    this.exitCode = exitCode ?? null;
    this.output = output ?? '';
  }
}

export class ConfigError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

export class ReloadError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReloadError';
  }
}

export class AuthError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ForbiddenError';
  }
}
