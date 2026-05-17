import PropTypes from 'prop-types';
import { Alert, Col, Form } from 'react-bootstrap';

import { buildKindRegistry, PropagationSecondsField } from './provider-kind-registry.jsx';

// TLS / ACME provider kinds. One entry per discriminated-union arm of
// `TLSProviderSchema`. The credentials side of each kind (api tokens,
// secrets, etc.) is now server-driven via /api/tls-providers/credential-
// template/:type — kind entries here only describe state-side `options`
// (CLI-style knobs like AWS region, propagation seconds).

const PROPAGATION_HELP =
  'How long to wait for DNS records to propagate before retrying ACME validation. 30-600 seconds.';

const SimplePropagationForm = ({ options, onChange }) => (
  <PropagationSecondsField
    value={options.propagationSeconds}
    onChange={n => onChange({ ...options, propagationSeconds: n })}
    help={PROPAGATION_HELP}
  />
);

SimplePropagationForm.propTypes = {
  options: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const Route53OptionsForm = ({ options, onChange }) => (
  <>
    <Col md={4}>
      <Form.Group>
        <Form.Label>AWS region</Form.Label>
        <Form.Control
          type="text"
          value={options.awsRegion ?? ''}
          placeholder="us-east-1 (optional)"
          onChange={e => onChange({ ...options, awsRegion: e.target.value || undefined })}
        />
        <Form.Text className="text-muted">
          Optional. When set, patchpanel passes <code>AWS_REGION=&lt;region&gt;</code> to the
          certbot subprocess so boto3 picks the right Route 53 partition. Leave blank to inherit
          whatever <code>AWS_REGION</code> the addon process already has.
        </Form.Text>
      </Form.Group>
    </Col>
    <PropagationSecondsField
      value={options.propagationSeconds}
      onChange={n => onChange({ ...options, propagationSeconds: n })}
      help={PROPAGATION_HELP}
    />
  </>
);

Route53OptionsForm.propTypes = {
  options: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const ByoOptionsHint = () => (
  <Col xs={12}>
    <Alert variant="info" className="mb-0 small">
      Bring-your-own certs are uploaded from the <strong>Certificates</strong> tab — in the{' '}
      <strong>Add certificate</strong> form, pick <strong>Bring-your-own</strong> as the TLS
      provider to switch the body to PEM upload fields. Each upload creates a Certificate entry
      automatically — you don&apos;t need to configure anything per-provider here.
    </Alert>
  </Col>
);

const Http01OptionsHint = () => (
  <Col xs={12}>
    <Alert variant="info" className="mb-0 small">
      HTTP-01 has no per-provider options — the webroot path comes from{' '}
      <strong>Frontends → frontend http-in → ACME webroot path</strong>.
    </Alert>
  </Col>
);

const TLS_KINDS = Object.freeze([
  {
    value: 'dns-cloudflare',
    label: 'Cloudflare (DNS-01)',
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'Cloudflare DNS-01',
  },
  {
    value: 'dns-route53',
    label: 'AWS Route 53 (DNS-01)',
    emptyOptions: () => ({}),
    OptionsForm: Route53OptionsForm,
    validate: () => null,
    summary: provider =>
      provider.options?.awsRegion ? `Route 53 (${provider.options.awsRegion})` : 'Route 53',
  },
  {
    value: 'dns-google',
    label: 'Google Cloud DNS (DNS-01)',
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'Google Cloud DNS-01',
  },
  {
    value: 'dns-digitalocean',
    label: 'DigitalOcean (DNS-01)',
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'DigitalOcean DNS-01',
  },
  {
    value: 'dns-ovh',
    label: 'OVH (DNS-01)',
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'OVH (DNS-01)',
  },
  {
    value: 'dns-rfc2136',
    label: 'RFC 2136 dynamic DNS (DNS-01)',
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'RFC 2136 dynamic DNS',
  },
  {
    value: 'dns-multi',
    label: 'certbot-dns-multi (covers 100+ DNS APIs)',
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'certbot-dns-multi',
  },
  {
    value: 'http-01',
    label: "Let's Encrypt HTTP-01 (webroot)",
    emptyOptions: () => ({}),
    OptionsForm: Http01OptionsHint,
    validate: () => null,
    summary: () => "Let's Encrypt HTTP-01",
  },
  {
    value: 'byo',
    label: 'Bring-your-own certificate (no ACME)',
    emptyOptions: () => ({}),
    OptionsForm: ByoOptionsHint,
    validate: () => null,
    summary: () => 'Bring-your-own',
  },
]);

export const TLS_PROVIDER_REGISTRY = buildKindRegistry({
  kinds: TLS_KINDS,
  discriminator: 'type',
  subFieldName: 'options',
});
