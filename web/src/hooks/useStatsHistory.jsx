import { useEffect, useRef, useState } from 'react';

import { apiGet } from '../api/client.js';

const SAMPLE_MS = 1_000;
const MAX_SAMPLES = 3_600; // 1 hour at 1s — matches the server-side sampler buffer

const numeric = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const aggregateRowKey = row => `${row.pxname}/${row.svname}`;

// v0.2.40 — Each delta entry carries reqRate (delta of stot, the
// cumulative session counter HAProxy increments per inbound connection)
// so the dashboard can show live req/s without a separate endpoint.
const deltasFromRawSeries = rawSeries => {
  if (!Array.isArray(rawSeries) || rawSeries.length < 2) {
    return [];
  }
  const out = [];
  for (let i = 1; i < rawSeries.length; i += 1) {
    const a = rawSeries[i - 1];
    const b = rawSeries[i];
    const dtSec = Math.max(0.001, (b.ts - a.ts) / 1000);
    out.push({
      ts: b.ts,
      binRate: Math.max(0, (b.bin - a.bin) / dtSec),
      boutRate: Math.max(0, (b.bout - a.bout) / dtSec),
      reqRate: Math.max(0, (b.stot - a.stot) / dtSec),
      scur: b.scur,
    });
  }
  return out;
};

export const useStatsHistory = () => {
  const [snapshot, setSnapshot] = useState({ tracked: {}, history: {} });
  const previousRef = useRef({});
  const historyRef = useRef({});
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    let active = true;

    // Bootstrap from the server-side sampler so charts open with the recent
    // hour pre-populated instead of starting empty and building from zero.
    const bootstrap = async () => {
      try {
        const payload = await apiGet('api/stats/history');
        if (!active || !payload?.history) {
          return;
        }
        const tracked = {};
        for (const [key, rawSeries] of Object.entries(payload.history)) {
          if (!Array.isArray(rawSeries) || rawSeries.length === 0) {
            continue;
          }
          const deltas = deltasFromRawSeries(rawSeries);
          if (deltas.length > 0) {
            historyRef.current[key] = deltas.slice(-MAX_SAMPLES);
          }
          const last = rawSeries[rawSeries.length - 1];
          previousRef.current[key] = {
            ts: last.ts,
            bin: last.bin,
            bout: last.bout,
            stot: last.stot,
          };
          tracked[key] = {
            pxname: last.pxname,
            svname: last.svname,
            bin: last.bin,
            bout: last.bout,
            scur: last.scur,
            stot: last.stot,
            status: last.status,
          };
        }
        if (active) {
          setSnapshot({ tracked, history: { ...historyRef.current } });
          bootstrappedRef.current = true;
        }
      } catch {
        // Sampler may not be ready yet; fall through to the live sampler below.
      }
    };

    const sample = async () => {
      try {
        const payload = await apiGet('api/stats');
        if (!active) {
          return;
        }
        const now = Date.now();
        const tracked = {};
        for (const row of payload.stat ?? []) {
          if (row.svname !== 'BACKEND' && row.svname !== 'FRONTEND') {
            continue;
          }
          tracked[aggregateRowKey(row)] = {
            pxname: row.pxname,
            svname: row.svname,
            bin: numeric(row.bin),
            bout: numeric(row.bout),
            scur: numeric(row.scur),
            stot: numeric(row.stot),
            status: row.status,
          };
        }

        const prev = previousRef.current;
        for (const [key, curr] of Object.entries(tracked)) {
          const previous = prev[key];
          if (previous) {
            const dtSec = Math.max(0.001, (now - previous.ts) / 1000);
            const binRate = Math.max(0, (curr.bin - previous.bin) / dtSec);
            const boutRate = Math.max(0, (curr.bout - previous.bout) / dtSec);
            const reqRate = Math.max(0, (curr.stot - previous.stot) / dtSec);
            const list = historyRef.current[key] ?? [];
            list.push({ ts: now, binRate, boutRate, reqRate, scur: curr.scur });
            while (list.length > MAX_SAMPLES) {
              list.shift();
            }
            historyRef.current[key] = list;
          }
          prev[key] = { ts: now, bin: curr.bin, bout: curr.bout, stot: curr.stot };
        }

        setSnapshot({ tracked, history: { ...historyRef.current } });
      } catch {
        // ignore — stats may be unavailable briefly during reload
      }
    };

    bootstrap().then(() => {
      if (active) {
        sample();
      }
    });
    const interval = setInterval(sample, SAMPLE_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  return snapshot;
};
