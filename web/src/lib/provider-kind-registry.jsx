import PropTypes from 'prop-types';
import { Col, Form } from 'react-bootstrap';

// v0.2.39 — Shared kind-registry helpers for the discriminated-union
// provider editors (TLS providers, auth providers, future: notification
// channels). Each provider class defines its own kinds registry; the
// generic modal infrastructure dispatches per-kind via these helpers.
//
// Registry shape (one entry per discriminated-union arm):
//   {
//     value: 'dns-cloudflare',          // the schema discriminator value
//     label: 'Cloudflare (DNS-01)',     // human label for the type picker
//     emptyOptions: () => ({}),         // seed value for the sub-fields
//     OptionsForm: ({ options, onChange }) => JSX,
//     validate: (draft) => null | string,
//     summary: (entity) => string,      // optional list-row blurb
//     // TLS-only extras:
//     credentialsRefRequired: boolean,
//     credentialsRefPlaceholder: string,
//     credentialsRefHelp: JSX,
//     // Auth-only extras:
//     withInternalKeys: (config) => config,    // hydrate React `_key` markers
//     stripInternalKeys: (config) => config,   // strip them on save
//   }
//
// The discriminator field name is configurable (TLS uses `type`, auth uses
// `type` too — both happen to be the same, but the registry doesn't assume).
// The sub-fields container name is configurable: TLS providers store
// per-kind fields under `options`; auth providers store them under `config`.

export const buildKindRegistry = ({ kinds, discriminator = 'type', subFieldName }) => {
  const byValue = new Map(kinds.map(k => [k.value, k]));
  return Object.freeze({
    kinds,
    discriminator,
    subFieldName,
    byValue,
    typeOptions: kinds.map(k => ({ value: k.value, label: k.label })),
    get: value => byValue.get(value) ?? null,
    firstKindValue: kinds[0]?.value ?? null,
  });
};

export const getSubFields = (registry, draft) => {
  if (!registry.subFieldName) {
    return draft;
  }
  return draft[registry.subFieldName] ?? {};
};

export const setSubFields = (registry, draft, nextSubFields) => {
  if (!registry.subFieldName) {
    return { ...draft, ...nextSubFields };
  }
  return { ...draft, [registry.subFieldName]: nextSubFields };
};

// Reusable form fragment for the "wait N seconds for DNS propagation" knob
// that every certbot DNS-01 plugin accepts. Lives here (not in the TLS
// kinds module) so any future provider class that needs the same control
// can share it.
export const PropagationSecondsField = ({ value, onChange, help }) => (
  <Col md={4}>
    <Form.Group>
      <Form.Label>Propagation seconds</Form.Label>
      <Form.Control
        type="number"
        min={30}
        max={600}
        value={value ?? ''}
        placeholder="120"
        onChange={e => {
          const n = Number.parseInt(e.target.value, 10);
          onChange(Number.isInteger(n) ? n : undefined);
        }}
      />
      <Form.Text className="text-muted">{help}</Form.Text>
    </Form.Group>
  </Col>
);

PropagationSecondsField.propTypes = {
  value: PropTypes.number,
  onChange: PropTypes.func.isRequired,
  help: PropTypes.node.isRequired,
};
