import { promises as fs } from 'node:fs';
import https from 'node:https';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

import { log } from './logger.js';

// Mirrors the SSL bootstrap pattern used by Armor, BoxVault, and Zoneweaver:
// on first start, if `ssl.enabled && ssl.generate` and the configured cert
// files are missing, spawn `openssl req -x509` to drop a self-signed pair at
// the configured paths (mode 0600). On every start, if cert files exist,
// read them and bind https.createServer. If anything fails — missing
// openssl, unreadable PEMs, listen error — return null so server.js can
// fall back to a plain HTTP listener on the same port.
//
// Reference: Armor utils/sslManager.js (closest structural match — dedicated
// module, two async exports). patchpanel deltas:
//   - Field names match patchpanel config (certPath/keyPath, not cert/key).
//   - Honours ssl.enabled and ssl.generate gate flags from the config schema.
//   - Passes the TLS hardening fields (minVersion/maxVersion/ciphers/
//     honorCipherOrder) defined in production-config.yaml into
//     https.createServer — BoxVault does this; Armor/Zoneweaver don't only
//     because their configs don't define those knobs.
//   - Listens on host AND port (patchpanel binds to a configurable interface).
//   - Uses patchpanel's structured logger.

export const generateSelfSignedIfNeeded = async sslConfig => {
  if (!sslConfig?.certPath || !sslConfig?.keyPath) {
    return false;
  }
  if (!sslConfig.generate) {
    return false;
  }

  const { certPath, keyPath } = sslConfig;

  try {
    await fs.access(keyPath);
    await fs.access(certPath);
    log.app.info('SSL certificates already exist', { certPath, keyPath });
    return false;
  } catch {
    // Missing — proceed to generate.
  }

  try {
    log.app.info('generating self-signed SSL certificates', { certPath, keyPath });

    const sslDir = dirname(keyPath);
    await fs.mkdir(sslDir, { recursive: true, mode: 0o700 });

    const opensslCmd = `openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout "${keyPath}" -out "${certPath}" -subj "/C=US/ST=State/L=City/O=PatchPanel/CN=localhost"`;
    execSync(opensslCmd, { stdio: 'pipe' });

    await fs.chmod(keyPath, 0o600);
    await fs.chmod(certPath, 0o600);

    log.app.info('SSL certificates generated', { certPath, keyPath });
    return true;
  } catch (error) {
    log.app.error('failed to generate SSL certificates', {
      error: error.message,
      certPath,
      keyPath,
    });
    return false;
  }
};

export const setupHTTPSServer = async (app, sslConfig, host, port) => {
  if (!sslConfig?.enabled) {
    return null;
  }
  if (!sslConfig.certPath || !sslConfig.keyPath) {
    log.app.warn('ssl.enabled is true but certPath/keyPath are unset; falling back to HTTP');
    return null;
  }

  await generateSelfSignedIfNeeded(sslConfig);

  try {
    const [privateKey, certificate] = await Promise.all([
      fs.readFile(sslConfig.keyPath, 'utf8'),
      fs.readFile(sslConfig.certPath, 'utf8'),
    ]);

    const credentials = { key: privateKey, cert: certificate };
    if (sslConfig.minVersion) {
      credentials.minVersion = sslConfig.minVersion;
    }
    if (sslConfig.maxVersion) {
      credentials.maxVersion = sslConfig.maxVersion;
    }
    if (sslConfig.ciphers) {
      credentials.ciphers = sslConfig.ciphers;
    }
    if (typeof sslConfig.honorCipherOrder === 'boolean') {
      credentials.honorCipherOrder = sslConfig.honorCipherOrder;
    }

    const httpsServer = https.createServer(credentials, app);

    return await new Promise((resolve, reject) => {
      httpsServer.once('error', reject);
      httpsServer.listen(port, host, () => {
        httpsServer.removeListener('error', reject);
        log.app.info('patchpanel listening (https)', { host, port });
        resolve(httpsServer);
      });
    });
  } catch (error) {
    log.app.error('failed to start HTTPS server; falling back to HTTP', {
      error: error.message,
      certPath: sslConfig.certPath,
      keyPath: sslConfig.keyPath,
    });
    return null;
  }
};
