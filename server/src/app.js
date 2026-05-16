import express from 'express';

import { openAudit } from './lib/audit.js';
import { createStatsSampler } from './lib/stats-sampler.js';
import { apiError } from './middleware/api-error.js';
import { ingressAuth } from './middleware/ingress-auth.js';
import { auditRouter } from './routes/audit.js';
import { byoCertsRouter } from './routes/byo-certs.js';
import { certificatesRouter } from './routes/certificates.js';
import { errorPagesRouter } from './routes/error-pages.js';
import { geoipRouter } from './routes/geoip.js';
import { haproxyRouter } from './routes/haproxy.js';
import { healthRouter } from './routes/health.js';
import { logsRouter } from './routes/logs.js';
import { notificationsRouter } from './routes/notifications.js';
import { openapiRouter } from './routes/openapi.js';
import { providersRouter } from './routes/providers.js';
import { runtimeRouter } from './routes/runtime.js';
import { snapshotsRouter } from './routes/snapshots.js';
import { spaRouter } from './routes/spa.js';
import { statsRouter } from './routes/stats.js';
import { stateRouter } from './routes/state.js';
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
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(ingressAuth(config));

  app.use(healthRouter());
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
  app.use('/api', openapiRouter());

  app.use(spaRouter(config));

  app.use(apiError());

  return app;
};
