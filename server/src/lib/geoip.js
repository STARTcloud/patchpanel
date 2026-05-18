import { createGunzip } from 'node:zlib';
import { createWriteStream, promises as fs } from 'node:fs';
import { dirname, join as joinPath } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { ensureDir, fileExists } from './files.js';
import { log } from './logger.js';

// Per-source on-disk filenames + download URLs. Both DB sources produce an
// MMDB file that the `@maxmind/geoip2-node` reader can open directly (DB-IP
// city-lite uses the same GeoIP2-City schema as MaxMind's GeoLite2-City).
const DB_FILENAMES = Object.freeze({
  maxmind: 'GeoLite2-City.mmdb',
  dbip: 'dbip-city-lite.mmdb',
});

const dbPathFor = (geoipDir, source) =>
  joinPath(geoipDir, DB_FILENAMES[source] ?? DB_FILENAMES.dbip);

const maxmindDownloadUrl = key =>
  `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-City&license_key=${encodeURIComponent(key)}&suffix=tar.gz`;

// DB-IP publishes a fresh free DB on the 1st of each month at the URL pattern
// https://download.db-ip.com/free/dbip-city-lite-YYYY-MM.mmdb.gz (CC-BY 4.0,
// no signup). The actual URL is built per-month inside fetchDbipMmdbMonth()
// so we can transparently fall back to the prior month when the current
// month's file isn't published yet.

const CACHE_TTL_MS = 30 * 60 * 1000;
const LOOKUP_TIMEOUT_MS = 5_000;

const cache = new Map();

const cachePut = (ip, entry) => {
  cache.set(ip, { entry, ts: Date.now() });
  if (cache.size > 5_000) {
    // Trim oldest 20% by ts. Cheap LRU approximation.
    const sorted = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts);
    for (let i = 0; i < sorted.length / 5; i += 1) {
      cache.delete(sorted[i][0]);
    }
  }
};

const cacheGet = ip => {
  const hit = cache.get(ip);
  if (!hit) {
    return null;
  }
  if (Date.now() - hit.ts > CACHE_TTL_MS) {
    cache.delete(ip);
    return null;
  }
  return hit.entry;
};

const isPrivateIp = ip => {
  if (!ip) {
    return false;
  }
  if (ip === '127.0.0.1' || ip === '::1') {
    return true;
  }
  const v4 = ip.match(/^(?<a>\d+)\.(?<b>\d+)\.\d+\.\d+$/u);
  if (v4) {
    const a = Number(v4.groups.a);
    const b = Number(v4.groups.b);
    if (a === 10) {
      return true;
    }
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    if (a === 192 && b === 168) {
      return true;
    }
    if (a === 169 && b === 254) {
      return true;
    }
  }
  if (ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) {
    return true;
  }
  return false;
};

let readerInstance = null;
let readerPath = null;

const loadReader = async (config, state) => {
  const source = state?.geoip?.localDbSource ?? 'dbip';
  if (source === 'none') {
    readerInstance = null;
    readerPath = null;
    return null;
  }
  const dbPath = dbPathFor(config.paths.geoipDir ?? '/data/geoip', source);
  if (readerInstance && readerPath === dbPath) {
    return readerInstance;
  }
  if (!(await fileExists(dbPath))) {
    readerInstance = null;
    readerPath = null;
    return null;
  }
  // Dynamic import so the dep is optional — if @maxmind/geoip2-node isn't
  // installed at runtime, the online fallback path still works.
  const mod = await import('@maxmind/geoip2-node').catch(err => {
    log.app.warn('@maxmind/geoip2-node not installed; geoip local lookups disabled', {
      error: err.message,
    });
    return null;
  });
  if (!mod) {
    return null;
  }
  readerInstance = await mod.Reader.open(dbPath);
  readerPath = dbPath;
  log.app.info('geoip MMDB reader loaded', { dbPath, source });
  return readerInstance;
};

// Build a normalized lookup result from a GeoIP2-City MMDB record. Both
// MaxMind GeoLite2-City and DB-IP city-lite expose the same schema, so the
// builder is shared — only the `source` label differs.
const buildLocalResult = (ip, r, source) => ({
  ip,
  source,
  country: r.country?.isoCode ?? null,
  countryName: r.country?.names?.en ?? null,
  city: r.city?.names?.en ?? null,
  region: r.subdivisions?.[0]?.names?.en ?? null,
  latitude: r.location?.latitude ?? null,
  longitude: r.location?.longitude ?? null,
  asnNumber: null,
  asnOrganization: null,
});

const localLookup = async (config, state, ip) => {
  const source = state?.geoip?.localDbSource ?? 'dbip';
  if (source === 'none') {
    return null;
  }
  const reader = await loadReader(config, state).catch(err => {
    log.app.warn('geoip reader load failed', { error: err.message });
    return null;
  });
  if (!reader) {
    return null;
  }
  try {
    return buildLocalResult(ip, reader.city(ip), source);
  } catch (err) {
    if (err?.name === 'AddressNotFoundError') {
      return null;
    }
    throw err;
  }
};

const lookupViaIpApi = async (ip, signal) => {
  const response = await fetch(
    `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,lat,lon,as`,
    { signal }
  );
  if (!response.ok) {
    throw new Error(`ip-api ${response.status}`);
  }
  const j = await response.json();
  if (j.status !== 'success') {
    return null;
  }
  return {
    ip,
    source: 'ip-api',
    country: j.countryCode ?? null,
    countryName: j.country ?? null,
    city: j.city ?? null,
    region: j.regionName ?? null,
    latitude: j.lat ?? null,
    longitude: j.lon ?? null,
    asnNumber: null,
    asnOrganization: j.as ?? null,
  };
};

const lookupViaIpinfo = async (ip, token, signal) => {
  const url = token
    ? `https://ipinfo.io/${encodeURIComponent(ip)}/json?token=${encodeURIComponent(token)}`
    : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`ipinfo ${response.status}`);
  }
  const j = await response.json();
  const [lat, lon] = (j.loc ?? '').split(',').map(s => Number(s));
  return {
    ip,
    source: 'ipinfo',
    country: j.country ?? null,
    countryName: null,
    city: j.city ?? null,
    region: j.region ?? null,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    asnNumber: null,
    asnOrganization: j.org ?? null,
  };
};

const onlineLookup = async (state, ip) => {
  const provider = state.geoip?.fallbackProvider ?? 'ip-api';
  if (provider === 'none') {
    return null;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    if (provider === 'ip-api') {
      return await lookupViaIpApi(ip, controller.signal);
    }
    if (provider === 'ipinfo') {
      return await lookupViaIpinfo(ip, state.geoip?.fallbackToken, controller.signal);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
};

const homeResultFor = (ip, geoip) => {
  const { homeLatitude, homeLongitude, homeCountry, homeLabel } = geoip ?? {};
  if (typeof homeLatitude !== 'number' || typeof homeLongitude !== 'number') {
    return null;
  }
  const country = typeof homeCountry === 'string' ? homeCountry.toUpperCase() : null;
  return {
    ip,
    source: 'home',
    country,
    countryName: country,
    city: homeLabel ?? null,
    region: null,
    latitude: homeLatitude,
    longitude: homeLongitude,
    asnNumber: null,
    asnOrganization: null,
  };
};

export const lookupIp = async (config, state, ip) => {
  if (!ip) {
    return null;
  }
  if (!state.geoip?.enabled) {
    return null;
  }
  const cached = cacheGet(ip);
  if (cached) {
    return cached;
  }
  if (isPrivateIp(ip)) {
    const home = homeResultFor(ip, state.geoip);
    if (home) {
      cachePut(ip, home);
      return home;
    }
    const entry = { ip, source: 'private', country: null, countryName: 'Private network' };
    cachePut(ip, entry);
    return entry;
  }
  try {
    const local = await localLookup(config, state, ip);
    if (local) {
      cachePut(ip, local);
      return local;
    }
  } catch (err) {
    log.app.warn('local geoip lookup failed', { ip, error: err.message });
  }
  try {
    const online = await onlineLookup(state, ip);
    if (online) {
      cachePut(ip, online);
      return online;
    }
  } catch (err) {
    log.app.warn('online geoip lookup failed', { ip, error: err.message });
  }
  return null;
};

export const lookupMany = async (config, state, ips) => {
  if (!state.geoip?.enabled) {
    return {};
  }
  const unique = [...new Set(ips.filter(ip => typeof ip === 'string' && ip.length > 0))];
  const results = await Promise.allSettled(unique.map(ip => lookupIp(config, state, ip)));
  const map = {};
  for (let i = 0; i < unique.length; i += 1) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      map[unique[i]] = r.value;
    }
  }
  return map;
};

// Minimal POSIX-ustar parser. Each entry is a 512-byte header followed by
// ceil(size/512)*512 bytes of content. We look for the first file whose
// basename ends with '.mmdb' and return its content as a Buffer.
const extractMmdbFromTar = buffer => {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    const name = header.subarray(0, 100).toString('utf8').replace(/\0+$/u, '');
    if (name === '') {
      break;
    }
    const sizeOctal = header
      .subarray(124, 136)
      .toString('utf8')
      .replace(/[^0-7]/gu, '');
    const size = parseInt(sizeOctal, 8);
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (name.endsWith('.mmdb') && Number.isFinite(size) && size > 0) {
      return buffer.subarray(contentStart, contentEnd);
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return null;
};

// MaxMind ships GeoLite2-City as a .tar.gz containing one .mmdb deep in a
// dated subdirectory. Stream the body, gunzip to a temp file, walk the
// tarball, extract only the .mmdb, atomic-rename into place.
const downloadMaxmindDatabase = async (config, licenseKey) => {
  if (!licenseKey) {
    throw new Error('MaxMind license key required when localDbSource is "maxmind"');
  }
  const dir = config.paths.geoipDir ?? '/data/geoip';
  await ensureDir(dir);
  const finalPath = dbPathFor(dir, 'maxmind');
  const tmpPath = `${finalPath}.tmp`;
  const url = maxmindDownloadUrl(licenseKey);
  log.app.info('downloading MaxMind GeoLite2-City db', {
    url: url.replace(licenseKey, '<redacted>'),
  });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`MaxMind download failed: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('MaxMind download returned empty body');
  }

  const tmpTarballPath = `${tmpPath}.tar`;
  await pipeline(
    Readable.fromWeb(response.body),
    createGunzip(),
    createWriteStream(tmpTarballPath)
  );

  const buffer = await fs.readFile(tmpTarballPath);
  const mmdb = extractMmdbFromTar(buffer);
  if (!mmdb) {
    await fs.rm(tmpTarballPath, { force: true });
    throw new Error('MaxMind tarball did not contain an .mmdb file');
  }
  await fs.writeFile(tmpPath, mmdb, { mode: 0o644 });
  await fs.rename(tmpPath, finalPath);
  await fs.rm(tmpTarballPath, { force: true });
  readerInstance = null;
  readerPath = null;
  log.app.info('MaxMind db updated', { path: finalPath, bytes: mmdb.length });
  return { path: finalPath, bytes: mmdb.length, source: 'maxmind' };
};

// DB-IP city-lite ships as a plain gzipped MMDB (no tarball). Stream-gunzip
// the response body directly to disk and atomic-rename. Try the current month
// first; HTTP 404 means this month's file hasn't been published yet, so fall
// back to the previous month.
const fetchDbipMmdbMonth = async (yyyy, mm) => {
  const url = `https://download.db-ip.com/free/dbip-city-lite-${yyyy}-${mm}.mmdb.gz`;
  log.app.info('downloading DB-IP city-lite db', { url });
  const response = await fetch(url);
  return { response, url };
};

const downloadDbipDatabase = async config => {
  const dir = config.paths.geoipDir ?? '/data/geoip';
  await ensureDir(dir);
  const finalPath = dbPathFor(dir, 'dbip');
  const tmpPath = `${finalPath}.tmp`;

  const now = new Date();
  const currentYyyy = now.getUTCFullYear();
  const currentMm = String(now.getUTCMonth() + 1).padStart(2, '0');
  let { response, url } = await fetchDbipMmdbMonth(currentYyyy, currentMm);

  if (response.status === 404 || response.status === 403) {
    const prev = new Date(Date.UTC(currentYyyy, now.getUTCMonth() - 1, 1));
    const prevYyyy = prev.getUTCFullYear();
    const prevMm = String(prev.getUTCMonth() + 1).padStart(2, '0');
    log.app.info('DB-IP current month not published yet; falling back to previous month', {
      tried: `${currentYyyy}-${currentMm}`,
      fallback: `${prevYyyy}-${prevMm}`,
    });
    ({ response, url } = await fetchDbipMmdbMonth(prevYyyy, prevMm));
  }

  if (!response.ok) {
    throw new Error(`DB-IP download failed: HTTP ${response.status} from ${url}`);
  }
  if (!response.body) {
    throw new Error('DB-IP download returned empty body');
  }

  await pipeline(Readable.fromWeb(response.body), createGunzip(), createWriteStream(tmpPath));
  const stat = await fs.stat(tmpPath);
  await fs.rename(tmpPath, finalPath);
  readerInstance = null;
  readerPath = null;
  log.app.info('DB-IP db updated', { path: finalPath, bytes: stat.size });
  return { path: finalPath, bytes: stat.size, source: 'dbip' };
};

export const downloadDatabase = (config, state) => {
  const source = state?.geoip?.localDbSource ?? 'dbip';
  if (source === 'maxmind') {
    return downloadMaxmindDatabase(config, state?.geoip?.maxmindLicenseKey);
  }
  if (source === 'dbip') {
    return downloadDbipDatabase(config);
  }
  throw new Error(`Local DB source is "${source}"; no download available.`);
};

export const getStatus = async (config, state) => {
  const source = state.geoip?.localDbSource ?? 'dbip';
  const dir = config.paths.geoipDir ?? '/data/geoip';
  const dbPath = source === 'none' ? null : dbPathFor(dir, source);
  const exists = dbPath ? await fileExists(dbPath) : false;
  let size = null;
  let mtime = null;
  if (exists && dbPath) {
    const stat = await fs.stat(dbPath).catch(() => null);
    if (stat) {
      ({ size } = stat);
      mtime = stat.mtime.toISOString();
    }
  }
  return {
    enabled: Boolean(state.geoip?.enabled),
    localDbSource: source,
    licenseKeySet: Boolean(state.geoip?.maxmindLicenseKey),
    dbPath,
    dbExists: exists,
    dbSize: size,
    dbMtime: mtime,
    fallbackProvider: state.geoip?.fallbackProvider ?? 'ip-api',
    autoUpdateCron: state.geoip?.autoUpdateCron ?? null,
  };
};

// Ensure dirname is imported even if tree-shaken.
export { dirname };
