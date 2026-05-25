import { ensureDir, readText, writeAtomic } from './files.js';

const collectReferencedCrtListPaths = (state, primaryPath) => {
  const referenced = new Set();
  for (const fe of state.frontends ?? []) {
    for (const bind of fe.binds ?? []) {
      const ref = bind.ssl?.crtListRef;
      if (typeof ref === 'string' && ref.length > 0 && ref !== primaryPath) {
        referenced.add(ref);
      }
    }
  }
  return referenced;
};

const writeMirrorTarget = async (target, content) => {
  const lastSlash = target.lastIndexOf('/');
  if (lastSlash > 0) {
    await ensureDir(target.slice(0, lastSlash));
  }
  await writeAtomic(target, content, { mode: 0o644 });
};

export const mirrorCrtListToReferencedPaths = async (config, state) => {
  const referenced = collectReferencedCrtListPaths(state, config.paths.haproxyCertsList);
  if (referenced.size === 0) {
    return;
  }
  const content = await readText(config.paths.haproxyCertsList).catch(() => '');
  await Promise.all([...referenced].map(target => writeMirrorTarget(target, content)));
};
