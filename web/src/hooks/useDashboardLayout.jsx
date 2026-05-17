import { useCallback, useEffect, useState } from 'react';

// v0.3.0 — Dashboard layout state. Storage shape:
//   {
//     order: string[],
//     hidden: string[],
//     widths: { panelId: int 3-12 },        // column-span on a 12-col CSS grid
//     heights: { panelId: int 1-4 },        // row-span (when not auto)
//     autoHeights: string[]                  // panelIds with content-sized height
//   }
//
// Per-panel widths + heights are integer counts on a CSS Grid. Each panel
// declares `defaultWidth` / `defaultHeight` / `defaultAutoHeight` (in
// PANEL_DEFS). User overrides persist in localStorage. Older v0.2.40
// storage with `sizes: { panelId: 'sm'|...}` is silently dropped on load.
//
// The hardcoded HeroStrip is gone — what used to be the always-visible
// top metrics strip is now the `live-totals` panel.

const STORAGE_KEY = 'patchpanel.dashboard.layout.v2';

export const MIN_PANEL_WIDTH = 1;
export const MAX_PANEL_WIDTH = 12;
export const MIN_PANEL_HEIGHT = 1;
export const MAX_PANEL_HEIGHT = 4;

export const DEFAULT_DASHBOARD_ORDER = Object.freeze([
  'kpi-routes',
  'kpi-backends',
  'kpi-certs',
  'kpi-providers',
  'live-totals',
  'alerts',
  'live-rate',
  'error-rate',
  'connection-pool',
  'runtime',
  'health',
  'tls-coverage',
  'top-hosts',
  'geo-origins',
  'slowest',
  'httpcodes',
  'snapshot-timeline',
  'actions',
  'certs',
  'activity',
]);

const sanitizeIntMap = (parsed, min, max) => {
  if (!parsed || typeof parsed !== 'object') {
    return {};
  }
  const out = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (Number.isInteger(v) && v >= min && v <= max) {
      out[k] = v;
    }
  }
  return out;
};

const loadFromStorage = () => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return {
      order: Array.isArray(parsed.order) ? parsed.order : null,
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [],
      widths: sanitizeIntMap(parsed.widths, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
      heights: sanitizeIntMap(parsed.heights, MIN_PANEL_HEIGHT, MAX_PANEL_HEIGHT),
      autoHeights: Array.isArray(parsed.autoHeights) ? parsed.autoHeights : [],
    };
  } catch {
    return null;
  }
};

const persist = (order, hiddenSet, widths, heights, autoHeightsSet) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        order,
        hidden: [...hiddenSet],
        widths,
        heights,
        autoHeights: [...autoHeightsSet],
      })
    );
  } catch {
    // Quota exceeded / private mode — non-fatal; layout falls back to in-memory.
  }
};

const mergeOrderWithKnown = (storedOrder, knownIds) => {
  if (!storedOrder) {
    return [...knownIds];
  }
  const knownSet = new Set(knownIds);
  const filtered = storedOrder.filter(id => knownSet.has(id));
  for (const id of knownIds) {
    if (!filtered.includes(id)) {
      filtered.push(id);
    }
  }
  return filtered;
};

export const useDashboardLayout = (knownIds = DEFAULT_DASHBOARD_ORDER) => {
  const [order, setOrder] = useState(() => {
    const stored = loadFromStorage();
    return mergeOrderWithKnown(stored?.order, knownIds);
  });
  const [hidden, setHidden] = useState(() => {
    const stored = loadFromStorage();
    return new Set(stored?.hidden ?? []);
  });
  const [widths, setWidths] = useState(() => {
    const stored = loadFromStorage();
    return stored?.widths ?? {};
  });
  const [heights, setHeights] = useState(() => {
    const stored = loadFromStorage();
    return stored?.heights ?? {};
  });
  const [autoHeights, setAutoHeights] = useState(() => {
    const stored = loadFromStorage();
    return new Set(stored?.autoHeights ?? []);
  });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (!cancelled) {
        setOrder(prev => mergeOrderWithKnown(prev, knownIds));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [knownIds]);

  const moveTo = useCallback(
    (sourceId, targetId) => {
      if (sourceId === targetId) {
        return;
      }
      setOrder(prev => {
        const from = prev.indexOf(sourceId);
        const to = prev.indexOf(targetId);
        if (from < 0 || to < 0) {
          return prev;
        }
        const next = prev.slice();
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item);
        persist(next, hidden, widths, heights, autoHeights);
        return next;
      });
    },
    [hidden, widths, heights, autoHeights]
  );

  const hide = useCallback(
    id => {
      setHidden(prev => {
        const next = new Set(prev);
        next.add(id);
        persist(order, next, widths, heights, autoHeights);
        return next;
      });
    },
    [order, widths, heights, autoHeights]
  );

  const show = useCallback(
    id => {
      setHidden(prev => {
        const next = new Set(prev);
        next.delete(id);
        persist(order, next, widths, heights, autoHeights);
        return next;
      });
    },
    [order, widths, heights, autoHeights]
  );

  const setWidth = useCallback(
    (id, nextWidth) => {
      const clamped = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, Math.round(nextWidth)));
      setWidths(prev => {
        const next = { ...prev, [id]: clamped };
        persist(order, hidden, next, heights, autoHeights);
        return next;
      });
    },
    [order, hidden, heights, autoHeights]
  );

  const setHeight = useCallback(
    (id, nextHeight) => {
      const clamped = Math.max(
        MIN_PANEL_HEIGHT,
        Math.min(MAX_PANEL_HEIGHT, Math.round(nextHeight))
      );
      setHeights(prev => {
        const next = { ...prev, [id]: clamped };
        persist(order, hidden, widths, next, autoHeights);
        return next;
      });
    },
    [order, hidden, widths, autoHeights]
  );

  const setAutoHeight = useCallback(
    (id, enabled) => {
      setAutoHeights(prev => {
        const next = new Set(prev);
        if (enabled) {
          next.add(id);
        } else {
          next.delete(id);
        }
        persist(order, hidden, widths, heights, next);
        return next;
      });
    },
    [order, hidden, widths, heights]
  );

  return {
    order,
    hidden,
    widths,
    heights,
    autoHeights,
    moveTo,
    hide,
    show,
    setWidth,
    setHeight,
    setAutoHeight,
  };
};
