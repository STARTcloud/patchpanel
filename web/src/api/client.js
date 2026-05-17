export const buildUrl = path => {
  const base = document.baseURI;
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return new URL(clean, base).toString();
};

// Public paths that should NOT trigger an auto-redirect on 401 — these
// are the auth endpoints themselves (the SPA polls /whoami to probe the
// session state; a 401 there is just "no session," not "go to login").
const NO_REDIRECT_PATHS = new Set([
  'api/auth/whoami',
  'api/auth/login',
  'api/setup/status',
  'api/setup/complete',
]);

const handleUnauthorized = path => {
  const clean = path.startsWith('/') ? path.slice(1) : path;
  if (NO_REDIRECT_PATHS.has(clean)) {
    return;
  }
  // 401 on a protected endpoint while the SPA is open → session expired
  // or got revoked. Send the user to /login with a return path so they
  // land back where they were after re-authenticating.
  const ret = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.replace(buildUrl(`login?return=${ret}`));
};

const request = async (method, path, body) => {
  const init = {
    method,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const response = await fetch(buildUrl(path), init);
  if (response.status === 204) {
    return null;
  }
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();
  if (!response.ok) {
    if (response.status === 401) {
      handleUnauthorized(path);
    }
    const error = new Error(payload?.message ?? `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
};

export const apiGet = path => request('GET', path);
export const apiPut = (path, body) => request('PUT', path, body);
export const apiPost = (path, body) => request('POST', path, body);
export const apiDelete = path => request('DELETE', path);
