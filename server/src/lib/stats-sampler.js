import { showInfo, showStat } from './haproxy-stats.js';
import { log } from './logger.js';

const SAMPLE_INTERVAL_MS = 1_000;
const MAX_SAMPLES = 3_600; // 1 hour at 1s

const numeric = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const keyFor = row => `${row.pxname}/${row.svname}`;

export const createStatsSampler = config => {
  const history = new Map();
  let latestInfo = null;
  let intervalHandle = null;
  let lastSampleAt = null;
  let consecutiveFailures = 0;

  const sampleOnce = async () => {
    try {
      const [info, rows] = await Promise.all([
        showInfo(config.paths.haproxyStatsSocket).catch(() => null),
        showStat(config.paths.haproxyStatsSocket).catch(() => []),
      ]);
      if (info) {
        latestInfo = info;
      }
      const now = Date.now();
      for (const row of rows ?? []) {
        if (!row.pxname || !row.svname) {
          continue;
        }
        if (row.svname !== 'BACKEND' && row.svname !== 'FRONTEND') {
          continue;
        }
        const key = keyFor(row);
        const series = history.get(key) ?? [];
        const sample = {
          ts: now,
          bin: numeric(row.bin),
          bout: numeric(row.bout),
          scur: numeric(row.scur),
          smax: numeric(row.smax),
          stot: numeric(row.stot),
          rtime: numeric(row.rtime),
          rtimeMax: numeric(row.rtime_max),
          qtime: numeric(row.qtime),
          ctime: numeric(row.ctime),
          ttime: numeric(row.ttime),
          hrsp1xx: numeric(row.hrsp_1xx),
          hrsp2xx: numeric(row.hrsp_2xx),
          hrsp3xx: numeric(row.hrsp_3xx),
          hrsp4xx: numeric(row.hrsp_4xx),
          hrsp5xx: numeric(row.hrsp_5xx),
          hrspOther: numeric(row.hrsp_other),
          ereq: numeric(row.ereq),
          econ: numeric(row.econ),
          eresp: numeric(row.eresp),
          chkfail: numeric(row.chkfail),
          status: row.status,
          pxname: row.pxname,
          svname: row.svname,
        };
        series.push(sample);
        while (series.length > MAX_SAMPLES) {
          series.shift();
        }
        history.set(key, series);
      }
      lastSampleAt = now;
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures % 12 === 1) {
        // Log every minute of failure, not every 5s
        log.app.warn('stats sampler tick failed', { error: err.message });
      }
    }
  };

  const start = () => {
    if (intervalHandle) {
      return;
    }
    sampleOnce().catch(() => undefined);
    intervalHandle = setInterval(() => {
      sampleOnce().catch(() => undefined);
    }, SAMPLE_INTERVAL_MS);
    intervalHandle.unref?.();
    log.app.info('stats sampler started', {
      intervalMs: SAMPLE_INTERVAL_MS,
      maxSamples: MAX_SAMPLES,
    });
  };

  const stop = () => {
    if (intervalHandle) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  };

  const snapshot = ({ since = null } = {}) => {
    const result = {};
    for (const [key, series] of history.entries()) {
      const filtered = since ? series.filter(s => s.ts > since) : series;
      result[key] = filtered;
    }
    return {
      info: latestInfo,
      history: result,
      lastSampleAt,
      sampleIntervalMs: SAMPLE_INTERVAL_MS,
    };
  };

  // Slowest backends top-N — sorted by the latest sample's rtime (HAProxy's
  // average response time over its last 1024 requests). Only BACKEND rows.
  const slowestBackends = ({ limit = 10 } = {}) => {
    const rows = [];
    for (const [key, series] of history.entries()) {
      if (series.length === 0) {
        continue;
      }
      const last = series[series.length - 1];
      if (last.svname !== 'BACKEND') {
        continue;
      }
      rows.push({
        key,
        pxname: last.pxname,
        svname: last.svname,
        rtime: last.rtime,
        rtimeMax: last.rtimeMax,
        qtime: last.qtime,
        ctime: last.ctime,
        ttime: last.ttime,
        scur: last.scur,
        status: last.status,
      });
    }
    rows.sort((a, b) => b.rtime - a.rtime);
    return rows.slice(0, limit);
  };

  // Aggregate HTTP status code counts across all FRONTEND rows over the
  // sampled window. Returns delta from window-start to window-end so the
  // numbers reflect recent activity, not lifetime totals.
  const httpStatusDistribution = () => {
    const totals = { '1xx': 0, '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
    for (const [, series] of history.entries()) {
      if (series.length < 1) {
        continue;
      }
      const [first] = series;
      const last = series[series.length - 1];
      if (last.svname !== 'FRONTEND') {
        continue;
      }
      totals['1xx'] += Math.max(0, last.hrsp1xx - first.hrsp1xx);
      totals['2xx'] += Math.max(0, last.hrsp2xx - first.hrsp2xx);
      totals['3xx'] += Math.max(0, last.hrsp3xx - first.hrsp3xx);
      totals['4xx'] += Math.max(0, last.hrsp4xx - first.hrsp4xx);
      totals['5xx'] += Math.max(0, last.hrsp5xx - first.hrsp5xx);
      totals.other += Math.max(0, last.hrspOther - first.hrspOther);
    }
    return totals;
  };

  return { start, stop, snapshot, slowestBackends, httpStatusDistribution };
};
