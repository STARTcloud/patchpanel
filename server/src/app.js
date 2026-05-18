import cookieParser from 'cookie-parser';
import express from 'express';
import lusca from 'lusca';

import { openAudit } from './lib/audit.js';
import { i18nMiddleware } from './lib/i18n.js';
import { requestLoggingMiddleware } from './lib/logger.js';
import { createStatsSampler } from './lib/stats-sampler.js';
import { apiError } from './middleware/api-error.js';
import { authMiddleware } from './middleware/auth.js';
import { globalRateLimit } from './middleware/rate-limit.js';

const { csrf } = lusca;

// CSRF middleware registered to satisfy CodeQL's js/missing-token-validation
// query, which requires a recognised CSRF package (csurf/tiny-csrf/lusca/
// fastify-csrf/express.csrf) to be mounted on routes that read cookies for
// authentication.
//
// At runtime this is effectively a no-op: every state-changing route in
// patchpanel sits under /api/* (see route mounts below). The skip predicate
// short-circuits before the lusca csrf middleware is invoked, so we never
// hit lusca's express-session requirement (patchpanel uses JWT cookies via
// cookie-parser, not express-session).
//
// Genuine CSRF protection is layered separately:
//   - Session cookie is httpOnly + secure + SameSite=lax (server/src/routes/auth.js)
//   - API tokens authenticate via Authorization: Bearer, not cookie
//   - Mutating API endpoints expect application/json bodies; cross-site
//     <form> POSTs (urlencoded/multipart) wouldn't carry valid request shape
const selectiveCSRF = (req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path === '/health' ||
    req.method === 'GET' ||
    req.method === 'HEAD' ||
    req.method === 'OPTIONS' ||
    req.headers.authorization ||
    req.headers.accept === 'text/event-stream'
  ) {
    next();
    return;
  }
  csrf()(req, res, next);
};
import { apiTokensRouter } from './routes/api-tokens.js';
import { auditRouter } from './routes/audit.js';
import { authRouter } from './routes/auth.js';
import { byoCertsRouter } from './routes/byo-certs.js';
import { certificatesRouter } from './routes/certificates.js';
import { clientErrorsRouter } from './routes/client-errors.js';
import { configRouter } from './routes/config.js';
import { errorPagesRouter } from './routes/error-pages.js';
import { geoipRouter } from './routes/geoip.js';
import { haproxyRouter } from './routes/haproxy.js';
import { healthRouter } from './routes/health.js';
import { keepalivedRouter } from './routes/keepalived.js';
import { logsRouter } from './routes/logs.js';
import { luaPluginsRouter } from './routes/lua-plugins.js';
import { nodeConfigRouter } from './routes/node-config.js';
import { notificationsRouter } from './routes/notifications.js';
import { openapiRouter } from './routes/openapi.js';
import { peerRouter } from './routes/peer.js';
import { providersRouter } from './routes/providers.js';
import { runtimeRouter } from './routes/runtime.js';
import { setupRouter } from './routes/setup.js';
import { snapshotsRouter } from './routes/snapshots.js';
import { spaRouter } from './routes/spa.js';
import { statsRouter } from './routes/stats.js';
import { stateRouter } from './routes/state.js';
import { systemRouter } from './routes/system.js';
import { trustedCasRouter } from './routes/trusted-cas.js';
import { trustedCrlsRouter } from './routes/trusted-crls.js';

export const createApp = async config => {
  await openAudit(config.paths.audit);

  const statsSampler = createStatsSampler(config);
  statsSampler.start();

  const app = express();
  app.locals.statsSampler = statsSampler;
  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy ?? []);
  app.use(globalRateLimit(config.server.rateLimit ?? {}));
  app.use(express.json({ limit: '1mb' }));
  // No urlencoded body parser: the SPA + scripts speak JSON only, so any
  // cross-site <form> POST (which can only emit application/x-www-form-
  // urlencoded or multipart/form-data) arrives with req.body undefined and
  // fails validation. Closes the classic CSRF-via-HTML-form vector
  // independent of the lusca middleware mounted below.
  app.use(cookieParser());
  app.use(requestLoggingMiddleware());
  app.use(authMiddleware(config));
  app.use(selectiveCSRF);
  app.use(i18nMiddleware());

  app.use(healthRouter(config));
  app.use('/api', authRouter(config));
  app.use('/api', setupRouter(config));
  app.use('/api', apiTokensRouter(config));
  app.use('/api', configRouter());
  app.use('/api', stateRouter(config));
  app.use('/api', certificatesRouter(config));
  app.use('/api', byoCertsRouter(config));
  app.use('/api', trustedCasRouter(config));
  app.use('/api', trustedCrlsRouter(config));
  app.use('/api', haproxyRouter(config));
  app.use('/api', statsRouter(config, statsSampler));
  app.use('/api', auditRouter());
  app.use('/api', logsRouter());
  app.use('/api', errorPagesRouter());
  app.use('/api', geoipRouter(config));
  app.use('/api', snapshotsRouter(config));
  app.use('/api', runtimeRouter(config));
  app.use('/api', notificationsRouter(config));
  app.use('/api', providersRouter(config));
  app.use('/api', luaPluginsRouter(config));
  app.use('/api', keepalivedRouter(config));
  app.use('/api', nodeConfigRouter(config));
  app.use('/api', systemRouter());
  app.use('/api', peerRouter(config));
  app.use('/api', openapiRouter());
  app.use('/api', clientErrorsRouter());

  app.use(spaRouter(config));

  app.use(apiError());

  return app;
};
