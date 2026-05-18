import { createApp } from './app.js';
import { exitOnError, parseArgs } from './cli/_args.js';
import configLoader from './config/configLoader.js';
import { log } from './lib/logger.js';

const shutdown = (server, gracePeriodMs) =>
  new Promise(resolve => {
    let resolved = false;
    const finish = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve();
    };
    server.close(finish);
    setTimeout(finish, gracePeriodMs).unref();
  });

const main = async () => {
  const args = parseArgs(process.argv, {
    config: { type: 'string', default: null },
  });

  const config = configLoader.load(args.config);

  const app = await createApp(config);
  const { host, port } = config.server;
  const server = app.listen(port, host, () => {
    log.app.info('patchpanel listening', { host, port, mode: config.mode });
  });

  const stop = async () => {
    log.app.info('shutting down');
    await shutdown(server, config.server.shutdownGracePeriodMs ?? 10_000);
    process.exitCode = 0;
  };

  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
};

main().catch(exitOnError);
