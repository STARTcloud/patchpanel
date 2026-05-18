import { ValidationError } from './errors.js';
import { fileExists, readJson, writeJson } from './files.js';
import { withLock } from './lock.js';
import { log } from './logger.js';
import { StateSchema, emptyState, validateState } from './state-schema.js';

const stateLockPath = statePath => `${statePath}.lock`;

export const loadState = async statePath => {
  if (!(await fileExists(statePath))) {
    return null;
  }
  const raw = await readJson(statePath);
  const result = validateState(raw);
  if (!result.ok) {
    throw new ValidationError('state.load.schemaInvalid', {
      issues: result.issues,
      replacements: { path: statePath },
    });
  }
  return result.data;
};

export const saveState = async (statePath, candidate, options = {}) => {
  const editor = options.editor ?? null;
  const previous = candidate.meta ?? {};
  const next = StateSchema.parse({
    ...candidate,
    meta: {
      ...previous,
      lastEditedAt: new Date().toISOString(),
      lastEditedBy: editor ?? previous.lastEditedBy ?? null,
    },
  });
  await writeJson(statePath, next);
  log.app.debug('state persisted', { statePath, editor });
  return next;
};

export const initStateIfMissing = async statePath => {
  if (await fileExists(statePath)) {
    return loadState(statePath);
  }
  return withLock(stateLockPath(statePath), async () => {
    if (await fileExists(statePath)) {
      return loadState(statePath);
    }
    const seeded = emptyState();
    await writeJson(statePath, seeded);
    log.app.info('seeded empty state.json', { statePath });
    return seeded;
  });
};

export const updateState = (statePath, mutator, options = {}) =>
  withLock(stateLockPath(statePath), async () => {
    const current = (await loadState(statePath)) ?? emptyState();
    const next = await mutator(current);
    return saveState(statePath, next, options);
  });
