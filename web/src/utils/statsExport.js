// Client-side stats export helpers. HAProxy's native stats page exposes
// `/;csv` and `/;json` for the same purpose; we already proxy the JSON
// payload from `/api/stats`, so the CSV path is just a client-side flatten.

const CSV_COLUMNS = Object.freeze([
  'pxname',
  'svname',
  'status',
  'scur',
  'smax',
  'stot',
  'rate',
  'rate_max',
  'bin',
  'bout',
  'dreq',
  'dresp',
  'ereq',
  'econ',
  'eresp',
  'wretr',
  'wredis',
  'chkfail',
  'chkdown',
  'downtime',
  'weight',
  'act',
  'bck',
  'check_status',
  'check_code',
  'check_duration',
  'hrsp_1xx',
  'hrsp_2xx',
  'hrsp_3xx',
  'hrsp_4xx',
  'hrsp_5xx',
  'hrsp_other',
  'rtime',
  'rtime_max',
  'qtime',
  'ctime',
  'ttime',
]);

const escapeCsv = value => {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/gu, '""')}"`;
  }
  return str;
};

export const rowsToCsv = rows => {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows ?? []) {
    lines.push(CSV_COLUMNS.map(col => escapeCsv(row[col])).join(','));
  }
  return lines.join('\n');
};

const triggerDownload = (filename, content, mime) => {
  if (typeof window === 'undefined' || !window.URL) {
    return;
  }
  const blob = new Blob([content], { type: mime });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
};

export const downloadStatsCsv = rows => {
  const filename = `haproxy-stats-${new Date().toISOString().replace(/[:.]/gu, '-')}.csv`;
  triggerDownload(filename, rowsToCsv(rows), 'text/csv;charset=utf-8');
};

export const downloadStatsJson = payload => {
  const filename = `haproxy-stats-${new Date().toISOString().replace(/[:.]/gu, '-')}.json`;
  triggerDownload(filename, JSON.stringify(payload, null, 2), 'application/json');
};
