export const uniquify = (base, taken, { separator = '-' } = {}) => {
  if (!taken.has(base)) {
    return base;
  }
  let s = 2;
  while (taken.has(`${base}${separator}${s}`)) {
    s += 1;
  }
  return `${base}${separator}${s}`;
};

export const uniquifyCopy = (base, taken, { separator = '-' } = {}) => {
  const head = `${base}${separator}copy`;
  if (!taken.has(head)) {
    return head;
  }
  let s = 2;
  while (taken.has(`${head}${separator}${s}`)) {
    s += 1;
  }
  return `${head}${separator}${s}`;
};

export const slugifyId = (source, { maxLen = 63, fallback = '' } = {}) => {
  const cleaned = String(source ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, maxLen);
  return cleaned || fallback;
};

export const slugifyName = (source, { maxLen = 63, fallback = '' } = {}) => {
  const cleaned = String(source ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .slice(0, maxLen);
  return cleaned || fallback;
};

export const collectRuleIds = (doc, { phase = null } = {}) => {
  const ids = new Set();
  for (const fe of doc?.frontends ?? []) {
    const phases = fe.rulePhases ?? {};
    const phaseKeys = phase ? [phase] : Object.keys(phases);
    for (const phaseKey of phaseKeys) {
      for (const rule of phases[phaseKey] ?? []) {
        ids.add(rule.id);
      }
    }
  }
  return ids;
};

export const stripInternal = obj => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) {
      out[k] = v;
    }
  }
  return out;
};

export const stripInternalDeep = value => {
  if (Array.isArray(value)) {
    return value.map(stripInternalDeep);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (!k.startsWith('_')) {
        out[k] = stripInternalDeep(v);
      }
    }
    return out;
  }
  return value;
};
