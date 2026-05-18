import { useState } from 'react';
import { Alert, Badge, Button, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { OnboardingWizard } from '../components/OnboardingWizard.jsx';
import { onSavePropType, stateDocShape } from '../prop-shapes.js';

export const isFreshInstall = doc =>
  Boolean(
    doc &&
    (doc.frontends ?? []).length === 0 &&
    (doc.backends ?? []).length === 0 &&
    (doc.defaultsBlocks ?? []).length === 0 &&
    (doc.acls ?? []).length === 0 &&
    (doc.tls?.providers ?? []).length === 0 &&
    (doc.tls?.certs ?? []).length === 0
  );

export const SetupPage = ({ doc = null, onSave = null }) => {
  const { t } = useTranslation(['auth', 'common']);
  const [show, setShow] = useState(false);

  if (!doc) {
    return null;
  }

  const fresh = isFreshInstall(doc);

  const close = () => setShow(false);
  // Wizard performs a multi-step save (state PUT → optional credentials PUT →
  // state PUT again with credentialsRef). Return the persisted doc so the
  // wizard can chain off it, and let the wizard close itself via onCancel
  // after the whole sequence succeeds.
  const complete = next => {
    if (!onSave) {
      return null;
    }
    return onSave(next);
  };

  if (!fresh) {
    return (
      <Card>
        <Card.Body>
          <Card.Title className="mb-1">
            <i className="bi bi-check2-circle me-2 text-success" />
            {t('auth:setupPage.title', 'Setup')}
          </Card.Title>
          <Card.Text className="text-muted small mb-0">
            {t('auth:setupPage.subtitle', 'Onboarding for new installs.')}
          </Card.Text>
        </Card.Body>
      </Card>
    );
  }

  return (
    <>
      <Card border="primary">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap mb-3">
            <div>
              <Card.Title className="mb-1">
                <i className="bi bi-stars me-2 text-primary" />
                {t('auth:setupPage.title', 'Setup')}
              </Card.Title>
              <Card.Text className="text-muted small mb-0">
                {t('auth:setupPage.subtitle', 'Onboarding for new installs.')}
              </Card.Text>
            </div>
            <Badge bg="warning" text="dark">
              <i className="bi bi-exclamation-circle me-1" />
              {t(
                'auth:setupPage.freshInstallBadge',
                'Fresh install — no defaults, frontends, ACLs, backends, or certs yet'
              )}
            </Badge>
          </div>
          <Alert variant="primary" className="py-2 small mb-3">
            {t(
              'auth:setupPage.emptyAlert',
              "patchpanel is still empty. The wizard collects a Let's Encrypt account, the first defaults block, frontend, ACL + use-backend rule, backend, and covering certificate — enough to render a valid haproxy.cfg."
            )}
          </Alert>
          <Button variant="primary" onClick={() => setShow(true)} disabled={!onSave}>
            {t('auth:setupPage.runWizard', 'Run setup wizard')}
          </Button>
        </Card.Body>
      </Card>
      {show ? <OnboardingWizard show doc={doc} onComplete={complete} onCancel={close} /> : null}
    </>
  );
};

SetupPage.propTypes = {
  doc: stateDocShape,
  onSave: onSavePropType,
};
