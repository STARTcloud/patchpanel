import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, OverlayTrigger, Table, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { apiDelete } from '../api/client.js';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

import { TrustedCAUploadModal } from './TrustedCAUploadModal.jsx';

// Count usages of a trusted CA across binds and backends. Returned as a
// breakdown so the UI can explain "in use by 2 binds + 1 server" instead of
// just "in use by 3". This is what gates Delete — if anything still
// references the entry, we refuse on the client and the server-side state
// validation would refuse too on next save.
const countTrustedCaUsage = (doc, id) => {
  let binds = 0;
  let servers = 0;
  for (const fe of doc.frontends ?? []) {
    for (const bind of fe.binds ?? []) {
      const ssl = bind.ssl ?? {};
      if (ssl.caTrustedCaId === id) {
        binds += 1;
      }
      if (ssl.caVerifyTrustedCaId === id) {
        binds += 1;
      }
    }
  }
  for (const backend of doc.backends ?? []) {
    for (const server of backend.servers ?? []) {
      if (server.caTrustedCaId === id) {
        servers += 1;
      }
    }
  }
  return { binds, servers, total: binds + servers };
};

const expiryBadge = (notAfter, t) => {
  if (!notAfter) {
    return null;
  }
  const days = Math.round((new Date(notAfter).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) {
    return <Badge bg="danger">{t('cert:trustedCa.list.expired', 'expired')}</Badge>;
  }
  if (days < 30) {
    return (
      <Badge bg="warning" text="dark">
        {t('cert:trustedCa.list.daysShort', '{{days}}d', { days })}
      </Badge>
    );
  }
  return <Badge bg="success">{t('cert:trustedCa.list.daysShort', '{{days}}d', { days })}</Badge>;
};

const FingerprintCell = ({ fingerprint }) => {
  if (!fingerprint) {
    return <span className="text-muted small">—</span>;
  }
  // Show first + last 4 hex bytes; users can hover for the full SHA-256.
  const short = `${fingerprint.slice(0, 11)}…${fingerprint.slice(-11)}`;
  return (
    <OverlayTrigger
      placement="top"
      overlay={<Tooltip>{fingerprint}</Tooltip>}
      delay={{ show: 200, hide: 0 }}
    >
      <code className="small">{short}</code>
    </OverlayTrigger>
  );
};

FingerprintCell.propTypes = {
  fingerprint: PropTypes.string,
};

export const TrustedCAsCard = ({ doc, onSave }) => {
  const { t } = useTranslation(['cert', 'common']);
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState(null);
  const trustedCas = doc.trustedCas ?? [];

  const persist = async nextTrustedCas => {
    setError(null);
    try {
      await onSave({ ...doc, trustedCas: nextTrustedCas });
    } catch (err) {
      setError(err);
    }
  };

  const handleUploaded = async nextDoc => {
    setShowUpload(false);
    try {
      await onSave(nextDoc);
    } catch (err) {
      setError(err);
    }
  };

  const handleDelete = async ca => {
    const usage = countTrustedCaUsage(doc, ca.id);
    if (usage.total > 0) {
      setError(
        new Error(
          t(
            'cert:trustedCa.list.cannotDelete',
            'Cannot delete: still referenced by {{binds}} bind(s) and {{servers}} server(s)',
            { binds: usage.binds, servers: usage.servers }
          )
        )
      );
      return;
    }
    try {
      await apiDelete(`api/trusted-cas/${encodeURIComponent(ca.id)}`);
    } catch (err) {
      // Even if disk delete fails, still try to remove from state — the
      // file may already be gone, and an orphan state entry is worse than
      // a stray file. Surface the warning, don't block.
      setError(err);
    }
    persist(trustedCas.filter(other => other.id !== ca.id));
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
        <div>
          <h6 className="mb-0">{t('cert:trustedCa.list.title', 'Trusted CAs')}</h6>
          <p className="text-muted small mb-0">
            {t(
              'cert:trustedCa.list.descPrefix',
              'CA bundles used by HAProxy to verify peer certificates. Referenced from frontend bind'
            )}{' '}
            <code>ca-file</code> / <code>ca-verify-file</code>{' '}
            {t('cert:trustedCa.list.descMiddle', '(mTLS client auth) and backend')}{' '}
            <code>server</code>{' '}
            {t('cert:trustedCa.list.descSuffix', 'lines (upstream TLS verification).')}
          </p>
        </div>
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => setShowUpload(true)}
          disabled={!onSave}
        >
          <i className="bi bi-cloud-upload me-1" />
          {t('cert:trustedCa.list.upload', 'Upload CA bundle')}
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error.message}
        </Alert>
      ) : null}
      {trustedCas.length === 0 ? (
        <Alert variant="info" className="small mb-0">
          {t(
            'cert:trustedCa.list.empty',
            'No trusted CAs uploaded yet. Add one to enable mTLS client validation on binds or upstream TLS verification on backend servers.'
          )}
        </Alert>
      ) : (
        <Table size="sm" responsive className="mb-0">
          <thead>
            <tr>
              <th>{t('cert:trustedCa.list.columns.id', 'ID')}</th>
              <th>{t('cert:trustedCa.list.columns.name', 'Name')}</th>
              <th>{t('cert:trustedCa.list.columns.subject', 'Subject')}</th>
              <th>{t('cert:trustedCa.list.columns.fingerprint', 'Fingerprint')}</th>
              <th>{t('cert:trustedCa.list.columns.expires', 'Expires')}</th>
              <th>{t('cert:trustedCa.list.columns.usedBy', 'Used by')}</th>
              <th className="text-end">{t('cert:trustedCa.list.columns.actions', 'Actions')}</th>
            </tr>
          </thead>
          <tbody>
            {trustedCas.map(ca => {
              const usage = countTrustedCaUsage(doc, ca.id);
              return (
                <tr key={ca.id}>
                  <td>
                    <code>{ca.id}</code>
                  </td>
                  <td>
                    <div>{ca.name}</div>
                    {ca.description ? (
                      <div className="text-muted small">{ca.description}</div>
                    ) : null}
                  </td>
                  <td className="small text-muted" style={{ maxWidth: '14rem' }}>
                    {ca.subjectSummary ?? '—'}
                    {ca.certCount && ca.certCount > 1 ? (
                      <Badge bg="secondary" className="ms-2">
                        {t('cert:trustedCa.list.chainCount', 'chain ×{{count}}', {
                          count: ca.certCount,
                        })}
                      </Badge>
                    ) : null}
                  </td>
                  <td>
                    <FingerprintCell fingerprint={ca.fingerprint} />
                  </td>
                  <td>{expiryBadge(ca.notAfter, t)}</td>
                  <td>
                    <Badge bg={usage.total > 0 ? 'info' : 'secondary'}>
                      {t('cert:trustedCa.list.usageBadge', '{{binds}} bind · {{servers}} server', {
                        binds: usage.binds,
                        servers: usage.servers,
                      })}
                    </Badge>
                  </td>
                  <td className="text-end text-nowrap">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDelete(ca)}
                      disabled={!onSave || usage.total > 0}
                      title={
                        usage.total > 0
                          ? t(
                              'cert:trustedCa.list.stillReferencedTitle',
                              'Still referenced by {{binds}} bind(s) and {{servers}} server(s)',
                              { binds: usage.binds, servers: usage.servers }
                            )
                          : t('common:buttons.delete', 'Delete')
                      }
                    >
                      {t('common:buttons.delete', 'Delete')}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {showUpload ? (
        <TrustedCAUploadModal
          show
          doc={doc}
          onUploaded={handleUploaded}
          onCancel={() => setShowUpload(false)}
        />
      ) : null}
    </>
  );
};

TrustedCAsCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
