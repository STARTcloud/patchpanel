import { promises as fs } from 'node:fs';
import { join as joinPath, normalize as normalizePath } from 'node:path';

import { Router, static as expressStatic } from 'express';

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

export const spaRouter = config => {
  const router = Router();
  router.use(
    expressStatic(config.paths.webDir, {
      index: false,
      maxAge: '1h',
      fallthrough: true,
    })
  );
  router.get('*splat', async (req, res) => {
    const candidate = safeJoinUnderRoot(config.paths.webDir, req.path);
    if (candidate) {
      const stat = await fs.stat(candidate).catch(() => null);
      if (stat && stat.isFile() && !req.path.endsWith('/')) {
        return res.sendFile(candidate);
      }
    }
    return serveIndex(config.paths.webDir, req, res);
  });
  return router;
};
