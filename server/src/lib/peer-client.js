// HTTPS client for peer-to-peer API calls. Uses the existing fetch API +
// the peer's outbound token from peers.json. Cert verification follows the
// node-level NODE_TLS_REJECT_UNAUTHORIZED / undici dispatcher policy.
//
// Errors thrown carry .status (HTTP status code) and .body when available.

const DEFAULT_TIMEOUT_MS = 15_000;

class PeerApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'PeerApiError';
    this.status = status ?? null;
    this.body = body ?? null;
  }
}

const buildUrl = (baseUrl, path) => {
  const base = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  const trimmed = path.startsWith('/') ? path : `/${path}`;
  return `${base}${trimmed}`;
};

const callJson = async ({ method, baseUrl, path, token, body, timeoutMs }) => {
  const url = buildUrl(baseUrl, path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const init = {
      method,
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    };
    if (body !== undefined) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetch(url, init);
    const text = await response.text();
    let payload = null;
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }
    if (!response.ok) {
      throw new PeerApiError(
        typeof payload === 'object' && payload?.error
          ? payload.error
          : `peer responded with HTTP ${response.status}`,
        { status: response.status, body: payload }
      );
    }
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new PeerApiError(`peer call timed out after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`, {});
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// Public methods — one per peer endpoint we call. Each returns the same
// Promise that callJson produces; no body await is needed at this layer.

export const pushState = ({ baseUrl, token, bundle, timeoutMs }) =>
  callJson({
    method: 'POST',
    baseUrl,
    path: '/api/peer/state',
    token,
    body: bundle,
    timeoutMs: timeoutMs ?? 60_000,
  });

export const getStateChecksum = ({ baseUrl, token, timeoutMs }) =>
  callJson({ method: 'GET', baseUrl, path: '/api/peer/state-checksum', token, timeoutMs });

export const getClock = ({ baseUrl, token, timeoutMs }) =>
  callJson({ method: 'GET', baseUrl, path: '/api/peer/clock', token, timeoutMs });

export const pushBlob = ({ baseUrl, token, kind, id, payload, timeoutMs }) =>
  callJson({
    method: 'POST',
    baseUrl,
    path: `/api/peer/blob/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    token,
    body: payload,
    timeoutMs: timeoutMs ?? 60_000,
  });

export const getBlob = ({ baseUrl, token, kind, id, timeoutMs }) =>
  callJson({
    method: 'GET',
    baseUrl,
    path: `/api/peer/blob/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`,
    token,
    timeoutMs,
  });

export { PeerApiError };
