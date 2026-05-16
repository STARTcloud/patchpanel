const matchesTrustedSource = (req, allow) => {
  if (allow.length === 0) {
    return true;
  }
  const addr = req.socket.remoteAddress;
  if (!addr) {
    return false;
  }
  return allow.some(entry => addr === entry.replace(/\/32$/u, '').replace(/\/128$/u, ''));
};

export const ingressAuth = config => (req, _res, next) => {
  const { mode } = config;
  const headerName = config.server.ingressPathHeader;
  req.ingressPath = headerName ? (req.get(headerName) ?? '') : '';

  if (mode !== 'homeassistant') {
    req.user = { id: null, name: null, displayName: null };
    next();
    return;
  }

  if (!matchesTrustedSource(req, config.server.trustProxy ?? [])) {
    _res.status(403).json({ error: 'untrusted source for ingress request' });
    return;
  }

  req.user = {
    id: req.get('X-Remote-User-ID') ?? null,
    name: req.get('X-Remote-User-Name') ?? null,
    displayName: req.get('X-Remote-User-Display-Name') ?? null,
  };
  next();
};
