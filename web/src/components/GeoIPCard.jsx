import PropTypes from 'prop-types';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { Trans, useTranslation } from 'react-i18next';

import { apiGet, apiPost } from '../api/client.js';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

const FALLBACK_PROVIDERS = Object.freeze([
  { value: 'none', labelKey: 'geoip:fallback.none', labelFallback: 'None — local DB only' },
  {
    value: 'ip-api',
    labelKey: 'geoip:fallback.ipApi',
    labelFallback: 'ip-api.com (free, no token)',
  },
  {
    value: 'ipinfo',
    labelKey: 'geoip:fallback.ipinfo',
    labelFallback: 'ipinfo.io (token recommended)',
  },
]);

const LOCAL_DB_SOURCES = Object.freeze([
  {
    value: 'dbip',
    labelKey: 'geoip:localDb.dbip',
    labelFallback: 'DB-IP city-lite (free, no signup — recommended)',
    needsKey: false,
  },
  {
    value: 'maxmind',
    labelKey: 'geoip:localDb.maxmind',
    labelFallback: 'MaxMind GeoLite2-City (requires free license key)',
    needsKey: true,
  },
  {
    value: 'none',
    labelKey: 'geoip:localDb.none',
    labelFallback: 'No local DB — online fallback only',
    needsKey: false,
  },
]);

const sourceLabel = (value, t) => {
  const src = LOCAL_DB_SOURCES.find(s => s.value === value);
  if (!src) {
    return value;
  }
  return t(src.labelKey, src.labelFallback);
};

const localDbBadge = (status, t) => {
  if (status.localDbSource === 'none') {
    return { bg: 'secondary', label: t('geoip:badge.disabled', 'disabled') };
  }
  if (status.dbExists) {
    return { bg: 'success', label: t('geoip:badge.present', 'present') };
  }
  return { bg: 'secondary', label: t('geoip:badge.notDownloaded', 'not downloaded') };
};

const downloadButtonLabel = (current, t) => {
  if (current.localDbSource === 'maxmind') {
    return t('geoip:download.maxmind', 'Download GeoLite2-City');
  }
  if (current.localDbSource === 'dbip') {
    return t('geoip:download.dbip', 'Download DB-IP city-lite');
  }
  return t('geoip:download.now', 'Download now');
};

const downloadButtonTitle = (current, t) => {
  if (current.localDbSource === 'none') {
    return t('geoip:download.titleDisabled', 'Local DB disabled — pick DB-IP or MaxMind first');
  }
  if (current.localDbSource === 'maxmind' && !current.maxmindLicenseKey) {
    return t('geoip:download.titleNeedKey', 'Set a MaxMind license key first');
  }
  if (current.localDbSource === 'maxmind') {
    return t('geoip:download.titleMaxmind', 'Trigger an immediate GeoLite2-City download');
  }
  return t(
    'geoip:download.titleDbip',
    'Trigger an immediate DB-IP city-lite download (free, no signup)'
  );
};

const formatBytes = n => {
  if (!Number.isFinite(n) || n <= 0) {
    return '—';
  }
  if (n < 1024 * 1024) {
    return `${(n / 1024).toFixed(1)} KB`;
  }
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const formatDate = iso => {
  if (!iso) {
    return '—';
  }
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

const StatusBadgeBlock = ({ status }) => {
  const { t } = useTranslation(['geoip', 'common']);
  const badge = localDbBadge(status, t);
  return (
    <Alert variant={status.dbExists ? 'info' : 'secondary'} className="small">
      <div className="d-flex flex-wrap gap-3">
        <span>
          <strong>{t('geoip:status.statusLabel', 'Status:')}</strong>{' '}
          {status.enabled ? (
            <Badge bg="success">{t('geoip:status.enabled', 'enabled')}</Badge>
          ) : (
            <Badge bg="secondary">{t('geoip:status.disabled', 'disabled')}</Badge>
          )}
        </span>
        <span>
          <strong>{t('geoip:status.sourceLabel', 'Source:')}</strong>{' '}
          <Badge bg="info">{sourceLabel(status.localDbSource, t)}</Badge>
        </span>
        {status.localDbSource === 'maxmind' ? (
          <span>
            <strong>{t('geoip:status.licenseKeyLabel', 'License key:')}</strong>{' '}
            {status.licenseKeySet ? (
              <Badge bg="success">{t('geoip:status.licenseSet', 'set')}</Badge>
            ) : (
              <Badge bg="warning" text="dark">
                {t('geoip:status.licenseMissing', 'missing')}
              </Badge>
            )}
          </span>
        ) : null}
        <span>
          <strong>{t('geoip:status.localDbLabel', 'Local DB:')}</strong>{' '}
          <Badge bg={badge.bg}>{badge.label}</Badge>
        </span>
        <span>
          <strong>{t('geoip:status.sizeLabel', 'Size:')}</strong> {formatBytes(status.dbSize)}
        </span>
        <span>
          <strong>{t('geoip:status.lastUpdatedLabel', 'Last updated:')}</strong>{' '}
          {formatDate(status.dbMtime)}
        </span>
      </div>
    </Alert>
  );
};

StatusBadgeBlock.propTypes = {
  status: PropTypes.object.isRequired,
};

const useGeoIpStatus = downloadResult => {
  const [status, setStatus] = useState(null);
  const [statusError, setStatusError] = useState(null);
  const refresh = useCallback(() => {
    apiGet('api/geoip/status')
      .then(payload => {
        setStatus(payload);
        setStatusError(null);
      })
      .catch(err => setStatusError(err));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh, downloadResult]);
  return { status, statusError };
};

const useDownloadHandler = t => {
  const [downloading, setDownloading] = useState(false);
  const [downloadResult, setDownloadResult] = useState(null);
  const handleDownload = async () => {
    setDownloading(true);
    setDownloadResult(null);
    try {
      const result = await apiPost('api/geoip/download');
      setDownloadResult({
        kind: 'success',
        message: t('geoip:download.success', 'Downloaded {{size}} to {{path}}', {
          size: formatBytes(result.bytes),
          path: result.path,
        }),
      });
    } catch (err) {
      setDownloadResult({ kind: 'danger', message: err.message });
    } finally {
      setDownloading(false);
    }
  };
  return { downloading, downloadResult, setDownloadResult, handleDownload };
};

export const GeoIPCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['geoip', 'common']);
  const [draft, setDraft] = useState(null);
  const [saveStatus, setSaveStatus] = useState(null);
  const { downloading, downloadResult, setDownloadResult, handleDownload } = useDownloadHandler(t);
  const { status, statusError } = useGeoIpStatus(downloadResult);
  const current = draft ?? doc.geoip;
  const update = patch => {
    setSaveStatus(null);
    setDraft({ ...current, ...patch });
  };

  const submit = event => {
    event.preventDefault();
    setSaveStatus(null);
    onSave({ ...doc, geoip: current })
      .then(() => {
        setSaveStatus({ kind: 'success', message: t('geoip:saved', 'Saved.') });
        setDraft(null);
      })
      .catch(err => setSaveStatus({ kind: 'danger', message: err.message }));
  };

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title>{t('geoip:card.title', 'GeoIP')}</Card.Title>
        <Card.Text className="text-muted small">
          <Trans
            i18nKey="geoip:card.description"
            t={t}
            defaults="When enabled, patchpanel enriches live-session data with city / country / region lookups from a local MMDB. Default source is <0>DB-IP city-lite</0> (free, CC-BY 4.0, no signup, monthly updates). MaxMind GeoLite2-City is also supported if you already have a license key. Client IPs never leave the addon. The Top countries panel on the dashboard and the Top client IPs card on Stats both use this."
            components={[<strong key="0" />]}
          />
        </Card.Text>
        {saveStatus ? <Alert variant={saveStatus.kind}>{saveStatus.message}</Alert> : null}
        {statusError ? (
          <Alert variant="warning" className="small">
            {t('geoip:status.unavailable', 'GeoIP status unavailable: {{message}}', {
              message: statusError.message,
            })}
          </Alert>
        ) : null}
        {status ? <StatusBadgeBlock status={status} /> : null}
        {downloadResult ? (
          <Alert variant={downloadResult.kind} onClose={() => setDownloadResult(null)} dismissible>
            {downloadResult.message}
          </Alert>
        ) : null}
        <Form onSubmit={submit}>
          <Row className="g-3">
            <Col md={4} className="d-flex align-items-end">
              <Form.Check
                type="switch"
                id="geoip-enabled"
                label={t('geoip:form.enrichmentEnabled', 'GeoIP enrichment enabled')}
                checked={current.enabled}
                onChange={e => update({ enabled: e.target.checked })}
              />
            </Col>
            <Col md={8}>
              <Form.Group>
                <Form.Label>{t('geoip:form.localDbSource', 'Local DB source')}</Form.Label>
                <Form.Select
                  value={current.localDbSource ?? 'dbip'}
                  onChange={e => update({ localDbSource: e.target.value })}
                >
                  {LOCAL_DB_SOURCES.map(s => (
                    <option key={s.value} value={s.value}>
                      {t(s.labelKey, s.labelFallback)}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  {t(
                    'geoip:form.localDbHint',
                    'DB-IP city-lite works out of the box (no signup). Pick MaxMind if you already have a GeoLite2 license key; pick None to disable local lookups and use only the online fallback.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>

            {current.localDbSource === 'maxmind' ? (
              <Col md={12}>
                <Form.Group>
                  <Form.Label>{t('geoip:form.maxmindLicense', 'MaxMind license key')}</Form.Label>
                  <Form.Control
                    type="password"
                    value={current.maxmindLicenseKey ?? ''}
                    onChange={e => update({ maxmindLicenseKey: e.target.value || null })}
                    placeholder={t(
                      'geoip:form.maxmindPlaceholder',
                      'get one free at maxmind.com/en/geolite2/signup'
                    )}
                    autoComplete="off"
                  />
                  <Form.Text className="text-muted">
                    <Trans
                      i18nKey="geoip:form.maxmindHint"
                      t={t}
                      defaults="Required to download GeoLite2-City. Stored in <0>state.json</0>; protect that file accordingly."
                      components={[<code key="0" />]}
                    />
                  </Form.Text>
                </Form.Group>
              </Col>
            ) : null}

            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  {t('geoip:form.fallbackProvider', 'Online fallback provider')}
                </Form.Label>
                <Form.Select
                  value={current.fallbackProvider}
                  onChange={e => update({ fallbackProvider: e.target.value })}
                >
                  {FALLBACK_PROVIDERS.map(p => (
                    <option key={p.value} value={p.value}>
                      {t(p.labelKey, p.labelFallback)}
                    </option>
                  ))}
                </Form.Select>
                <Form.Text className="text-muted">
                  {t(
                    'geoip:form.fallbackHint',
                    "Used for one-off IP lookups when the local DB is missing or doesn't cover an address. Bulk session enrichment always uses the local DB."
                  )}
                </Form.Text>
              </Form.Group>
            </Col>
            <Col md={6}>
              <Form.Group>
                <Form.Label>
                  {t('geoip:form.fallbackToken', 'Fallback provider token (optional)')}
                </Form.Label>
                <Form.Control
                  type="password"
                  value={current.fallbackToken ?? ''}
                  onChange={e => update({ fallbackToken: e.target.value || null })}
                  placeholder={t('geoip:form.fallbackTokenPlaceholder', 'ipinfo token')}
                  autoComplete="off"
                  disabled={current.fallbackProvider !== 'ipinfo'}
                />
              </Form.Group>
            </Col>

            <Col md={6}>
              <Form.Group>
                <Form.Label>{t('geoip:form.cron', 'Auto-update cron schedule')}</Form.Label>
                <Form.Control
                  type="text"
                  value={current.autoUpdateCron}
                  onChange={e => update({ autoUpdateCron: e.target.value })}
                  placeholder="17 4 * * 1"
                />
                <Form.Text className="text-muted">
                  {t(
                    'geoip:form.cronHint',
                    'Weekly Monday 04:17 by default. DB-IP publishes on the 1st of each month; MaxMind publishes GeoLite2 twice a week.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>

            <Col xs={12}>
              <hr className="my-1" />
              <div className="text-muted small mb-2">
                <Trans
                  i18nKey="geoip:form.homeLocationHint"
                  t={t}
                  defaults="<0>Home location for LAN traffic (optional).</0> When all four are set, private / RFC1918 source IPs are resolved to these coordinates instead of being ignored — useful for attributing LAN sessions to your physical location on the dashboard's Top countries panel."
                  components={[<strong key="0" />]}
                />
              </div>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>{t('geoip:form.homeLat', 'Home latitude')}</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  value={current.homeLatitude ?? ''}
                  placeholder="40.31579811020137"
                  onChange={e => {
                    const v = e.target.value;
                    const n = v === '' ? null : Number(v);
                    update({ homeLatitude: Number.isFinite(n) ? n : null });
                  }}
                />
              </Form.Group>
            </Col>
            <Col md={3}>
              <Form.Group>
                <Form.Label>{t('geoip:form.homeLon', 'Home longitude')}</Form.Label>
                <Form.Control
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  value={current.homeLongitude ?? ''}
                  placeholder="-88.14086990339744"
                  onChange={e => {
                    const v = e.target.value;
                    const n = v === '' ? null : Number(v);
                    update({ homeLongitude: Number.isFinite(n) ? n : null });
                  }}
                />
              </Form.Group>
            </Col>
            <Col md={2}>
              <Form.Group>
                <Form.Label>{t('geoip:form.homeCountry', 'Country (ISO-2)')}</Form.Label>
                <Form.Control
                  type="text"
                  maxLength={2}
                  value={current.homeCountry ?? ''}
                  placeholder="US"
                  onChange={e =>
                    update({
                      homeCountry: e.target.value ? e.target.value.toUpperCase() : null,
                    })
                  }
                />
              </Form.Group>
            </Col>
            <Col md={4}>
              <Form.Group>
                <Form.Label>{t('geoip:form.homeLabel', 'Home label')}</Form.Label>
                <Form.Control
                  type="text"
                  maxLength={64}
                  value={current.homeLabel ?? ''}
                  placeholder={t('geoip:form.homeLabelPlaceholder', 'Home')}
                  onChange={e => update({ homeLabel: e.target.value || null })}
                />
                <Form.Text className="text-muted">
                  {t(
                    'geoip:form.homeLabelHint',
                    'Shown as the "city" on Top client IPs for LAN traffic.'
                  )}
                </Form.Text>
              </Form.Group>
            </Col>

            <Col xs={12}>
              <div className="d-flex gap-2">
                <Button type="submit" variant="primary" disabled={!draft}>
                  {t('geoip:form.saveSettings', 'Save GeoIP settings')}
                </Button>
                <Button
                  variant="outline-primary"
                  onClick={handleDownload}
                  disabled={
                    downloading ||
                    current.localDbSource === 'none' ||
                    (current.localDbSource === 'maxmind' && !current.maxmindLicenseKey)
                  }
                  title={downloadButtonTitle(current, t)}
                >
                  {downloading ? (
                    <>
                      <Spinner as="span" animation="border" size="sm" />{' '}
                      <span>{t('geoip:download.downloading', 'Downloading…')}</span>
                    </>
                  ) : (
                    <>
                      <i className="bi bi-cloud-download me-1" />
                      {downloadButtonLabel(current, t)}
                    </>
                  )}
                </Button>
              </div>
            </Col>
          </Row>
        </Form>
      </Card.Body>
    </Card>
  );
};

GeoIPCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
