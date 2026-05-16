import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, OverlayTrigger, Table, Tooltip } from 'react-bootstrap';

import { apiDelete } from '../api/client.js';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

import { TrustedCRLUploadModal } from './TrustedCRLUploadModal.jsx';

// Count usages of a trusted CRL on any bind's crlTrustedCrlId. CRLs aren't
// referenced from server lines (HAProxy doesn't expose crl-file there) so
// we only walk frontend binds. Returned as a count to gate the Delete
// button — if anything still references the entry, we refuse on the client
// and the server-side state validation would refuse too on next save.
const countTrustedCrlUsage = (doc, id) => {
  let binds = 0;
  for (const fe of doc.frontends ?? []) {
    for (const bind of fe.binds ?? []) {
      if (bind.ssl?.crlTrustedCrlId === id) {
        binds += 1;
      }
    }
  }
  return binds;
};

const FingerprintCell = ({ fingerprint }) => {
  if (!fingerprint) {
    return <span className="text-muted small">—</span>;
  }
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

export const TrustedCRLsCard = ({ doc, onSave }) => {
  const [showUpload, setShowUpload] = useState(false);
  const [error, setError] = useState(null);
  const trustedCrls = doc.trustedCrls ?? [];

  const persist = async nextTrustedCrls => {
    setError(null);
    try {
      await onSave({ ...doc, trustedCrls: nextTrustedCrls });
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

  const handleDelete = async crl => {
    const usage = countTrustedCrlUsage(doc, crl.id);
    if (usage > 0) {
      setError(new Error(`Cannot delete: still referenced by ${usage} bind(s)`));
      return;
    }
    try {
      await apiDelete(`api/trusted-crls/${encodeURIComponent(crl.id)}`);
    } catch (err) {
      setError(err);
    }
    persist(trustedCrls.filter(t => t.id !== crl.id));
  };

  return (
    <>
      <div className="d-flex justify-content-between align-items-start mb-2 flex-wrap gap-2">
        <div>
          <h6 className="mb-0">Trusted CRLs</h6>
          <p className="text-muted small mb-0">
            X.509 Certificate Revocation Lists. Referenced from frontend bind <code>crl-file</code>{' '}
            when doing mTLS client cert validation — HAProxy uses the CRL to reject revoked client
            certs at the TLS handshake.
          </p>
        </div>
        <Button
          variant="outline-primary"
          size="sm"
          onClick={() => setShowUpload(true)}
          disabled={!onSave}
        >
          <i className="bi bi-cloud-upload me-1" />
          Upload CRL
        </Button>
      </div>
      {error ? (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error.message}
        </Alert>
      ) : null}
      {trustedCrls.length === 0 ? (
        <Alert variant="info" className="small mb-0">
          No trusted CRLs uploaded yet. Upload one to gate mTLS access via revocation status.
        </Alert>
      ) : (
        <Table size="sm" responsive className="mb-0">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Fingerprint</th>
              <th>Used by</th>
              <th className="text-end">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trustedCrls.map(crl => {
              const usage = countTrustedCrlUsage(doc, crl.id);
              return (
                <tr key={crl.id}>
                  <td>
                    <code>{crl.id}</code>
                  </td>
                  <td>
                    <div>{crl.name}</div>
                    {crl.description ? (
                      <div className="text-muted small">{crl.description}</div>
                    ) : null}
                  </td>
                  <td>
                    <FingerprintCell fingerprint={crl.fingerprint} />
                  </td>
                  <td>
                    <Badge bg={usage > 0 ? 'info' : 'secondary'}>{usage} bind</Badge>
                  </td>
                  <td className="text-end text-nowrap">
                    <Button
                      variant="outline-danger"
                      size="sm"
                      onClick={() => handleDelete(crl)}
                      disabled={!onSave || usage > 0}
                      title={usage > 0 ? `Still referenced by ${usage} bind(s)` : 'Delete'}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {showUpload ? (
        <TrustedCRLUploadModal
          show
          doc={doc}
          onUploaded={handleUploaded}
          onCancel={() => setShowUpload(false)}
        />
      ) : null}
    </>
  );
};

TrustedCRLsCard.propTypes = {
  doc: stateDocShape.isRequired,
  onSave: onSavePropType.isRequired,
};
