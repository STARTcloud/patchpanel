import PropTypes from 'prop-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  ButtonGroup,
  Card,
  Form,
  InputGroup,
  Modal,
  Spinner,
  Table,
} from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { apiDelete, apiGet } from '../api/client.js';
import { AcmeAccountsCard } from '../components/AcmeAccountsCard.jsx';
import { CertEditModal } from '../components/CertEditModal.jsx';
import { ConfirmDialog } from '../components/ConfirmDialog.jsx';
import { EntitySectionCard } from '../components/EntitySectionCard.jsx';
import { LetsencryptCard } from '../components/LetsencryptCard.jsx';
import { TrustedCAsCard } from '../components/TrustedCAsCard.jsx';
import { TrustedCRLsCard } from '../components/TrustedCRLsCard.jsx';
import { useActions } from '../hooks/useActions.jsx';
import { CRT_STORES_SECTION } from '../lib/section-configs.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

// v0.2.39 — Advanced "what's on disk under byoCertsDir" panel. Renamed
// from "BYO lineages" to "Uploaded certificate files" and dropped the
// big visual prominence — uploads are now the main flow on the certs
// table itself, this panel just exists for disk cleanup of orphans
// (PEM files that no longer have a matching Certificate entry in state).
const UploadedFilesPanel = ({ doc, refreshSignal, disabled }) => {
  const { t } = useTranslation(['cert', 'common']);
  const [certFiles, setCertFiles] = useState([]);
  const [deleting, setDeleting] = useState(null);
  const [error, setError] = useState(null);

  const refresh = useCallback(() => {
    apiGet('api/byo-certs')
      .then(payload => {
        setCertFiles(payload?.certs ?? []);
        setError(null);
      })
      .catch(err => setError(err));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, refreshSignal]);

  const handleDelete = async () => {
    const target = deleting;
    setDeleting(null);
    try {
      await apiDelete(`api/byo-certs/${encodeURIComponent(target.name)}`);
      refresh();
    } catch (err) {
      setError(err);
    }
  };

  const certEntryNames = new Set(
    doc.tls.certs
      .filter(c => doc.tls.providers.find(p => p.id === c.providerId)?.type === 'byo')
      .map(c => c.certName)
  );

  if (certFiles.length === 0) {
    return null;
  }

  return (
    <Card className="mb-3">
      <Card.Body>
        <Card.Title className="d-flex align-items-center gap-2 mb-1">
          <i className="bi bi-hdd" />
          {t('cert:uploadedFiles.title', 'Uploaded certificate files (advanced)')}
        </Card.Title>
        <Card.Text className="text-muted small mb-2">
          {t(
            'cert:uploadedFiles.description',
            'Files currently stored under the BYO cert directory. Each row corresponds to one folder on disk. Orphans (rows without a matching Certificate entry above) accumulate when you delete a Certificate entry without removing its PEM, or when files are dropped in by hand. Cleanup here removes the on-disk PEM only — Certificate entries in state are unaffected.'
          )}
        </Card.Text>
        {error ? (
          <Alert variant="danger" onClose={() => setError(null)} dismissible>
            {error.message}
          </Alert>
        ) : null}
        <Table size="sm" bordered hover responsive>
          <thead>
            <tr>
              <th>{t('cert:uploadedFiles.columns.name', 'Name')}</th>
              <th>{t('cert:uploadedFiles.columns.status', 'Status')}</th>
              <th>{t('cert:uploadedFiles.columns.uploaded', 'Uploaded')}</th>
              <th className="text-end">{t('cert:uploadedFiles.columns.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {certFiles.map(file => {
              const wired = certEntryNames.has(file.name);
              return (
                <tr key={file.name}>
                  <td>
                    <code>{file.name}</code>
                  </td>
                  <td>
                    {wired ? (
                      <Badge bg="success">{t('cert:uploadedFiles.badge.inUse', 'in use')}</Badge>
                    ) : (
                      <Badge bg="warning" text="dark">
                        {t('cert:uploadedFiles.badge.orphan', 'orphan')}
                      </Badge>
                    )}
                    {!file.complete ? (
                      <Badge bg="danger" className="ms-1">
                        {t('cert:uploadedFiles.badge.incomplete', 'incomplete')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="small">
                    {file.uploadedAt ? new Date(file.uploadedAt).toLocaleString() : '—'}
                  </td>
                  <td className="text-end">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => setDeleting(file)}
                      disabled={disabled}
                    >
                      {t('cert:uploadedFiles.actions.deleteFiles', 'Delete files')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card.Body>
      {deleting ? (
        <ConfirmDialog
          show
          title={t('cert:uploadedFiles.confirmDelete.title', 'Delete uploaded files?')}
          body={
            <>
              {t('cert:uploadedFiles.confirmDelete.bodyPrefix', 'Delete the PEM files for')}{' '}
              <code>{deleting.name}</code>{' '}
              {t(
                'cert:uploadedFiles.confirmDelete.bodySuffix',
                'from disk? Any Certificate entry pointing at this name will become un-loadable until you replace the files.'
              )}
            </>
          }
          confirmLabel={t('common:buttons.delete', 'Delete')}
          onConfirm={handleDelete}
          onCancel={() => setDeleting(null)}
        />
      ) : null}
    </Card>
  );
};

UploadedFilesPanel.propTypes = {
  doc: PropTypes.object.isRequired,
  refreshSignal: PropTypes.number.isRequired,
  disabled: PropTypes.bool,
};

const statusBadge = (newest, t) => {
  if (!newest || !newest.notAfter) {
    return <Badge bg="danger">{t('cert:status.missing', 'missing')}</Badge>;
  }
  const expires = new Date(newest.notAfter);
  const days = Math.round((expires.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return <Badge bg="danger">{t('cert:status.expired', 'expired')}</Badge>;
  }
  if (days < 14) {
    return <Badge bg="warning">{t('cert:status.daysShort', '{{days}}d', { days })}</Badge>;
  }
  return <Badge bg="success">{t('cert:status.daysShort', '{{days}}d', { days })}</Badge>;
};

// SAN list modal — for certs with many domains (40+ is common when one
// cert covers a whole homelab) the inline comma-joined list blows the row
// height up. The "+N more" badge in the table cell opens this modal with
// the full filterable list.
const SansListModal = ({ show, certName, domains, onClose }) => {
  const { t } = useTranslation(['cert', 'common']);
  const [filter, setFilter] = useState('');
  const trimmed = filter.trim().toLowerCase();
  const visible = trimmed ? domains.filter(d => d.toLowerCase().includes(trimmed)) : domains;
  return (
    <Modal show={show} onHide={onClose} size="lg" scrollable>
      <Modal.Header closeButton>
        <Modal.Title className="h5">
          {t('cert:sansList.title', '{{count}} SAN on {{certName}}', {
            count: domains.length,
            certName,
          })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <InputGroup size="sm" className="mb-2">
          <InputGroup.Text>
            <i className="bi bi-search" />
          </InputGroup.Text>
          <Form.Control
            placeholder={t('cert:sansList.filterPlaceholder', 'Filter SANs…')}
            value={filter}
            onChange={e => setFilter(e.target.value)}
          />
          {filter ? (
            <Button variant="outline-secondary" onClick={() => setFilter('')}>
              ×
            </Button>
          ) : null}
        </InputGroup>
        <div className="text-muted small mb-2">
          {visible.length === domains.length
            ? t('cert:sansList.count.total', '{{count}} total', { count: domains.length })
            : t('cert:sansList.count.match', '{{visible}} of {{total}} match', {
                visible: visible.length,
                total: domains.length,
              })}
        </div>
        {visible.length === 0 ? (
          <p className="text-muted mb-0">
            {t('cert:sansList.noMatch', 'No SANs match the filter.')}
          </p>
        ) : (
          <ul className="list-unstyled mb-0 font-monospace small">
            {visible.map(d => (
              <li key={d} className="py-1 border-bottom border-light">
                {d}
              </li>
            ))}
          </ul>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onClose}>
          {t('common:buttons.close', 'Close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

SansListModal.propTypes = {
  show: PropTypes.bool.isRequired,
  certName: PropTypes.string.isRequired,
  domains: PropTypes.arrayOf(PropTypes.string).isRequired,
  onClose: PropTypes.func.isRequired,
};

const SansCell = ({ cert }) => {
  const { t } = useTranslation(['cert']);
  const [showModal, setShowModal] = useState(false);
  const domains = cert.domains ?? [];
  if (domains.length === 0) {
    return <span className="text-muted">—</span>;
  }
  if (domains.length <= 3) {
    return (
      <div className="d-flex flex-column gap-1">
        {domains.map(d => (
          <code key={d} className="small">
            {d}
          </code>
        ))}
      </div>
    );
  }
  const [first, second] = domains;
  const remaining = domains.length - 2;
  return (
    <>
      <div className="d-flex flex-column gap-1">
        <code className="small">{first}</code>
        <code className="small">{second}</code>
        <Badge
          bg="info"
          as="button"
          type="button"
          className="border-0 align-self-start"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowModal(true)}
          title={t('cert:sansCell.showAllTitle', 'Show all {{count}} SANs on {{certName}}', {
            count: domains.length,
            certName: cert.certName,
          })}
        >
          <i className="bi bi-list-ul me-1" />
          {t('cert:sansCell.moreBadge', '+{{count}} more', { count: remaining })}
        </Badge>
      </div>
      {showModal ? (
        <SansListModal
          show
          certName={cert.certName}
          domains={domains}
          onClose={() => setShowModal(false)}
        />
      ) : null}
    </>
  );
};

SansCell.propTypes = {
  cert: PropTypes.shape({
    certName: PropTypes.string.isRequired,
    domains: PropTypes.arrayOf(PropTypes.string),
  }).isRequired,
};

const PROVIDER_TYPE_VARIANTS = Object.freeze({
  'dns-cloudflare': 'info',
  'dns-route53': 'info',
  'dns-google': 'info',
  'dns-digitalocean': 'info',
  'dns-ovh': 'info',
  'dns-rfc2136': 'info',
  'dns-multi': 'info',
  'http-01': 'secondary',
  byo: 'warning',
});

const ProviderCell = ({ providerId, provider }) => {
  const { t } = useTranslation(['cert', 'common']);
  const variant = PROVIDER_TYPE_VARIANTS[provider?.type] ?? 'secondary';
  return (
    <div className="d-flex flex-column gap-1">
      <Link
        to={`/providers?focus=${encodeURIComponent(providerId)}`}
        title={t('cert:providerCell.linkTitle', 'Jump to this TLS provider on the Providers tab')}
      >
        <code>{providerId}</code>
      </Link>
      {provider?.type ? (
        <Badge
          bg={variant}
          text={variant === 'warning' ? 'dark' : undefined}
          className="align-self-start"
        >
          {provider.type}
        </Badge>
      ) : (
        <Badge bg="danger" className="align-self-start">
          {t('common:status.unknown', 'Unknown')}
        </Badge>
      )}
    </div>
  );
};

ProviderCell.propTypes = {
  providerId: PropTypes.string.isRequired,
  provider: PropTypes.shape({ type: PropTypes.string }),
};

const cloneCertInList = (cert, existingCerts) => {
  const existingIds = new Set(existingCerts.map(c => c.id));
  const existingCertNames = new Set(existingCerts.map(c => c.certName));
  const nextSuffix = base => {
    let s = 1;
    let candidate = `${base}-copy`;
    while (existingIds.has(candidate) || existingCertNames.has(candidate)) {
      s += 1;
      candidate = `${base}-copy-${s}`;
    }
    return candidate;
  };
  return { ...cert, id: nextSuffix(cert.id), certName: nextSuffix(cert.certName) };
};

const CertSettingsAccordion = ({ doc, onSave }) => {
  const { t } = useTranslation(['cert']);
  const accounts = doc.acmeAccounts ?? [];
  const trustedCas = doc.trustedCas ?? [];
  const trustedCrls = doc.trustedCrls ?? [];
  const initialKey = accounts.length === 0 ? '0' : null;
  return (
    <Accordion className="mb-3" defaultActiveKey={initialKey}>
      <Accordion.Item eventKey="0">
        <Accordion.Header>
          <i className="bi bi-person-badge me-2" />
          {t('cert:settings.acmeAccounts', 'ACME accounts ({{count}})', { count: accounts.length })}
        </Accordion.Header>
        <Accordion.Body>
          <AcmeAccountsCard doc={doc} onSave={onSave} />
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="1">
        <Accordion.Header>
          <i className="bi bi-shield-plus me-2" />
          {t('cert:settings.trustedCas', 'Trusted CAs ({{count}})', { count: trustedCas.length })}
        </Accordion.Header>
        <Accordion.Body>
          <TrustedCAsCard doc={doc} onSave={onSave} />
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="2">
        <Accordion.Header>
          <i className="bi bi-shield-x me-2" />
          {t('cert:settings.trustedCrls', 'Trusted CRLs ({{count}})', {
            count: trustedCrls.length,
          })}
        </Accordion.Header>
        <Accordion.Body>
          <TrustedCRLsCard doc={doc} onSave={onSave} />
        </Accordion.Body>
      </Accordion.Item>
      <Accordion.Item eventKey="3">
        <Accordion.Header>
          <i className="bi bi-shield-lock me-2" />
          {t('cert:settings.renewal', 'Renewal settings')}
        </Accordion.Header>
        <Accordion.Body>
          <LetsencryptCard doc={doc} onSave={onSave} />
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  );
};

CertSettingsAccordion.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};

const renewalAlert = (lastResult, t) => {
  if (!lastResult) {
    return null;
  }
  const isAll = lastResult.kind === 'renew';
  const isSingle = typeof lastResult.kind === 'string' && lastResult.kind.startsWith('renew-');
  if (!isAll && !isSingle) {
    return null;
  }
  const allOk = lastResult.results.every(r => r.ok);
  const variant = allOk && lastResult.reload?.ok ? 'success' : 'warning';
  const label = isSingle
    ? t('cert:renewalAlert.singleLabel', 'Single-cert renewal')
    : t('cert:renewalAlert.allLabel', 'Renewal');
  return (
    <Alert variant={variant}>
      <div>
        {t('cert:renewalAlert.summary', '{{label}} completed. Loadable certificates: {{count}}.', {
          label,
          count: lastResult.loadableCertCount,
        })}{' '}
        {lastResult.reload?.ok
          ? t('cert:renewalAlert.reloadOk', 'HAProxy reloaded.')
          : t('cert:renewalAlert.reloadFail', 'HAProxy reload skipped or failed.')}
      </div>
      {lastResult.results.length > 0 ? (
        <ul className="mb-0 mt-2">
          {lastResult.results.map(r => (
            <li key={r.certName}>
              <code>{r.certName}</code>:{' '}
              {r.ok
                ? t('cert:renewalAlert.itemOk', 'success')
                : t('cert:renewalAlert.itemFail', 'failed — {{error}}', { error: r.error })}
            </li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
};

export const CertificatesPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['cert', 'common']);
  const [live, setLive] = useState(null);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [uploadedFilesBump, setUploadedFilesBump] = useState(0);
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');
  const focusedRowRef = useRef(null);
  const actions = useActions();

  useEffect(() => {
    if (focusedRowRef.current) {
      focusedRowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusId, live]);

  useEffect(() => {
    let active = true;
    apiGet('api/certificates')
      .then(payload => {
        if (active) {
          setLive(payload);
        }
      })
      .catch(err => {
        if (active) {
          setError(err);
        }
      });
    return () => {
      active = false;
    };
  }, [actions.lastResult]);

  const providersById = useMemo(() => {
    const map = new Map();
    for (const p of doc?.tls?.providers ?? []) {
      map.set(p.id, p);
    }
    return map;
  }, [doc?.tls?.providers]);

  if (!doc) {
    return null;
  }
  const noCerts = doc.tls.certs.length === 0;

  const persist = async nextCerts => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...doc, tls: { ...doc.tls, certs: nextCerts } });
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  // The unified CertEditModal always sends a full doc on save (the ACME
  // path builds it from the cert draft, the BYO path returns an augmented
  // doc with the singleton provider auto-created when needed, the BYO
  // replace path returns the doc with the cert's domains updated to the
  // new SANs). Parent just forwards to onSave + manages modal close + the
  // uploaded-files refresh bump for BYO writes.
  const handleModalSave = async nextDoc => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(nextDoc);
      setShowNew(false);
      setEditing(null);
      setUploadedFilesBump(n => n + 1);
    } catch (err) {
      setSaveError(err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    const { id } = deleting;
    setDeleting(null);
    persist(doc.tls.certs.filter(c => c.id !== id));
  };

  const handleClone = cert => {
    persist([...doc.tls.certs, cloneCertInList(cert, doc.tls.certs)]);
  };

  const isBusy = actions.busy !== null;

  const isByoCert = cert => providersById.get(cert.providerId)?.type === 'byo';

  return (
    <>
      {onSave ? <CertSettingsAccordion doc={doc} onSave={onSave} /> : null}
      <Card className="mb-3">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
            <Card.Title className="mb-0">{t('cert:page.title', 'Certificates')}</Card.Title>
            <ButtonGroup size="sm">
              <Button
                variant="outline-primary"
                onClick={() => setShowNew(true)}
                disabled={saving || !onSave}
              >
                <i className="bi bi-plus-lg me-1" />
                {t('cert:page.addCertificate', 'Add certificate')}
              </Button>
              <Button
                variant="primary"
                onClick={() => actions.renewCerts({ force: false }).catch(() => undefined)}
                disabled={isBusy || noCerts}
              >
                {actions.busy === 'renew' ? (
                  <>
                    <Spinner as="span" animation="border" size="sm" />{' '}
                    {t('cert:page.renewingAll', 'Renewing all…')}
                  </>
                ) : (
                  t('cert:page.renewAll', 'Renew all')
                )}
              </Button>
              <Button
                variant="warning"
                onClick={() => actions.renewCerts({ force: true }).catch(() => undefined)}
                disabled={isBusy || noCerts}
                title={t(
                  'cert:page.forceRenewAllTitle',
                  "Renew all even if existing certs aren't near expiry (--force-renewal)"
                )}
              >
                {t('cert:page.forceRenewAll', 'Force renew all')}
              </Button>
            </ButtonGroup>
          </div>
          <Card.Text className="text-muted small">
            {t(
              'cert:page.description',
              'Adding/editing/deleting certificates changes state but does not by itself issue or revoke anything. Use Renew (per cert or all) to invoke certbot. Renewal can take several minutes per certificate due to DNS propagation.'
            )}
          </Card.Text>
          {error ? (
            <p className="text-danger">
              {t('cert:page.liveStatusUnavailable', 'Live status unavailable: {{message}}', {
                message: error.message,
              })}
            </p>
          ) : null}
          {saveError ? (
            <p className="text-danger">
              {t('cert:page.saveFailed', 'Save failed: {{message}}', {
                message: saveError.message,
              })}
            </p>
          ) : null}
          {actions.error ? (
            <Alert variant="danger">
              {t('cert:page.renewalRequestFailed', 'Renewal request failed: {{message}}', {
                message: actions.error.message,
              })}
            </Alert>
          ) : null}
          {renewalAlert(actions.lastResult, t)}
          <Table striped bordered hover responsive size="sm" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>{t('cert:page.columns.name', 'Name')}</th>
                <th>{t('cert:page.columns.sans', 'SANs')}</th>
                <th>{t('cert:page.columns.provider', 'Provider')}</th>
                <th>{t('cert:page.columns.status', 'Status')}</th>
                <th className="text-end">{t('cert:page.columns.actions', 'Actions')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.tls.certs.map(cert => {
                const liveCert = live?.certs?.find(c => c.id === cert.id);
                const renewBusyKey = `renew-${cert.id}`;
                const renewing = actions.busy === renewBusyKey;
                const isFocused = focusId === cert.id;
                const isByo = isByoCert(cert);
                const unissued = !liveCert?.newest;
                const actionLabel = unissued
                  ? t('cert:page.action.issue', 'Issue')
                  : t('cert:page.action.renew', 'Renew');
                const forceTooltip = unissued
                  ? t(
                      'cert:page.forceIssueTitle',
                      "Force issue {{name}}, ignoring certbot's renewal interval",
                      { name: cert.certName }
                    )
                  : t(
                      'cert:page.forceRenewTitle',
                      "Force renew {{name}}, ignoring certbot's renewal interval",
                      { name: cert.certName }
                    );
                return (
                  <tr
                    key={cert.id}
                    ref={isFocused ? focusedRowRef : null}
                    className={isFocused ? 'table-warning' : undefined}
                  >
                    <td style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <div className="d-flex flex-wrap align-items-center gap-1">
                        <code className="text-break">{cert.certName}</code>
                        {isByoCert(cert) ? (
                          <Badge
                            bg="info"
                            title={t(
                              'cert:page.uploadedTitle',
                              'Uploaded — not managed by certbot'
                            )}
                          >
                            {t('cert:page.uploadedBadge', 'uploaded')}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="text-muted small">
                        {t('cert:page.idLabel', 'id')} <code>{cert.id}</code> ·{' '}
                        {t('cert:page.sanCount', '{{count}} SAN', {
                          count: (cert.domains ?? []).length,
                        })}
                      </div>
                    </td>
                    <td>
                      <SansCell cert={cert} />
                    </td>
                    <td>
                      <ProviderCell
                        providerId={cert.providerId}
                        provider={providersById.get(cert.providerId)}
                      />
                    </td>
                    <td>{statusBadge(liveCert?.newest, t)}</td>
                    <td className="text-end text-nowrap">
                      {!isByo ? (
                        <>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            className="me-1"
                            onClick={() =>
                              actions
                                .renewCert({ certId: cert.id, force: false })
                                .catch(() => undefined)
                            }
                            disabled={isBusy}
                            title={t('cert:page.actionTitle', '{{action}} {{name}}', {
                              action: actionLabel,
                              name: cert.certName,
                            })}
                          >
                            {renewing ? (
                              <Spinner as="span" animation="border" size="sm" />
                            ) : (
                              actionLabel
                            )}
                          </Button>
                          <Button
                            variant="outline-warning"
                            size="sm"
                            className="me-1"
                            onClick={() =>
                              actions
                                .renewCert({ certId: cert.id, force: true })
                                .catch(() => undefined)
                            }
                            disabled={isBusy}
                            title={forceTooltip}
                          >
                            {t('cert:page.action.force', 'Force')}
                          </Button>
                        </>
                      ) : null}
                      <Button
                        variant="outline-secondary"
                        size="sm"
                        className="me-1"
                        onClick={() => setEditing(cert)}
                        disabled={saving || !onSave}
                      >
                        {t('common:buttons.edit', 'Edit')}
                      </Button>
                      {!isByo ? (
                        <Button
                          variant="outline-info"
                          size="sm"
                          className="me-1"
                          onClick={() => handleClone(cert)}
                          disabled={saving || !onSave}
                          title={t(
                            'cert:page.cloneTitle',
                            'Duplicate this certificate entry with a new id/certName. Useful for splitting one cert into per-host certs, or for staging a renewal against a fresh certName. Edit the SAN list before issuing.'
                          )}
                        >
                          {t('cert:page.action.clone', 'Clone')}
                        </Button>
                      ) : null}
                      <Button
                        variant="outline-danger"
                        size="sm"
                        onClick={() => setDeleting(cert)}
                        disabled={saving || !onSave}
                      >
                        {t('common:buttons.delete', 'Delete')}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card.Body>
        {showNew ? (
          <CertEditModal
            show
            doc={doc}
            onSave={handleModalSave}
            onCancel={() => setShowNew(false)}
          />
        ) : null}
        {editing ? (
          <CertEditModal
            show
            cert={editing}
            doc={doc}
            liveCert={live?.certs?.find(c => c.id === editing.id) ?? null}
            onSave={handleModalSave}
            onCancel={() => setEditing(null)}
          />
        ) : null}
        {deleting ? (
          <ConfirmDialog
            show
            title={t('cert:page.confirmDelete.title', 'Delete certificate?')}
            body={
              <>
                {t('cert:page.confirmDelete.prefix', 'Delete')} <strong>{deleting.certName}</strong>{' '}
                {t(
                  'cert:page.confirmDelete.suffix',
                  'from state? The PEM files on disk remain until pruned by the next render pass (or removed manually from the Uploaded files panel below).'
                )}
              </>
            }
            confirmLabel={t('common:buttons.delete', 'Delete')}
            onConfirm={handleDelete}
            onCancel={() => setDeleting(null)}
          />
        ) : null}
      </Card>
      <UploadedFilesPanel doc={doc} refreshSignal={uploadedFilesBump} disabled={!onSave} />
      <EntitySectionCard doc={doc} onSave={onSave} section={CRT_STORES_SECTION} />
    </>
  );
};

CertificatesPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
