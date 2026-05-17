import PropTypes from 'prop-types';
import { useState } from 'react';
import { Alert, Badge, Button, Card, Col, Form, Row, Spinner } from 'react-bootstrap';

import { ApiTokensManager } from '../components/ApiTokensManager.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

const ChangePasswordCard = ({ changePassword }) => {
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
      setError('new passwords do not match');
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
      setError(err.payload?.message ?? err.message ?? 'change failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <Card.Body>
        <Card.Title>
          <i className="bi bi-shield-lock me-2" />
          Change password
        </Card.Title>
        {error ? (
          <Alert variant="danger" className="py-2 small mb-3">
            {error}
          </Alert>
        ) : null}
        {success ? (
          <Alert variant="success" className="py-2 small mb-3">
            Password updated. Other sessions for this user have been invalidated.
          </Alert>
        ) : null}
        <Form onSubmit={submit}>
          <Form.Group className="mb-3">
            <Form.Label>Current password</Form.Label>
            <Form.Control
              type="password"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label>New password</Form.Label>
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
            <Form.Label>Confirm new password</Form.Label>
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
                Updating…
              </>
            ) : (
              'Update password'
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
            Profile
          </Card.Title>
          <Row className="g-2">
            <Col sm={4} className="text-muted">
              Username
            </Col>
            <Col sm={8}>
              <code>{auth.user.username}</code>
            </Col>
            <Col sm={4} className="text-muted">
              Role
            </Col>
            <Col sm={8}>
              <Badge bg="primary">{auth.user.role}</Badge>
            </Col>
            <Col sm={4} className="text-muted">
              Session source
            </Col>
            <Col sm={8}>
              <Badge bg={isIngress ? 'info' : 'success'}>{auth.source}</Badge>{' '}
              {isIngress ? (
                <span className="text-muted small">
                  Authenticated upstream by Home Assistant ingress — local password change and
                  logout are not available in this mode.
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
