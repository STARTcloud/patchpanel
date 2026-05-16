const buildUrl = path => {
  const base = document.baseURI;
  const clean = path.startsWith('/') ? path.slice(1) : path;
  return new URL(clean, base).toString();
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
