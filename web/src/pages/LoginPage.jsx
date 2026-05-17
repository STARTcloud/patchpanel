import { useEffect, useState } from 'react';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { apiGet } from '../api/client.js';
import { LogoMark } from '../components/LogoMark.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

// /login — basic username + password form. Posts to /api/auth/login,
// which sets the session cookie. On success, redirect to ?return= or /.
//
// Already-authenticated users get bounced to / (refresh leftovers, or
// landing here directly via a stale browser tab).
//
// On a fresh standalone install, /api/setup/status reports needsSetup=true
// until the first admin is created. In that state nobody can log in, so we
// redirect to /setup-admin instead of showing the form. Render is held
// until the probe resolves to avoid a momentary flash of the login form.

export const LoginPage = () => {
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [setupProbe, setSetupProbe] = useState({ done: false, needsSetup: false });

  useEffect(() => {
    apiGet('api/setup/status')
      .then(data => setSetupProbe({ done: true, needsSetup: Boolean(data?.needsSetup) }))
      .catch(() => setSetupProbe({ done: true, needsSetup: false }));
  }, []);

  if (auth.loading || !setupProbe.done) {
    return (
      <Container
        className="d-flex align-items-center justify-content-center"
        style={{ minHeight: '100vh' }}
      >
        <Spinner animation="border" />
      </Container>
    );
  }

  if (auth.authenticated) {
    const ret = params.get('return');
    return <Navigate to={ret || '/'} replace />;
  }

  if (setupProbe.needsSetup) {
    return <Navigate to="/setup-admin" replace />;
  }

  const submit = async event => {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await auth.login(username, password);
      const ret = params.get('return');
      navigate(ret || '/', { replace: true });
    } catch (err) {
      setError(err.payload?.message ?? err.message ?? 'login failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh' }}
    >
      <Card style={{ maxWidth: 400, width: '100%' }}>
        <Card.Body>
          <div className="d-flex flex-column align-items-center gap-2 mb-3">
            <LogoMark size={48} title="patchpanel" />
            <h4 className="mb-0">patchpanel</h4>
            <small className="text-muted">Sign in</small>
          </div>
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
                autoComplete="username"
                required
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Password</Form.Label>
              <Form.Control
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </Form.Group>
            <Button type="submit" variant="primary" className="w-100" disabled={submitting}>
              {submitting ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};
