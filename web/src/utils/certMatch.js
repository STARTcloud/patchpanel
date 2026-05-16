const matchesDomain = (pattern, hostname) => {
  if (!pattern || !hostname) {
    return false;
  }
  const p = pattern.toLowerCase();
  const h = hostname.toLowerCase();
  if (p === h) {
    return true;
  }
  if (p.startsWith('*.')) {
    const suffix = p.slice(1);
    const firstDot = h.indexOf('.');
    if (firstDot < 0) {
      return false;
    }
    return h.slice(firstDot) === suffix;
  }
  return false;
};

export const findCoveringCerts = (certs, hostname) =>
  certs.filter(cert => cert.domains.some(d => matchesDomain(d, hostname)));

export const findCoveringCertsForRoute = (certs, route) => {
  const matches = new Map();
  for (const hostname of route.hostnames ?? []) {
    for (const cert of findCoveringCerts(certs, hostname)) {
      matches.set(cert.id, cert);
    }
  }
  return [...matches.values()];
};
