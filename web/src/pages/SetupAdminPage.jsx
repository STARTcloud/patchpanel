import { useEffect, useState } from 'react';
import { Alert, Button, Card, Container, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useSearchParams } from 'react-router';

import { apiGet, apiPost } from '../api/client.js';
import { LogoMark } from '../components/LogoMark.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

// /setup-admin — first-run wizard for creating the initial admin on a
// fresh standalone install. Postinst writes /etc/patchpanel/setup.token
// and prints a banner URL with `?token=...`. Two entry paths are supported:
//   a) operator clicks the banner URL → token prefilled from the query string
//   b) operator just navigates to the host → token field is empty, they
//      paste the value from /etc/patchpanel/setup.token themselves
//
// The page:
//   1. Probes GET /api/setup/status to confirm setup is still available.
//   2. Renders token + username + password + confirm-password form.
//   3. POSTs /api/setup/complete with { token, username, password }.
//   4. Server creates the admin, consumes the token, sets the cookie.
//   5. We refresh useAuth and navigate to /.

export const SetupAdminPage = () => {
  const { t } = useTranslation(['auth', 'common']);
  const auth = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [status, setStatus] = useState({ loading: true, needsSetup: false, hasToken: false });
  const [token, setToken] = useState(params.get('token') ?? '');
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
            <Card.Title>
              {t('auth:setupAdmin.alreadyCompleteTitle', 'Setup already complete')}
            </Card.Title>
            <p className="text-muted small mb-3">
              {status.hasToken
                ? t(
                    'auth:setupAdmin.tokenExistsUserRegistered',
                    'A setup token exists but at least one user is already registered.'
                  )
                : t(
                    'auth:setupAdmin.tokenConsumed',
                    'The setup token has been consumed. If you need to recover access, use the `patchpanel user-add` or `patchpanel user-reset` CLI on the host.'
                  )}
            </p>
            <Button variant="primary" onClick={() => navigate('/login', { replace: true })}>
              {t('auth:setupAdmin.goToLogin', 'Go to login')}
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
      setError(t('auth:setupAdmin.passwordMismatch', 'passwords do not match'));
      return;
    }
    setSubmitting(true);
    try {
      await apiPost('api/setup/complete', { token: token.trim(), username, password });
      await auth.refresh();
      navigate('/', { replace: true });
    } catch (err) {
      setError(
        err.payload?.message ?? err.message ?? t('auth:setupAdmin.setupFailed', 'setup failed')
      );
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
            <h4 className="mb-0">{t('auth:setupAdmin.welcomeTitle', 'Welcome to patchpanel')}</h4>
            <small className="text-muted">
              {t('auth:setupAdmin.welcomeSubtitle', 'Create the first admin account')}
            </small>
          </div>
          <Alert variant="info" className="py-2 small mb-3">
            {t(
              'auth:setupAdmin.tokenInstructionsPrefix',
              'Paste the one-time setup token from the install banner, or read it off the host with'
            )}{' '}
            <code>cat /etc/patchpanel/setup.token</code>.{' '}
            {t(
              'auth:setupAdmin.tokenInstructionsSuffix',
              'The token is consumed on success and the file is deleted.'
            )}
          </Alert>
          {error ? (
            <Alert variant="danger" className="py-2 small mb-3">
              {error}
            </Alert>
          ) : null}
          <Form onSubmit={submit}>
            <Form.Group className="mb-3">
              <Form.Label>{t('auth:setup.tokenLabel')}</Form.Label>
              <Form.Control
                type="text"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder={t('auth:setupAdmin.tokenPlaceholder', '64 hex characters')}
                required
                style={{ fontFamily: 'monospace' }}
              />
              <Form.Text className="text-muted">
                {t(
                  'auth:setupAdmin.tokenHelp',
                  'Prefilled when you opened this page from the banner URL; paste it manually otherwise.'
                )}
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('auth:login.username')}</Form.Label>
              <Form.Control
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                pattern="[a-z][a-z0-9._-]{1,31}"
                autoComplete="username"
                required
              />
              <Form.Text className="text-muted">
                {t(
                  'auth:setupAdmin.usernameHelp',
                  'Lowercase letters/digits/dot/underscore/hyphen, starting with a letter (2-32 chars).'
                )}
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('auth:login.password')}</Form.Label>
              <Form.Control
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
              <Form.Text className="text-muted">
                {t('auth:setupAdmin.passwordHelp', 'At least 8 characters.')}
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>{t('auth:setupAdmin.confirmPassword', 'Confirm password')}</Form.Label>
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
                  {t('auth:setupAdmin.creatingAdmin', 'Creating admin…')}
                </>
              ) : (
                t('auth:setupAdmin.createAdminSubmit', 'Create admin and sign in')
              )}
            </Button>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};
