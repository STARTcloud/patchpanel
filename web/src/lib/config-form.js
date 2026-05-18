// Helpers for the Settings page. Patchpanel's config.yaml is metadata-wrapped:
// every leaf is an object with {type, value, description, section, subsection,
// validation, ...}. processConfig() walks the tree and produces two views:
//
//   - extractedValues    flat dotted-path -> leaf.value map. The pool the
//                        form reads / writes through (paired with the page's
//                        draft state).
//   - organizedSections  section -> subsection -> field-list tree. The
//                        rendering shape consumed by <ConfigPage>.
//
// validateField() / evaluateConditional() / t() round out the rendering loop.
// t() is an intentional placeholder so call sites are i18n-shaped from day
// one; wiring real translations later is a mechanical swap of this single
// function for one that looks up `key` in a locale bundle.

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

const isMetadataLeaf = node =>
  isPlainObject(node) && typeof node.type === 'string' && Object.hasOwn(node, 'value');

const generateLabel = key =>
  key
    .split(/[_.-]/u)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

// The YAML schema authors used FontAwesome class strings (`fas fa-server`)
// for _sections.icon, but the patchpanel UI uses Bootstrap Icons throughout.
// Translate at render time so old in-place configs keep working and new
// installs land on the canonical bi-* names. Unknown icons fall back to
// `bi-gear`.
const FA_TO_BI = Object.freeze({
  'fas fa-server': 'bi-server',
  'fas fa-network-wired': 'bi-hdd-network',
  'fas fa-folder-tree': 'bi-folder2-open',
  'fas fa-certificate': 'bi-shield-lock',
  'fas fa-shield-halved': 'bi-shield-check',
  'fas fa-globe': 'bi-globe',
  'fas fa-gauge-high': 'bi-speedometer',
  'fas fa-file-lines': 'bi-file-text',
  'fas fa-earth-americas': 'bi-globe-americas',
  'fas fa-key': 'bi-key',
});

export const normalizeIcon = icon => {
  if (!icon) {
    return 'bi-gear';
  }
  if (icon.startsWith('bi-')) {
    return icon;
  }
  return FA_TO_BI[icon] ?? 'bi-gear';
};

const initSection = (organizedSections, sectionKey) => {
  if (!organizedSections[sectionKey]) {
    organizedSections[sectionKey] = {
      key: sectionKey,
      label: sectionKey,
      description: '',
      icon: 'bi-gear',
      order: 999,
      fields: [],
      subsections: {},
    };
  }
};

const initSubsection = (section, subsectionKey) => {
  if (!section.subsections[subsectionKey]) {
    section.subsections[subsectionKey] = {
      key: subsectionKey,
      label: subsectionKey,
      order: 0,
      fields: [],
    };
  }
};

const fieldDataFromLeaf = (key, path, leaf) => ({
  path,
  key,
  type: leaf.type,
  label: generateLabel(key),
  description: leaf.description ?? '',
  placeholder: leaf.placeholder ?? '',
  required: Boolean(leaf.required),
  options: leaf.options ?? null,
  validation: {
    min: leaf.validation?.min ?? leaf.min ?? null,
    max: leaf.validation?.max ?? leaf.max ?? null,
  },
  order: leaf.order ?? 0,
  upload: leaf.upload === true,
  dependsOn: leaf.depends_on ?? null,
  showWhen: leaf.show_when ?? null,
  conditional: leaf.conditional ?? null,
  subsectionKey: leaf.subsection ?? null,
  subsectionTranslationKey: leaf.subsection_key ?? null,
  sectionKey: leaf.section ?? null,
});

const enrichSectionMetadata = (organizedSections, rawSections) => {
  if (!isPlainObject(rawSections)) {
    return;
  }
  for (const [key, meta] of Object.entries(rawSections)) {
    if (!organizedSections[key]) {
      continue;
    }
    organizedSections[key].label = key;
    organizedSections[key].description = meta.description ?? '';
    organizedSections[key].icon = normalizeIcon(meta.icon);
    organizedSections[key].order = meta.order ?? organizedSections[key].order;
  }
};

const sortFieldsByOrder = organizedSections => {
  for (const section of Object.values(organizedSections)) {
    section.fields.sort((a, b) => (a.order || 0) - (b.order || 0));
    for (const sub of Object.values(section.subsections)) {
      sub.fields.sort((a, b) => (a.order || 0) - (b.order || 0));
    }
  }
};

const placeField = (organizedSections, data) => {
  const sectionKey = data.sectionKey ?? 'Other';
  initSection(organizedSections, sectionKey);
  const section = organizedSections[sectionKey];
  if (data.subsectionKey) {
    initSubsection(section, data.subsectionKey);
    section.subsections[data.subsectionKey].fields.push(data);
  } else {
    section.fields.push(data);
  }
};

export const processConfig = raw => {
  const extractedValues = {};
  const organizedSections = {};

  const walk = (node, pathParts) => {
    if (!isPlainObject(node)) {
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === '_sections' || key === 'version') {
        continue;
      }
      const childPath = [...pathParts, key];
      if (isMetadataLeaf(child)) {
        const path = childPath.join('.');
        extractedValues[path] = child.value;
        placeField(organizedSections, fieldDataFromLeaf(key, path, child));
      } else if (isPlainObject(child)) {
        walk(child, childPath);
      }
    }
  };

  walk(raw, []);
  enrichSectionMetadata(organizedSections, raw?._sections);
  sortFieldsByOrder(organizedSections);

  return { extractedValues, organizedSections };
};

// Type-specific validators. Split out so `validateField` stays under the
// cyclomatic complexity ceiling.

const validateInteger = (value, field) => {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    return 'must be an integer';
  }
  const lo = field.validation?.min;
  const hi = field.validation?.max;
  if (lo !== null && lo !== undefined && n < lo) {
    return `must be ≥ ${lo}`;
  }
  if (hi !== null && hi !== undefined && n > hi) {
    return `must be ≤ ${hi}`;
  }
  return null;
};

const validateStringLength = (value, field) => {
  const lo = field.validation?.min;
  const hi = field.validation?.max;
  const len = String(value).length;
  if (lo !== null && lo !== undefined && len < lo) {
    return `min length ${lo}`;
  }
  if (hi !== null && hi !== undefined && len > hi) {
    return `max length ${hi}`;
  }
  return null;
};

const HOST_IPV4_RE =
  /^(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)){3}$/u;
const HOST_NAME_RE =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/u;

const validateHost = value => {
  const s = String(value);
  if (HOST_IPV4_RE.test(s) || HOST_NAME_RE.test(s)) {
    return null;
  }
  return 'must be an IPv4 address or hostname';
};

const validateUrl = value => (URL.canParse(value) ? null : 'must be a URL');

const VALIDATORS = Object.freeze({
  boolean: value => (typeof value === 'boolean' ? null : 'must be true or false'),
  integer: validateInteger,
  select: (value, field) =>
    Array.isArray(field.options) && field.options.includes(value)
      ? null
      : 'must be one of the listed options',
  array: value => (Array.isArray(value) ? null : 'must be a list'),
  url: validateUrl,
  host: validateHost,
  string: validateStringLength,
  password: validateStringLength,
  textarea: validateStringLength,
});

export const validateField = (field, value) => {
  if (value === null || value === undefined || value === '') {
    return field.required ? 'required' : null;
  }
  const validator = VALIDATORS[field.type];
  return validator ? validator(value, field) : null;
};

// Conditional visibility. The YAML uses two shapes interchangeably:
//   conditional: { field: <fully-qualified-path>, value: <expected> }
//   depends_on: <siblingKey>, show_when: [<allowed>...]
//
// `conditional.field` is referenced as a fully-qualified dotted path against
// the flat values pool. `depends_on` names a sibling key and we resolve it
// relative to the field's own parent path so YAML authors can stay terse.

export const evaluateConditional = (field, allValues) => {
  if (field.conditional && typeof field.conditional === 'object') {
    return allValues[field.conditional.field] === field.conditional.value;
  }
  if (field.dependsOn) {
    const lastDot = field.path.lastIndexOf('.');
    const parent = lastDot === -1 ? '' : field.path.slice(0, lastDot);
    const siblingPath = parent ? `${parent}.${field.dependsOn}` : field.dependsOn;
    const refValue = allValues[siblingPath];
    if (Array.isArray(field.showWhen)) {
      return field.showWhen.some(allowed => allowed === refValue);
    }
    return Boolean(refValue);
  }
  return true;
};

// i18n placeholder. Future wiring swaps this for a real locale lookup; until
// then it returns the fallback verbatim. Always call sites with both args so
// the retrofit is a one-line change here.
export const t = (key, fallback) => fallback ?? key;
