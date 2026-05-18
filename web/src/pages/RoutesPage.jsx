import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Card, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { deriveRouteRows, RouteWizard } from '../components/RouteWizard.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const RoutesPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['haproxy', 'common']);
  const [showWizard, setShowWizard] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const rows = useMemo(() => (doc ? deriveRouteRows(doc) : []), [doc]);

  if (!doc) {
    return null;
  }

  const handleComplete = async nextDoc => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(nextDoc);
      setShowWizard(false);
    } catch (err) {
      setSaveError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <div className="d-flex justify-content-between align-items-start mb-3 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-1">{t('haproxy:route.page.title', 'Routes')}</Card.Title>
            <Card.Text className="text-muted small mb-0">
              <strong>{t('haproxy:route.page.lensView', 'Lens view.')}</strong>{' '}
              {t(
                'haproxy:route.page.description1',
                'A "route" here is a pair: an hdr(host) ACL + an http-request use-backend rule that references it. Use + New route to create both via a wizard. Edits to the underlying ACL or Rule happen on the'
              )}{' '}
              <Link to="/acls">{t('haproxy:route.page.aclsLink', 'ACLs')}</Link>{' '}
              {t('haproxy:common.and', 'and')}{' '}
              <Link to="/rules">{t('haproxy:route.page.rulesLink', 'Rules')}</Link>{' '}
              {t('haproxy:route.page.pages', 'pages.')}
            </Card.Text>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowWizard(true)}
            disabled={saving || !onSave}
          >
            <i className="bi bi-plus-lg me-1" />
            {t('haproxy:route.new', 'New route')}
          </Button>
        </div>
        {saveError ? (
          <Alert variant="danger" onClose={() => setSaveError(null)} dismissible>
            {t('haproxy:common.saveFailed', 'Save failed')}: {saveError.message}
          </Alert>
        ) : null}
        {rows.length === 0 ? (
          <Alert variant="info" className="small mb-0">
            {t(
              'haproxy:route.empty',
              'No routes derived. Either no use-backend rules exist yet, or no host-matching ACLs are referenced by any rule. Click + New route to create the first pair, or build the primitives directly from the ACLs and Rules pages.'
            )}
          </Alert>
        ) : (
          <Table striped bordered hover responsive size="sm">
            <thead>
              <tr>
                <th>{t('haproxy:route.columns.frontend', 'Frontend')}</th>
                <th>{t('haproxy:route.columns.hostnames', 'Hostnames')}</th>
                <th>{t('haproxy:route.columns.backend', 'Backend')}</th>
                <th>{t('haproxy:route.columns.acls', 'ACL(s)')}</th>
                <th>{t('haproxy:route.columns.rule', 'Rule')}</th>
                <th>{t('haproxy:route.columns.status', 'Status')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.rowKey}>
                  <td>
                    <Link to="/frontends">
                      <code>{row.frontendName}</code>
                    </Link>
                  </td>
                  <td>
                    {row.hostnames.map(h => (
                      <a
                        key={h}
                        href={`https://${h}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-decoration-none d-block small"
                        title={t(
                          'haproxy:route.openInNewTab',
                          'Open https://{{host}}/ in a new tab',
                          {
                            host: h,
                          }
                        )}
                      >
                        {h}
                        <i className="bi bi-box-arrow-up-right ms-1 small text-muted" />
                      </a>
                    ))}
                  </td>
                  <td>
                    <Link to={`/backends?focus=${encodeURIComponent(row.backendId)}`}>
                      <code>{row.backendId}</code>
                    </Link>
                  </td>
                  <td>
                    {row.aclNames.map(name => (
                      <Link key={name} to="/acls" className="text-decoration-none d-block small">
                        <code>{name}</code>
                      </Link>
                    ))}
                  </td>
                  <td>
                    <Link to="/rules" className="text-decoration-none">
                      <code className="small">{row.ruleLabel}</code>
                    </Link>
                  </td>
                  <td className="text-center">
                    {row.enabled ? (
                      <Badge bg="success">{t('haproxy:route.status.enabled', 'enabled')}</Badge>
                    ) : (
                      <Badge bg="secondary">{t('haproxy:route.status.disabled', 'disabled')}</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card.Body>
      {showWizard ? (
        <RouteWizard
          show
          doc={doc}
          onComplete={handleComplete}
          onCancel={() => setShowWizard(false)}
        />
      ) : null}
    </Card>
  );
};

RoutesPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
