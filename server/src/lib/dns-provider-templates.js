import { ConfigError } from './errors.js';

// Per-provider credential templates. Each DNS plugin certbot supports needs
// a different set of fields, and the .ini file format differs (key=value for
// most, raw JSON for dns-google, key=value plus passthrough lines for
// dns-multi). The frontend fetches the field schema for a provider type so
// it can render the right form; this module also renders + parses the
// resulting credentials file and masks secret values for read-back.
//
// Field shape:
//   { key, label, type, secret, required, helpText?, options?, default? }
//
// `type` ∈ { text, password, textarea, integer, select }
// `secret: true` → server masks the value in GET responses as `'***'`. The
//                  client may pass `'***'` back in PUT to mean "preserve the
//                  on-disk value"; the route layer enforces that.

const PRESERVE_SENTINEL = '***';
export { PRESERVE_SENTINEL };

const TEMPLATES = Object.freeze({
  'dns-cloudflare': {
    format: 'ini',
    fields: [
      {
        key: 'dns_cloudflare_api_token',
        label: 'API token',
        type: 'password',
        secret: true,
        required: true,
        helpText:
          'Scoped Cloudflare token (Zone → DNS → Edit on the relevant zones). Create at dash.cloudflare.com → My Profile → API Tokens.',
      },
    ],
  },
  'dns-route53': {
    format: 'ini',
    fields: [
      {
        key: 'aws_access_key_id',
        label: 'AWS access key ID',
        type: 'password',
        secret: true,
        required: true,
        helpText: 'IAM user with route53:ChangeResourceRecordSets on the relevant hosted zones.',
      },
      {
        key: 'aws_secret_access_key',
        label: 'AWS secret access key',
        type: 'password',
        secret: true,
        required: true,
      },
    ],
  },
  'dns-google': {
    format: 'json',
    fields: [
      {
        key: 'service_account_json',
        label: 'Service account JSON',
        type: 'textarea',
        secret: true,
        required: true,
        helpText:
          'Full contents of the Google Cloud service-account JSON key. Service account must have roles/dns.admin on the target managed zone.',
      },
    ],
  },
  'dns-digitalocean': {
    format: 'ini',
    fields: [
      {
        key: 'dns_digitalocean_token',
        label: 'DigitalOcean API token',
        type: 'password',
        secret: true,
        required: true,
        helpText: 'Personal access token with write scope (cloud.digitalocean.com → API).',
      },
    ],
  },
  'dns-ovh': {
    format: 'ini',
    fields: [
      {
        key: 'dns_ovh_endpoint',
        label: 'OVH endpoint',
        type: 'select',
        secret: false,
        required: true,
        default: 'ovh-eu',
        options: [
          { value: 'ovh-eu', label: 'OVH Europe' },
          { value: 'ovh-ca', label: 'OVH Canada' },
          { value: 'kimsufi-eu', label: 'Kimsufi Europe' },
          { value: 'soyoustart-eu', label: 'SoYouStart Europe' },
        ],
        helpText: 'Pick the API region matching where your OVH account lives.',
      },
      {
        key: 'dns_ovh_application_key',
        label: 'Application key',
        type: 'password',
        secret: true,
        required: true,
      },
      {
        key: 'dns_ovh_application_secret',
        label: 'Application secret',
        type: 'password',
        secret: true,
        required: true,
      },
      {
        key: 'dns_ovh_consumer_key',
        label: 'Consumer key',
        type: 'password',
        secret: true,
        required: true,
      },
    ],
  },
  'dns-rfc2136': {
    format: 'ini',
    fields: [
      {
        key: 'dns_rfc2136_server',
        label: 'DNS server',
        type: 'text',
        secret: false,
        required: true,
        helpText: 'IP or hostname of the authoritative DNS server accepting RFC 2136 updates.',
      },
      {
        key: 'dns_rfc2136_port',
        label: 'DNS server port',
        type: 'integer',
        secret: false,
        required: false,
        default: 53,
      },
      {
        key: 'dns_rfc2136_name',
        label: 'TSIG key name',
        type: 'text',
        secret: false,
        required: true,
      },
      {
        key: 'dns_rfc2136_secret',
        label: 'TSIG key secret',
        type: 'password',
        secret: true,
        required: true,
        helpText: 'Base64-encoded shared secret matching the key on the DNS server.',
      },
      {
        key: 'dns_rfc2136_algorithm',
        label: 'TSIG algorithm',
        type: 'select',
        secret: false,
        required: false,
        default: 'HMAC-SHA512',
        options: [
          { value: 'HMAC-SHA512', label: 'HMAC-SHA512' },
          { value: 'HMAC-SHA384', label: 'HMAC-SHA384' },
          { value: 'HMAC-SHA256', label: 'HMAC-SHA256' },
          { value: 'HMAC-MD5', label: 'HMAC-MD5 (legacy)' },
        ],
      },
    ],
  },
  'dns-multi': {
    format: 'passthrough',
    fields: [
      {
        key: 'dns_multi_provider',
        label: 'lego provider name',
        type: 'text',
        secret: false,
        required: true,
        helpText:
          'lego DNS provider identifier (e.g. "linode", "namesilo", "gandi"). See go-acme/lego documentation for the full list.',
      },
      {
        key: 'dns_multi_config',
        label: 'Provider config (key=value, one per line)',
        type: 'textarea',
        secret: true,
        required: true,
        helpText:
          'lego provider-specific environment variables, one per line. Treated as secret because most providers require API keys here.',
      },
    ],
  },
  'http-01': { format: 'none', fields: [] },
  byo: { format: 'none', fields: [] },
});

export const getDnsProviderTemplate = type => TEMPLATES[type] ?? null;

export const listProviderTypes = () => Object.keys(TEMPLATES);

const renderIniBody = (template, values) => {
  const lines = [];
  for (const field of template.fields) {
    const v = values[field.key];
    if (v === undefined || v === null || v === '') {
      continue;
    }
    lines.push(`${field.key} = ${v}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
};

const renderJsonBody = (template, values) => {
  const v = values[template.fields[0].key];
  if (typeof v !== 'string' || v.trim().length === 0) {
    return '';
  }
  // Caller is expected to paste a JSON blob; we re-parse and re-serialize
  // to normalize whitespace and reject malformed input here rather than at
  // certbot-run time.
  const parsed = JSON.parse(v);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};

const renderPassthroughBody = values => {
  const lines = [];
  const providerName = values.dns_multi_provider;
  if (providerName) {
    lines.push(`dns_multi_provider = ${providerName}`);
  }
  const config = values.dns_multi_config;
  if (typeof config === 'string' && config.trim().length > 0) {
    lines.push(config.trim());
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
};

export const renderProviderIni = (type, values) => {
  const template = TEMPLATES[type];
  if (!template) {
    throw new ConfigError('cert.provider.unknownType', { replacements: { type } });
  }
  if (template.format === 'none') {
    return '';
  }
  if (template.format === 'json') {
    return renderJsonBody(template, values);
  }
  if (template.format === 'passthrough') {
    return renderPassthroughBody(values);
  }
  return renderIniBody(template, values);
};

const parseIniBody = content => {
  const out = {};
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
};

const parsePassthroughBody = content => {
  const out = {};
  const remaining = [];
  for (const raw of content.split('\n')) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith('dns_multi_provider')) {
      const eq = line.indexOf('=');
      if (eq > 0) {
        out.dns_multi_provider = line.slice(eq + 1).trim();
        continue;
      }
    }
    remaining.push(raw);
  }
  if (remaining.length > 0) {
    out.dns_multi_config = remaining.join('\n').trim();
  }
  return out;
};

export const parseProviderIni = (type, content) => {
  const template = TEMPLATES[type];
  if (!template) {
    throw new ConfigError('cert.provider.unknownType', { replacements: { type } });
  }
  if (template.format === 'none') {
    return {};
  }
  if (template.format === 'json') {
    const [{ key }] = template.fields;
    return { [key]: content };
  }
  if (template.format === 'passthrough') {
    return parsePassthroughBody(content);
  }
  return parseIniBody(content);
};

export const maskProviderValues = (type, values) => {
  const template = TEMPLATES[type];
  if (!template) {
    return {};
  }
  const out = {};
  for (const field of template.fields) {
    const v = values[field.key];
    if (v === undefined || v === null) {
      continue;
    }
    out[field.key] = field.secret ? PRESERVE_SENTINEL : v;
  }
  return out;
};

// Merge incoming PATCH values with on-disk values. Secret fields whose
// incoming value is the preserve sentinel (`'***'`) keep their on-disk
// value; everything else replaces. Unknown keys cause an error. Failure
// path returns `{ ok: false, error: { code, replacements } }`.
export const mergeProviderValues = (type, existing, incoming) => {
  const template = TEMPLATES[type];
  if (!template) {
    return {
      ok: false,
      error: { code: 'cert.provider.unknownType', replacements: { type } },
    };
  }
  const allowed = new Set(template.fields.map(f => f.key));
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming ?? {})) {
    if (!allowed.has(key)) {
      return {
        ok: false,
        error: { code: 'cert.provider.unknownField', replacements: { field: key } },
      };
    }
    const field = template.fields.find(f => f.key === key);
    if (field.secret && value === PRESERVE_SENTINEL) {
      continue;
    }
    merged[key] = value;
  }
  return { ok: true, merged };
};

// Validate the merged result has every required field set and that all
// declared values are the right shape. `errors[]` carries
// `{ code, replacements }` objects.
export const validateMergedValues = (type, values) => {
  const template = TEMPLATES[type];
  if (!template) {
    return {
      ok: false,
      errors: [{ code: 'cert.provider.unknownType', replacements: { type } }],
    };
  }
  const errors = [];
  for (const field of template.fields) {
    const v = values[field.key];
    if (field.required && (v === undefined || v === null || v === '')) {
      errors.push({
        code: 'cert.provider.requiredFieldMissing',
        replacements: { field: field.key },
      });
      continue;
    }
    if (v === undefined || v === null) {
      continue;
    }
    if (field.type === 'integer') {
      const n = Number(v);
      if (!Number.isInteger(n)) {
        errors.push({
          code: 'cert.provider.fieldNotInteger',
          replacements: { field: field.key },
        });
      }
    }
    if (field.type === 'select' && Array.isArray(field.options)) {
      const allowed = new Set(field.options.map(o => o.value));
      if (!allowed.has(v)) {
        errors.push({
          code: 'cert.provider.fieldNotInOptions',
          replacements: { field: field.key, options: [...allowed].join(', ') },
        });
      }
    }
  }
  if (template.format === 'json') {
    const blob = values.service_account_json;
    if (typeof blob === 'string' && blob.trim().length > 0) {
      try {
        JSON.parse(blob);
      } catch (err) {
        errors.push({
          code: 'cert.provider.serviceAccountJsonInvalid',
          replacements: { reason: err.message },
        });
      }
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
};
