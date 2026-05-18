import { existsSync, promises as fs } from 'node:fs';
import { dirname, join as joinPath, normalize as normalizePath } from 'node:path';

import { Router, static as expressStatic } from 'express';

import { log } from '../lib/logger.js';

const buildBaseHref = ingressPath => {
  if (!ingressPath || ingressPath === '' || ingressPath === '/') {
    return '/';
  }
  return ingressPath.endsWith('/') ? ingressPath : `${ingressPath}/`;
};

const safeJoinUnderRoot = (root, requested) => {
  const candidate = normalizePath(joinPath(root, requested));
  if (!candidate.startsWith(root)) {
    return null;
  }
  return candidate;
};

const serveIndex = async (webDir, req, res) => {
  const indexPath = joinPath(webDir, 'index.html');
  const html = await fs.readFile(indexPath, 'utf8');
  const baseHref = buildBaseHref(req.ingressPath);
  const withBase = html.replace('<!--BASE_HREF-->', `<base href="${baseHref}">`);
  res.set('content-type', 'text/html; charset=utf-8').send(withBase);
};

// PATCHPANEL_DEBUG_UI=1 (set by the HA addon s6 run script from
// /data/options.json, or manually for a Debian install) requests the
// development-mode bundle that ships full React error messages and
// prop-type warnings. Falls back to the production bundle if dist-debug
// isn't present (older .deb without dist-debug, or a custom install).
const resolveWebDir = config => {
  if (process.env.PATCHPANEL_DEBUG_UI !== '1') {
    return config.paths.webDir;
  }
  const debugDir = config.paths.webDirDebug ?? joinPath(dirname(config.paths.webDir), 'dist-debug');
  if (existsSync(joinPath(debugDir, 'index.html'))) {
    log.api.info('serving debug UI bundle', { webDir: debugDir });
    return debugDir;
  }
  log.api.warn('PATCHPANEL_DEBUG_UI=1 but debug bundle is missing; serving production bundle', {
    debugDir,
    webDir: config.paths.webDir,
  });
  return config.paths.webDir;
};

export const spaRouter = config => {
  const webDir = resolveWebDir(config);
  const router = Router();
  router.use(
    expressStatic(webDir, {
      index: false,
      maxAge: '1h',
      fallthrough: true,
    })
  );
  router.get('*splat', async (req, res) => {
    const candidate = safeJoinUnderRoot(webDir, req.path);
    if (candidate) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat && stat.isFile() && !req.path.endsWith('/')) {
        return res.sendFile(candidate);
      }
    }
    return serveIndex(webDir, req, res);
  });
  return router;
};
