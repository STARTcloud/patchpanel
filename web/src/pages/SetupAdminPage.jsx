import { useEffect, useState } from 'react';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { apiGet, apiPost } from '../api/client.js';
import { LogoMark } from '../components/LogoMark.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

// /setup-admin?token=... — first-run wizard for creating the initial
// admin on a fresh standalone install. Postinst prints the setup token in
// the install banner; the operator opens the URL with the token in the
// query string. The page:
//   1. Probes GET /api/setup/status to confirm setup is still available.
//   2. Renders username + password + confirm-password form.
//   3. POSTs /api/setup/complete with { token, username, password }.
//   4. Server creates the admin, consumes the token, sets the cookie.
//   5. We refresh useAuth and navigate to /.

export const SetupAdminPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState({ loading: true, needsSetup: false, hasToken: false });
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    apiGet('api/setup/status')
      .then(data =>
        setStatus({
          loading: false,
          needsSetup: Boolean(data?.needsSetup),
          hasToken: Boolean(data?.hasToken),
        })
      )
      .catch(() => setStatus({ loading: false, needsSetup: false, hasToken: false }));
  }, []);

  if (!auth.loading && auth.authenticated) {
    return <Navigate to="/" replace />;
  }

  if (status.loading) {
    return (
      <Container
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: '100vh' }}
      >
        <Spinner animation="border" />
      </Container>
    );
  }

  if (!status.needsSetup) {
    return (
      <Container
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: '100vh' }}
      >
        <Card style={{ maxWidth: 500 }}>
          <Card.Body>
            <Card.Title>Setup already complete</Card.Title>
            <p className="text-muted small mb-3">
              {status.hasToken
                ? 'A setup token exists but at least one user is already registered.'
                : 'The setup token has been consumed. If you need to recover access, use the `patchpanel user-add` or `patchpanel user-reset` CLI on the host.'}
            </p>
            <Button variant="primary" onClick={() => navigate('/login', { replace: true })}>
              Go to login
            </Button>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  const submit = async event => {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError('passwords do not match');
      return;
    }
    const token = params.get('token');
    if (!token) {
      setError('missing ?token= in the URL — re-open the link from the install banner');
      return;
    }
    setSubmitting(true);
    try {
      await apiPost('api/setup/complete', { token, username, password });
      await auth.refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'setup failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh' }}
    >
      <Card style={{ maxWidth: 480, width: '100%' }}>
        <Card.Body>
          <div className="d-flex flex-column align-items-center gap-2 mb-3">
            <LogoMark size={48} title="patchpanel" />
            <h4 className="mb-0">Welcome to patchpanel</h4>
            <small className="text-muted">Create the first admin account</small>
          </div>
          <Alert variant="info" className="py-2 small mb-3">
            This wizard runs once on first install. The setup token from the install banner is in
            the URL — submitting this form consumes it.
          </Alert>
          {error ? (
            <Alert variant="danger" className="py-2 small mb-3">
              {error}
            </Alert>
          ) : null}
          <Form onSubmit={submit}>
            <Form.Group className="mb-3">
              <Form.Label>Username</Form.Label>
              <Form.Control
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                pattern="[a-z][a-z0-9._-]{1,31}"
                autoComplete="username"
                required
              />
              <Form.Text className="text-muted">
                Lowercase letters/digits/dot/underscore/hyphen, starting with a letter (2-32 chars).
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <Form.Text className="text-muted">At least 8 characters.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Confirm password</Form.Label>
              <Form.Control
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </Form.Group>
            <Button type="submit" variant="primary" className="w-100" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Creating admin…
                </>
              ) : (
                'Create admin and sign in'
              )}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};
