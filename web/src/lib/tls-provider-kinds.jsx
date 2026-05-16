import PropTypes from 'prop-types';
import { Alert, Col, Form } from 'react-bootstrap';

import { buildKindRegistry, PropagationSecondsField } from './provider-kind-registry.jsx';

// v0.2.39 — TLS / ACME provider kinds registry. One entry per discriminated-
// union arm of `TLSProviderSchema` in state-schema.js. Adding a new kind is a
// single entry here + the matching zod arm + (if the kind needs a real ACME
// flow) the certbot wiring in `lib/certbot.js`.
//
// The registry is consumed by `TlsProviderEditModal` to render the type
// picker and the per-kind subform. Each entry owns its credentials-ref
// placeholder + inline help so the modal stays generic.

const ADDR_PORT_REGEX = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.-]+):\d{1,5}$/u;
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

const OvhOptionsForm = ({ options, onChange }) => (
  <>
    <Col md={4}>
      <Form.Group>
        <Form.Label>OVH endpoint</Form.Label>
        <Form.Select
          value={options.endpoint ?? 'ovh-eu'}
          onChange={e => onChange({ ...options, endpoint: e.target.value })}
        >
          <option value="ovh-eu">ovh-eu</option>
          <option value="ovh-ca">ovh-ca</option>
          <option value="kimsufi-eu">kimsufi-eu</option>
          <option value="soyoustart-eu">soyoustart-eu</option>
        </Form.Select>
        <Form.Text className="text-muted">
          Which OVH API endpoint your application key was issued against. This value also needs to
          be set as <code>dns_ovh_endpoint = &lt;endpoint&gt;</code> inside the credentials .ini
          file referenced above (certbot-dns-ovh reads it from there, not the CLI).
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

OvhOptionsForm.propTypes = {
  options: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const Rfc2136OptionsForm = ({ options, onChange }) => (
  <>
    <Col xs={12}>
      <Alert variant="info" className="small mb-1 py-2">
        Nameserver / TSIG key name / TSIG algorithm are read from the credentials .ini file by
        certbot-dns-rfc2136 — these fields are advisory metadata for patchpanel and aren&apos;t
        passed via CLI. Set <code>dns_rfc2136_server</code> / <code>dns_rfc2136_name</code> /
        <code>dns_rfc2136_algorithm</code> in the .ini referenced above alongside{' '}
        <code>dns_rfc2136_secret</code>.
      </Alert>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>Nameserver (host:port)</Form.Label>
        <Form.Control
          type="text"
          value={options.server ?? ''}
          placeholder="dns.example.com:53"
          onChange={e => onChange({ ...options, server: e.target.value || undefined })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>TSIG key name</Form.Label>
        <Form.Control
          type="text"
          value={options.tsigName ?? ''}
          placeholder="key-name"
          onChange={e => onChange({ ...options, tsigName: e.target.value || undefined })}
        />
      </Form.Group>
    </Col>
    <Col md={6}>
      <Form.Group>
        <Form.Label>TSIG algorithm</Form.Label>
        <Form.Select
          value={options.tsigAlgorithm ?? 'HMAC-SHA256'}
          onChange={e => onChange({ ...options, tsigAlgorithm: e.target.value })}
        >
          <option value="HMAC-SHA256">HMAC-SHA256</option>
          <option value="HMAC-SHA384">HMAC-SHA384</option>
          <option value="HMAC-SHA512">HMAC-SHA512</option>
          <option value="HMAC-MD5">HMAC-MD5 (legacy)</option>
        </Form.Select>
      </Form.Group>
    </Col>
    <PropagationSecondsField
      value={options.propagationSeconds}
      onChange={n => onChange({ ...options, propagationSeconds: n })}
      help={PROPAGATION_HELP}
    />
  </>
);

Rfc2136OptionsForm.propTypes = {
  options: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const DnsMultiOptionsForm = ({ options, onChange }) => (
  <>
    <Col md={4}>
      <Form.Group>
        <Form.Label>Underlying provider</Form.Label>
        <Form.Control
          type="text"
          value={options.provider ?? ''}
          placeholder="e.g. namecheap, gandi, hetzner"
          onChange={e => onChange({ ...options, provider: e.target.value || undefined })}
        />
        <Form.Text className="text-muted">
          Provider name as accepted by <code>certbot-dns-multi</code> (lego provider list). Set this
          value as <code>dns_multi_provider = &lt;name&gt;</code> in the credentials .ini —
          patchpanel records it here for documentation, but the plugin reads it from the .ini.
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

DnsMultiOptionsForm.propTypes = {
  options: PropTypes.object.isRequired,
  onChange: PropTypes.func.isRequired,
};

const ByoOptionsHint = () => (
  <Col xs={12}>
    <Alert variant="info" className="mb-0 small">
      Bring-your-own certs are uploaded from the <strong>Certificates</strong> tab via the{' '}
      <strong>Upload existing certificate</strong> button. Each upload creates a Certificate entry
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

const credentialsHelp = jsx => jsx;

const TLS_KINDS = Object.freeze([
  {
    value: 'dns-cloudflare',
    label: 'Cloudflare (DNS-01)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/cloudflare.ini',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to the Cloudflare credentials file inside the addon container. Should contain
        <code> dns_cloudflare_api_token = &lt;your-token&gt;</code> on one line. Mode 600.
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'Cloudflare DNS-01',
  },
  {
    value: 'dns-route53',
    label: 'AWS Route 53 (DNS-01)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/route53.ini',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to a file with <code>aws_access_key_id</code> + <code>aws_secret_access_key</code> (or
        use the AWS env vars via the addon&apos;s s6 service).
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: Route53OptionsForm,
    validate: () => null,
    summary: provider =>
      provider.options?.awsRegion ? `Route 53 (${provider.options.awsRegion})` : 'Route 53',
  },
  {
    value: 'dns-google',
    label: 'Google Cloud DNS (DNS-01)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/google.json',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to a Google Cloud service-account JSON file with the
        <code> dns.admin</code> role on the zone.
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'Google Cloud DNS-01',
  },
  {
    value: 'dns-digitalocean',
    label: 'DigitalOcean (DNS-01)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/digitalocean.ini',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to a file with <code>dns_digitalocean_token = &lt;your-token&gt;</code>. Mode 600.
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: SimplePropagationForm,
    validate: () => null,
    summary: () => 'DigitalOcean DNS-01',
  },
  {
    value: 'dns-ovh',
    label: 'OVH (DNS-01)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/ovh.ini',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to a file with <code>dns_ovh_application_key</code>,{' '}
        <code>dns_ovh_application_secret</code>, and <code>dns_ovh_consumer_key</code>.
      </>
    ),
    emptyOptions: () => ({ endpoint: 'ovh-eu' }),
    OptionsForm: OvhOptionsForm,
    validate: () => null,
    summary: provider => `OVH (${provider.options?.endpoint ?? 'ovh-eu'})`,
  },
  {
    value: 'dns-rfc2136',
    label: 'RFC 2136 dynamic DNS (DNS-01)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/rfc2136.ini',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to a file with the TSIG <code>dns_rfc2136_secret</code> for the configured nameserver +
        key name + algorithm below.
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: Rfc2136OptionsForm,
    validate: draft => {
      if (draft.options?.server && !ADDR_PORT_REGEX.test(draft.options.server)) {
        return 'rfc2136 server must be host:port';
      }
      return null;
    },
    summary: provider =>
      provider.options?.server ? `RFC 2136 → ${provider.options.server}` : 'RFC 2136 dynamic DNS',
  },
  {
    value: 'dns-multi',
    label: 'certbot-dns-multi (covers 100+ DNS APIs)',
    credentialsRefRequired: true,
    credentialsRefPlaceholder: '/data/credentials/dns-multi.ini',
    credentialsRefHelp: credentialsHelp(
      <>
        Path to a file with the <code>certbot-dns-multi</code> plugin&apos;s credentials. Format
        depends on the underlying provider — see the lego/certbot-dns-multi docs.
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: DnsMultiOptionsForm,
    validate: () => null,
    summary: provider =>
      provider.options?.provider
        ? `certbot-dns-multi (${provider.options.provider})`
        : 'certbot-dns-multi',
  },
  {
    value: 'http-01',
    label: "Let's Encrypt HTTP-01 (webroot)",
    credentialsRefRequired: false,
    credentialsRefPlaceholder: null,
    credentialsRefHelp: credentialsHelp(
      <>
        HTTP-01 doesn&apos;t use a credentials file. The challenge is served from{' '}
        <code>state.frontends.http.acmeWebrootPath</code> — port 80 must be reachable from the
        public Internet.
      </>
    ),
    emptyOptions: () => ({}),
    OptionsForm: Http01OptionsHint,
    validate: () => null,
    summary: () => "Let's Encrypt HTTP-01",
  },
  {
    value: 'byo',
    label: 'Bring-your-own certificate (no ACME)',
    credentialsRefRequired: false,
    credentialsRefPlaceholder: null,
    credentialsRefHelp: credentialsHelp(
      <>
        BYO certs skip ACME entirely. Upload via the <strong>Upload existing certificate</strong>{' '}
        button on the Certificates tab — patchpanel writes the PEM to disk and creates the matching
        Certificate entry automatically.
      </>
    ),
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
