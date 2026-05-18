import jwt from 'jsonwebtoken';

import { AuthError } from './errors.js';

// JWT helpers — single-secret HS256, claims-shaped for cookie sessions.
// The cookie carries this token; the auth middleware extracts + verifies.
// API tokens are a separate surface (lib/api-tokens.js) and do NOT use JWT.

const ALGORITHM = 'HS256';
const ISSUER = 'patchpanel';
const AUDIENCE = 'patchpanel-ui';

const requireSecret = secret => {
  if (typeof secret !== 'string' || secret.length < 32) {
    throw new Error('JWT secret must be a string of at least 32 characters');
  }
};

export const sign = ({ secret, expiresIn, claims }) => {
  requireSecret(secret);
  return jwt.sign(
    {
      sub: claims.userId,
      username: claims.username,
      role: claims.role,
      pwAt: claims.passwordChangedAt,
    },
    secret,
    {
      algorithm: ALGORITHM,
      issuer: ISSUER,
      audience: AUDIENCE,
      expiresIn: expiresIn ?? '24h',
    }
  );
};

export const verify = (token, secret) => {
  requireSecret(secret);
  try {
    return jwt.verify(token, secret, {
      algorithms: [ALGORITHM],
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AuthError('auth.sessionExpired', { cause: err });
    }
    if (err.name === 'JsonWebTokenError') {
      throw new AuthError('auth.sessionInvalid', { cause: err });
    }
    throw err;
  }
};
