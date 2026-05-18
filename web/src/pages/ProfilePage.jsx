import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

import { ApiTokensManager } from '../components/ApiTokensManager.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

const ChangePasswordCard = ({ changePassword }) => {
  const { t } = useTranslation(['auth', 'common']);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const submit = async event => {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    if (next !== confirm) {
      setError(t('auth:changePassword.mismatch', 'new passwords do not match'));
      return;
    }
    setSubmitting(true);
    try {
      await changePassword(current, next);
      setSuccess(true);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (err) {
      setError(
        err.payload?.message ?? err.message ?? t('auth:changePassword.failed', 'change failed')
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          <i className="bi bi-shield-lock me-2" />
          {t('auth:changePassword.title')}
        </Card.Title>
        {error ? (
          <Alert variant="danger" className="py-2 small mb-3">
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert variant="success" className="py-2 small mb-3">
            {t(
              'auth:changePassword.successMessage',
              'Password updated. Other sessions for this user have been invalidated.'
            )}
          </Alert>
        ) : null}
        <Form onSubmit={submit}>
          <Form.Group className="mb-3">
            <Form.Label>{t('auth:changePassword.current')}</Form.Label>
            <Form.Control
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>{t('auth:changePassword.new')}</Form.Label>
            <Form.Control
              type="password"
              value={next}
              onChange={e => setNext(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>{t('auth:changePassword.confirm')}</Form.Label>
            <Form.Control
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </Form.Group>
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                {t('auth:changePassword.updating', 'Updating…')}
              </>
            ) : (
              t('auth:changePassword.updateSubmit', 'Update password')
            )}
          </Button>
        </Form>
      </Card.Body>
    </Card>
  );
};

ChangePasswordCard.propTypes = {
  changePassword: PropTypes.func.isRequired,
};

export const ProfilePage = () => {
  const { t } = useTranslation(['auth', 'common']);
  const auth = useAuth();

  if (!auth.user) {
    return null;
  }

  const isIngress = auth.source === 'ingress';

  return (
    <div className="d-flex flex-column gap-3">
      <Card>
        <Card.Body>
          <Card.Title>
            <i className="bi bi-person-circle me-2" />
            {t('auth:profile.title', 'Profile')}
          </Card.Title>
          <Row className="g-2">
            <Col sm={4} className="text-muted">
              {t('auth:user.username')}
            </Col>
            <Col sm={8}>
              <code>{auth.user.username}</code>
            </Col>
            <Col sm={4} className="text-muted">
              {t('auth:user.role')}
            </Col>
            <Col sm={8}>
              <Badge bg="primary">{auth.user.role}</Badge>
            </Col>
            <Col sm={4} className="text-muted">
              {t('auth:profile.sessionSource', 'Session source')}
            </Col>
            <Col sm={8}>
              <Badge bg={isIngress ? 'info' : 'success'}>{auth.source}</Badge>{' '}
              {isIngress ? (
                <span className="text-muted small">
                  {t(
                    'auth:profile.ingressNote',
                    'Authenticated upstream by Home Assistant ingress — local password change and logout are not available in this mode.'
                  )}
                </span>
              ) : null}
            </Col>
          </Row>
        </Card.Body>
      </Card>
      {!isIngress ? <ChangePasswordCard changePassword={auth.changePassword} /> : null}
      <ApiTokensManager />
    </div>
  );
};
