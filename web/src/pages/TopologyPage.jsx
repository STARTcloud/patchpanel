import '@xyflow/react/dist/style.css';

import {
  Background,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  getBezierPath,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesInitialized,
  useNodesState,
  useReactFlow,
} from '@xyflow/react';
import dagre from 'dagre';
import PropTypes from 'prop-types';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Badge, Button, Card, Col, Form, InputGroup, Row } from 'react-bootstrap';
import { useNavigate } from 'react-router';

import { useStatsHistory } from '../hooks/useStatsHistory.jsx';
import { stateDocShape } from '../prop-shapes.js';

const RULE_PHASE_HTTP_REQUEST = 'httpRequest';
const LOCAL_STORAGE_KEY_BASE = 'patchpanel-topology-positions-v1';

const LAYOUT_DIRECTIONS = Object.freeze([
  { value: 'LR', label: 'Left → Right' },
  { value: 'RL', label: 'Right → Left' },
  { value: 'TB', label: 'Top → Bottom' },
  { value: 'BT', label: 'Bottom → Top' },
]);

const HANDLE_POSITIONS = Object.freeze({
  LR: { source: Position.Right, target: Position.Left },
  RL: { source: Position.Left, target: Position.Right },
  TB: { source: Position.Bottom, target: Position.Top },
  BT: { source: Position.Top, target: Position.Bottom },
});

const storageKeyFor = direction => `${LOCAL_STORAGE_KEY_BASE}-${direction}`;

const TRAFFIC_TIERS = Object.freeze([
  { max: 1_000, color: '#6c757d', label: 'idle', weight: 1 },
  { max: 64_000, color: '#0d6efd', label: '< 64 KB/s', weight: 2 },
  { max: 256_000, color: '#0dcaf0', label: '< 256 KB/s', weight: 2.5 },
  { max: 1_048_576, color: '#198754', label: '< 1 MB/s', weight: 3 },
  { max: 10_485_760, color: '#ffc107', label: '< 10 MB/s', weight: 4 },
  { max: 104_857_600, color: '#fd7e14', label: '< 100 MB/s', weight: 5 },
  { max: Infinity, color: '#dc3545', label: '≥ 100 MB/s', weight: 6 },
]);

const trafficTier = bytesPerSec => {
  for (const tier of TRAFFIC_TIERS) {
    if (bytesPerSec < tier.max) {
      return tier;
    }
  }
  return TRAFFIC_TIERS[TRAFFIC_TIERS.length - 1];
};

const latestRate = (history, key) => {
  const series = history?.[key];
  if (!Array.isArray(series) || series.length === 0) {
    return 0;
  }
  const last = series[series.length - 1];
  return Math.max(0, (last.binRate ?? 0) + (last.boutRate ?? 0));
};

const formatBps = bps => {
  if (bps < 1024) {
    return `${Math.round(bps)} B/s`;
  }
  if (bps < 1024 * 1024) {
    return `${(bps / 1024).toFixed(1)} KB/s`;
  }
  if (bps < 1024 * 1024 * 1024) {
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  }
  return `${(bps / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 60;

const loadStoredPositions = direction => {
  try {
    const raw = window.localStorage.getItem(storageKeyFor(direction));
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const saveStoredPositions = (direction, positions) => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  window.localStorage.setItem(storageKeyFor(direction), JSON.stringify(positions));
};

const layoutNodes = (rawNodes, rawEdges, direction = 'LR') => {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 100, nodesep: 30 });
  for (const n of rawNodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const e of rawEdges) {
    g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const stored = loadStoredPositions(direction);
  const handles = HANDLE_POSITIONS[direction] ?? HANDLE_POSITIONS.LR;
  return rawNodes.map(n => {
    const dagreNode = g.node(n.id);
    const position = stored[n.id] ?? {
      x: dagreNode.x - NODE_WIDTH / 2,
      y: dagreNode.y - NODE_HEIGHT / 2,
    };
    return {
      ...n,
      position,
      sourcePosition: handles.source,
      targetPosition: handles.target,
      data: {
        ...(n.data ?? {}),
        sourcePosition: handles.source,
        targetPosition: handles.target,
      },
    };
  });
};

const NODE_STYLES = Object.freeze({
  frontend: {
    background: '#0d6efd',
    color: '#fff',
    border: '1px solid #0a58ca',
    icon: 'bi-globe',
  },
  route: {
    background: '#198754',
    color: '#fff',
    border: '1px solid #146c43',
    icon: 'bi-signpost-2',
  },
  backend: {
    background: '#6610f2',
    color: '#fff',
    border: '1px solid #520dc2',
    icon: 'bi-hdd-network',
  },
  server: {
    background: '#fd7e14',
    color: '#fff',
    border: '1px solid #ca6510',
    icon: 'bi-pc-display',
  },
  authProvider: {
    background: '#495057',
    color: '#fff',
    border: '1px solid #343a40',
    icon: 'bi-shield-lock',
  },
});

const KIND_LEGEND_LABEL = Object.freeze({
  frontend: 'frontend',
  route: 'route',
  backend: 'backend',
  server: 'server',
  authProvider: 'auth provider',
});

const NodeShell = ({ data, selected }) => {
  const style = NODE_STYLES[data.kind] ?? NODE_STYLES.frontend;
  const dim = data.dim === true;
  const targetPosition = data.targetPosition ?? Position.Left;
  const sourcePosition = data.sourcePosition ?? Position.Right;
  return (
    <div
      style={{
        background: style.background,
        color: style.color,
        border: selected ? '2px solid #fff' : style.border,
        boxShadow: selected
          ? '0 0 0 2px #0d6efd, 0 2px 6px rgba(0,0,0,0.2)'
          : '0 1px 4px rgba(0,0,0,0.1)',
        borderRadius: '0.5rem',
        padding: '0.5rem 0.75rem',
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        fontSize: '0.75rem',
        opacity: dim ? 0.22 : 1,
        transition: 'opacity 0.15s ease-out, box-shadow 0.12s ease-out',
        cursor: 'pointer',
      }}
    >
      <Handle type="target" position={targetPosition} style={{ background: '#fff' }} />
      <div className="d-flex align-items-center gap-2">
        <i className={`bi ${style.icon}`} />
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {data.label}
        </strong>
        {data.auth ? (
          <i
            className="bi bi-shield-lock-fill ms-auto"
            title={`Auth-gated by ${data.auth.providerId} (${data.auth.providerType})`}
            style={{ fontSize: '0.85rem' }}
          />
        ) : null}
      </div>
      {data.sub ? (
        <div
          style={{
            opacity: 0.85,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {data.sub}
        </div>
      ) : null}
      <Handle type="source" position={sourcePosition} style={{ background: '#fff' }} />
    </div>
  );
};

NodeShell.propTypes = {
  data: PropTypes.shape({
    kind: PropTypes.string.isRequired,
    label: PropTypes.string.isRequired,
    sub: PropTypes.string,
    dim: PropTypes.bool,
    sourcePosition: PropTypes.string,
    targetPosition: PropTypes.string,
    auth: PropTypes.shape({
      providerId: PropTypes.string.isRequired,
      providerType: PropTypes.string.isRequired,
    }),
  }).isRequired,
  selected: PropTypes.bool,
};

const nodeTypes = { shell: NodeShell };

const buildAuthIndex = doc => {
  const aclToProvider = new Map();
  for (const fe of doc.frontends ?? []) {
    if (!fe.enabled || fe.mode !== 'http') {
      continue;
    }
    const rules = fe.rulePhases?.[RULE_PHASE_HTTP_REQUEST] ?? [];
    for (const rule of rules) {
      if (rule.enabled === false || rule.action?.type !== 'apply-auth-provider') {
        continue;
      }
      const { providerId } = rule.action;
      for (const term of rule.condition ?? []) {
        if (term.kind === 'aclRef') {
          aclToProvider.set(term.aclName, providerId);
        }
      }
    }
  }
  return aclToProvider;
};

const findAuthForCondition = (condition, aclToProvider) => {
  for (const term of condition ?? []) {
    if (term.kind === 'aclRef' && aclToProvider.has(term.aclName)) {
      return aclToProvider.get(term.aclName);
    }
  }
  return null;
};

const enabledHttpFrontends = doc =>
  (doc.frontends ?? []).filter(fe => fe.enabled && fe.mode === 'http');

const buildFrontendNodes = frontends =>
  frontends.map(fe => {
    const firstBind = fe.binds?.[0];
    const bindAddr = firstBind?.address ?? '';
    const anySsl = (fe.binds ?? []).some(b => b.ssl?.enabled);
    const sub = anySsl ? `${bindAddr} · TLS` : bindAddr;
    return {
      id: `fe:${fe.id}`,
      type: 'shell',
      data: { kind: 'frontend', label: fe.name, sub, frontendId: fe.id },
      position: { x: 0, y: 0 },
    };
  });

const buildRouteSection = ({ doc, frontends, aclByName, backendById, aclToProvider }) => {
  const nodes = [];
  const edges = [];
  for (const fe of frontends) {
    const rules = fe.rulePhases?.[RULE_PHASE_HTTP_REQUEST] ?? [];
    rules.forEach(rule => {
      if (rule.action?.type !== 'use-backend' || rule.enabled === false) {
        return;
      }
      const refs = (rule.condition ?? []).filter(t => t.kind === 'aclRef');
      const hostnames = [];
      for (const ref of refs) {
        const acl = aclByName.get(ref.aclName);
        if (acl?.field === 'hdr' && acl.fieldArg === 'host') {
          hostnames.push(...(acl.values ?? []));
        }
      }
      if (hostnames.length === 0) {
        return;
      }
      const routeId = `rt:${fe.id}:${rule.id}`;
      const { backendId } = rule.action;
      const backend = backendById.get(backendId);
      const providerId = findAuthForCondition(rule.condition, aclToProvider);
      const authProvider = providerId
        ? (doc.authProviders ?? []).find(p => p.id === providerId)
        : null;
      const authData = authProvider
        ? { providerId: authProvider.id, providerType: authProvider.type }
        : null;
      nodes.push({
        id: routeId,
        type: 'shell',
        data: {
          kind: 'route',
          label: rule.name ?? rule.id,
          sub:
            hostnames.slice(0, 2).join(', ') +
            (hostnames.length > 2 ? ` (+${hostnames.length - 2})` : ''),
          auth: authData,
          hostnames,
          ruleId: rule.id,
          frontendId: fe.id,
          backendId,
        },
        position: { x: 0, y: 0 },
      });
      edges.push({
        id: `e:fe-${fe.id}-${rule.id}`,
        source: `fe:${fe.id}`,
        target: routeId,
        animated: false,
        style: { stroke: '#0d6efd' },
        statsKey: backend ? `${backend.name}/BACKEND` : `${fe.name}/FRONTEND`,
      });
      edges.push({
        id: `e:${rule.id}-${backendId}`,
        source: routeId,
        target: `be:${backendId}`,
        style: { stroke: '#198754' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#198754' },
        statsKey: backend ? `${backend.name}/BACKEND` : null,
      });
      if (authProvider) {
        edges.push({
          id: `e:auth-gate-${rule.id}`,
          source: routeId,
          target: `auth:${authProvider.id}`,
          style: { stroke: '#dc3545', strokeDasharray: '4 4' },
          markerEnd: { type: MarkerType.ArrowClosed, color: '#dc3545' },
          label: 'gated by',
          statsKey: null,
        });
      }
    });
  }
  return { nodes, edges };
};

const buildBackendSection = doc => {
  const nodes = [];
  const edges = [];
  for (const backend of doc.backends ?? []) {
    const backendNodeId = `be:${backend.id}`;
    const serverCount = (backend.servers ?? []).length;
    const balanceLabel = backend.balance ?? 'roundrobin';
    const sub = `${backend.mode} · ${balanceLabel} · ${serverCount} server${serverCount === 1 ? '' : 's'}`;
    nodes.push({
      id: backendNodeId,
      type: 'shell',
      data: {
        kind: 'backend',
        label: backend.name,
        sub,
        backendId: backend.id,
        backendName: backend.name,
        serverCount,
      },
      position: { x: 0, y: 0 },
    });
    for (const server of backend.servers ?? []) {
      const serverId = `srv:${backend.id}:${server.name}`;
      nodes.push({
        id: serverId,
        type: 'shell',
        data: {
          kind: 'server',
          label: server.name,
          sub: server.address,
          backendId: backend.id,
        },
        position: { x: 0, y: 0 },
      });
      edges.push({
        id: `e:${backend.id}-${server.name}`,
        source: backendNodeId,
        target: serverId,
        style: { stroke: '#fd7e14' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#fd7e14' },
        statsKey: `${backend.name}/BACKEND`,
      });
    }
  }
  return { nodes, edges };
};

const buildAuthProviderSection = (doc, backendById) => {
  const nodes = [];
  const edges = [];
  for (const provider of doc.authProviders ?? []) {
    const nodeId = `auth:${provider.id}`;
    const authBackendId = provider.config?.authRequestBackendId ?? null;
    nodes.push({
      id: nodeId,
      type: 'shell',
      data: {
        kind: 'authProvider',
        label: provider.id,
        sub: provider.type,
        providerId: provider.id,
        providerType: provider.type,
      },
      position: { x: 0, y: 0 },
    });
    if (authBackendId) {
      const backend = backendById.get(authBackendId);
      edges.push({
        id: `e:auth-lookup-${provider.id}`,
        source: nodeId,
        target: `be:${authBackendId}`,
        style: { stroke: '#adb5bd' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#adb5bd' },
        label: 'lookup',
        statsKey: backend ? `${backend.name}/BACKEND` : null,
      });
    }
  }
  return { nodes, edges };
};

const buildGraph = (doc, direction) => {
  if (!doc) {
    return { nodes: [], edges: [] };
  }
  const aclByName = new Map((doc.acls ?? []).map(a => [a.name, a]));
  const backendById = new Map((doc.backends ?? []).map(b => [b.id, b]));
  const aclToProvider = buildAuthIndex(doc);
  const frontends = enabledHttpFrontends(doc);

  const frontendNodes = buildFrontendNodes(frontends);
  const routeSection = buildRouteSection({
    doc,
    frontends,
    aclByName,
    backendById,
    aclToProvider,
  });
  const authSection = buildAuthProviderSection(doc, backendById);
  const backendSection = buildBackendSection(doc);

  const nodes = [
    ...frontendNodes,
    ...routeSection.nodes,
    ...authSection.nodes,
    ...backendSection.nodes,
  ];
  const edges = [...routeSection.edges, ...authSection.edges, ...backendSection.edges];
  return { nodes: layoutNodes(nodes, edges, direction), edges };
};

const buildAdjacency = edges => {
  const adj = new Map();
  for (const e of edges) {
    if (!adj.has(e.source)) {
      adj.set(e.source, new Set());
    }
    if (!adj.has(e.target)) {
      adj.set(e.target, new Set());
    }
    adj.get(e.source).add(e.target);
    adj.get(e.target).add(e.source);
  }
  return adj;
};

const bfsConnected = (startId, adjacency) => {
  const visited = new Set([startId]);
  const queue = [startId];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const neighbor of adjacency.get(node) ?? []) {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }
  return visited;
};

const expandAuthFilterToConnectedIds = (allNodes, adjacency, predicate) => {
  const seeds = allNodes.filter(predicate).map(n => n.id);
  if (seeds.length === 0) {
    return new Set();
  }
  const visible = new Set();
  for (const seed of seeds) {
    for (const id of bfsConnected(seed, adjacency)) {
      visible.add(id);
    }
  }
  return visible;
};

const routeMatchesAuthFilter = (node, authFilter) => {
  if (node.data.kind !== 'route') {
    return false;
  }
  if (authFilter === 'auth-gated') {
    return Boolean(node.data.auth);
  }
  if (authFilter === 'open') {
    return !node.data.auth;
  }
  if (authFilter.startsWith('provider:')) {
    const pid = authFilter.slice('provider:'.length);
    return node.data.auth?.providerId === pid;
  }
  return false;
};

const LEGEND_BOX_STYLE = Object.freeze({
  position: 'absolute',
  bottom: '8px',
  left: '8px',
  zIndex: 10,
  background: 'rgba(33, 37, 41, 0.85)',
  color: '#f8f9fa',
  padding: '6px 8px',
  borderRadius: '4px',
  fontSize: '0.7rem',
  lineHeight: 1.4,
  pointerEvents: 'none',
});

const Dot = ({ color }) => (
  <span
    style={{
      display: 'inline-block',
      width: '0.65rem',
      height: '0.65rem',
      borderRadius: '50%',
      background: color,
      marginRight: '0.3rem',
      verticalAlign: 'middle',
    }}
  />
);

Dot.propTypes = { color: PropTypes.string.isRequired };

const Legend = ({ weathermap, presentKinds }) => {
  if (weathermap) {
    return (
      <div style={LEGEND_BOX_STYLE}>
        <div style={{ opacity: 0.8, marginBottom: '2px' }}>Throughput</div>
        {TRAFFIC_TIERS.map(t => (
          <div key={t.label} style={{ whiteSpace: 'nowrap' }}>
            <Dot color={t.color} />
            {t.label}
          </div>
        ))}
      </div>
    );
  }
  const orderedKinds = ['frontend', 'route', 'backend', 'server', 'authProvider'];
  const visible = orderedKinds.filter(k => presentKinds.has(k));
  if (visible.length === 0) {
    return null;
  }
  return (
    <div style={LEGEND_BOX_STYLE}>
      {visible.map(k => (
        <div key={k} style={{ whiteSpace: 'nowrap' }}>
          <Dot color={NODE_STYLES[k].background} />
          {KIND_LEGEND_LABEL[k]}
        </div>
      ))}
    </div>
  );
};

Legend.propTypes = {
  weathermap: PropTypes.bool.isRequired,
  presentKinds: PropTypes.instanceOf(Set).isRequired,
};

const FIT_VIEW_OPTIONS = Object.freeze({ padding: 0.15, maxZoom: 0.85, duration: 300 });

const ViewportFitter = ({ graphKey }) => {
  const { fitView } = useReactFlow();
  const nodesInitialized = useNodesInitialized();
  const lastFittedKeyRef = useRef(null);
  useEffect(() => {
    if (nodesInitialized && lastFittedKeyRef.current !== graphKey) {
      fitView(FIT_VIEW_OPTIONS);
      lastFittedKeyRef.current = graphKey;
    }
  }, [nodesInitialized, graphKey, fitView]);
  return null;
};

ViewportFitter.propTypes = {
  graphKey: PropTypes.string.isRequired,
};

const LABEL_STYLE = Object.freeze({ fontSize: 10, fill: '#212529' });
const LABEL_BG_STYLE = Object.freeze({ fill: 'rgba(255,255,255,0.85)' });
const LABEL_BG_PADDING = Object.freeze([4, 2]);

const styleCache = new Map();
const markerEndCache = new Map();

const getStableStyle = (edgeId, tierIdx, baseStyle, tier) => {
  const cacheKey = `${edgeId}:${tierIdx}`;
  let cached = styleCache.get(cacheKey);
  if (!cached) {
    cached = Object.freeze({ ...(baseStyle ?? {}), stroke: tier.color, strokeWidth: tier.weight });
    styleCache.set(cacheKey, cached);
  }
  return cached;
};

const getStableMarkerEnd = (edgeId, tierIdx, baseMarker, tier) => {
  if (!baseMarker) {
    return undefined;
  }
  const cacheKey = `${edgeId}:${tierIdx}`;
  let cached = markerEndCache.get(cacheKey);
  if (!cached) {
    cached = Object.freeze({ ...baseMarker, color: tier.color });
    markerEndCache.set(cacheKey, cached);
  }
  return cached;
};

// Packet emission model: each visible particle represents ~PACKET_BYTES of
// traffic. Spawn rate λ (packets/sec) is byte_rate / PACKET_BYTES, capped at
// MAX_LAMBDA so a 100 MB/s edge doesn't spawn thousands of DOM nodes.
// duration shrinks with rate (busy edges' packets travel faster) but never
// below MIN_DURATION_S to keep them perceivable.
const PACKET_BYTES = 65_536;
const MAX_LAMBDA = 18;
const MIN_DURATION_S = 1.8;
const MAX_DURATION_S = 4.0;

const lambdaFromBps = bps => {
  if (!bps || bps <= 0) {
    return 0;
  }
  return Math.min(MAX_LAMBDA, bps / PACKET_BYTES);
};

const durationFromBps = bps => {
  if (!bps || bps <= 0) {
    return MAX_DURATION_S;
  }
  const scaled = MAX_DURATION_S - Math.log10(bps + 1) * 0.22;
  return Math.max(MIN_DURATION_S, Math.min(MAX_DURATION_S, scaled));
};

const packetSizeFromTier = tier => 2 + (tier?.weight ?? 1);

const enrichEdgesWeathermap = (edges, history) =>
  edges.map(edge => {
    const key = edge.statsKey ?? null;
    const bps = key ? latestRate(history, key) : 0;
    const tier = trafficTier(bps);
    const tierIdx = TRAFFIC_TIERS.indexOf(tier);
    return {
      ...edge,
      type: 'flow',
      animated: false,
      label: bps > 0 ? formatBps(bps) : (edge.label ?? undefined),
      labelBgPadding: LABEL_BG_PADDING,
      labelBgBorderRadius: 4,
      labelStyle: LABEL_STYLE,
      labelBgStyle: LABEL_BG_STYLE,
      style: getStableStyle(edge.id, tierIdx, edge.style, tier),
      markerEnd: getStableMarkerEnd(edge.id, tierIdx, edge.markerEnd, tier),
      data: {
        ...(edge.data ?? {}),
        bps,
        tier,
        tierIdx,
        lambda: lambdaFromBps(bps),
        duration: durationFromBps(bps),
        packetSize: packetSizeFromTier(tier),
        isSource: typeof edge.source === 'string' && edge.source.startsWith('fe:'),
      },
    };
  });

const extractLivePacketValues = data => ({
  lambda: data?.lambda ?? 0,
  duration: data?.duration ?? MAX_DURATION_S,
  color: data?.tier?.color ?? '#6c757d',
  size: data?.packetSize ?? 3,
});

// Packet chain coordinator: a frontend→route edge (isSource=true) spawns
// packets via rAF at its rate. When a packet finishes traversing, the
// coordinator schedules a packet on each downstream edge (edges whose
// source = this edge's target). Net effect: one logical packet visibly
// hands off node → node like a relay, instead of every edge independently
// pulsing in lockstep.
const PacketCoordinatorContext = createContext(null);

const useCoordinatorRegistration = (id, registry) => {
  const coordinator = useContext(PacketCoordinatorContext);
  useEffect(() => {
    if (!coordinator) {
      return undefined;
    }
    return coordinator.registerEdge(id, registry);
  }, [coordinator, id, registry]);
  return coordinator;
};

const useSourceSpawnLoop = (id, coordinator, active, liveRef) => {
  useEffect(() => {
    if (!coordinator || !active) {
      return undefined;
    }
    let rafId;
    let lastTime = performance.now();
    const loop = now => {
      const dt = Math.min(0.25, (now - lastTime) / 1000);
      lastTime = now;
      const { lambda } = liveRef.current;
      if (lambda > 0) {
        const expected = lambda * dt;
        const whole = Math.floor(expected);
        const frac = expected - whole;
        const spawnCount = whole + (Math.random() < frac ? 1 : 0);
        for (let i = 0; i < spawnCount; i += 1) {
          coordinator.emitPacket(id, null);
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [coordinator, active, id, liveRef]);
};

const FlowLabel = ({ label, x, y, labelStyle, labelBgStyle }) => {
  if (!label) {
    return null;
  }
  return (
    <EdgeLabelRenderer>
      <div
        style={{
          position: 'absolute',
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
          background: labelBgStyle?.fill ?? 'rgba(255,255,255,0.85)',
          padding: '2px 4px',
          borderRadius: 4,
          fontSize: 10,
          color: labelStyle?.fill ?? '#212529',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
    </EdgeLabelRenderer>
  );
};

FlowLabel.propTypes = {
  label: PropTypes.node,
  x: PropTypes.number.isRequired,
  y: PropTypes.number.isRequired,
  labelStyle: PropTypes.object,
  labelBgStyle: PropTypes.object,
};

// Each packet uses `begin="indefinite"` + an explicit beginElement() call
// after the SVG element mounts. Otherwise SMIL's default `begin="0s"` is
// relative to the parent SVG's timeline (which has been running for
// minutes by the time a packet spawns) and browsers handle that
// inconsistently — some skip the packet to the end of the path, some
// drop it at a fractional position.
const MotionPacket = ({ packet, edgePath }) => {
  const motionRef = useRef(null);
  useEffect(() => {
    const el = motionRef.current;
    if (el && typeof el.beginElement === 'function') {
      try {
        el.beginElement();
      } catch {
        // Some test environments (jsdom) lack SMIL; ignore.
      }
    }
  }, []);
  return (
    <circle r={packet.size} fill={packet.color} opacity={0.9} pointerEvents="none">
      <animateMotion
        ref={motionRef}
        dur={`${packet.duration}s`}
        repeatCount="1"
        fill="freeze"
        path={edgePath}
        rotate="auto"
        begin="indefinite"
      />
    </circle>
  );
};

MotionPacket.propTypes = {
  packet: PropTypes.shape({
    size: PropTypes.number.isRequired,
    color: PropTypes.string.isRequired,
    duration: PropTypes.number.isRequired,
  }).isRequired,
  edgePath: PropTypes.string.isRequired,
};

const AnimatedFlowEdge = ({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  label,
  labelStyle,
  labelBgStyle,
  data,
}) => {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const liveRef = useRef(extractLivePacketValues(data));
  useEffect(() => {
    liveRef.current = extractLivePacketValues(data);
  });
  const [packets, setPackets] = useState([]);
  const nextIdRef = useRef(0);
  const registry = useMemo(
    () => ({ setPackets, liveRef, nextIdRef }),
    [setPackets, liveRef, nextIdRef]
  );
  const coordinator = useCoordinatorRegistration(id, registry);
  const isSource = data?.isSource ?? false;
  const sourceActive = isSource && (data?.lambda ?? 0) > 0;
  useSourceSpawnLoop(id, coordinator, sourceActive, liveRef);
  return (
    <>
      <BaseEdge path={edgePath} style={style} markerEnd={markerEnd} />
      {packets.map(p => (
        <MotionPacket key={p.id} packet={p} edgePath={edgePath} />
      ))}
      <FlowLabel
        label={label}
        x={labelX}
        y={labelY}
        labelStyle={labelStyle}
        labelBgStyle={labelBgStyle}
      />
    </>
  );
};

AnimatedFlowEdge.propTypes = {
  id: PropTypes.string.isRequired,
  sourceX: PropTypes.number.isRequired,
  sourceY: PropTypes.number.isRequired,
  sourcePosition: PropTypes.string.isRequired,
  targetX: PropTypes.number.isRequired,
  targetY: PropTypes.number.isRequired,
  targetPosition: PropTypes.string.isRequired,
  style: PropTypes.object,
  markerEnd: PropTypes.string,
  label: PropTypes.node,
  labelStyle: PropTypes.object,
  labelBgStyle: PropTypes.object,
  data: PropTypes.object,
};

const edgeTypes = { flow: AnimatedFlowEdge };

const matchesSearch = (node, q) => {
  if (!q) {
    return true;
  }
  const needle = q.toLowerCase();
  const haystacks = [node.data?.label ?? '', node.data?.sub ?? '', node.id];
  for (const v of node.data?.hostnames ?? []) {
    haystacks.push(v);
  }
  return haystacks.some(h => typeof h === 'string' && h.toLowerCase().includes(needle));
};

const navigationTargetForNode = node => {
  if (!node?.data) {
    return null;
  }
  switch (node.data.kind) {
    case 'frontend':
      return `/frontends?focus=${encodeURIComponent(node.data.frontendId ?? '')}`;
    case 'route':
      return `/rules?focus=${encodeURIComponent(node.data.ruleId ?? '')}`;
    case 'backend':
      return `/backends?focus=${encodeURIComponent(node.data.backendId ?? '')}`;
    case 'server':
      return `/backends?focus=${encodeURIComponent(node.data.backendId ?? '')}`;
    case 'authProvider':
      return `/providers?focus=${encodeURIComponent(node.data.providerId ?? '')}`;
    default:
      return null;
  }
};

const MINIMAP_NODE_COLOR = node => NODE_STYLES[node.data?.kind]?.background ?? '#6c757d';

export const TopologyPage = ({ doc = null }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [authFilter, setAuthFilter] = useState('all');
  const [weathermap, setWeathermap] = useState(false);
  const [isolatedNodeId, setIsolatedNodeId] = useState(null);
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [layoutDir, setLayoutDir] = useState('LR');
  const stats = useStatsHistory();
  const navigate = useNavigate();

  const fullGraph = useMemo(() => buildGraph(doc, layoutDir), [doc, layoutDir]);

  const adjacency = useMemo(() => buildAdjacency(fullGraph.edges), [fullGraph.edges]);

  const authFilterVisibleIds = useMemo(() => {
    if (authFilter === 'all') {
      return null;
    }
    return expandAuthFilterToConnectedIds(fullGraph.nodes, adjacency, node =>
      routeMatchesAuthFilter(node, authFilter)
    );
  }, [authFilter, fullGraph.nodes, adjacency]);

  const isolationVisibleIds = useMemo(() => {
    if (!isolatedNodeId) {
      return null;
    }
    return bfsConnected(isolatedNodeId, adjacency);
  }, [isolatedNodeId, adjacency]);

  const hoverConnectedIds = useMemo(() => {
    if (!hoveredNodeId) {
      return null;
    }
    return bfsConnected(hoveredNodeId, adjacency);
  }, [hoveredNodeId, adjacency]);

  const visibleNodes = useMemo(
    () =>
      fullGraph.nodes.filter(n => {
        if (authFilterVisibleIds && !authFilterVisibleIds.has(n.id)) {
          return false;
        }
        if (isolationVisibleIds && !isolationVisibleIds.has(n.id)) {
          return false;
        }
        return true;
      }),
    [fullGraph.nodes, authFilterVisibleIds, isolationVisibleIds]
  );

  const visibleEdges = useMemo(() => {
    const visibleIds = new Set(visibleNodes.map(n => n.id));
    return fullGraph.edges.filter(e => visibleIds.has(e.source) && visibleIds.has(e.target));
  }, [fullGraph.edges, visibleNodes]);

  const dimmedNodes = useMemo(() => {
    const trimmedQuery = searchQuery.trim();
    return visibleNodes.map(n => {
      const searchMiss = trimmedQuery && !matchesSearch(n, trimmedQuery);
      const hoverMiss = hoverConnectedIds && !hoverConnectedIds.has(n.id);
      return { ...n, data: { ...n.data, dim: Boolean(searchMiss || hoverMiss) } };
    });
  }, [visibleNodes, searchQuery, hoverConnectedIds]);

  const enrichedEdges = useMemo(
    () => (weathermap ? enrichEdgesWeathermap(visibleEdges, stats.history) : visibleEdges),
    [weathermap, visibleEdges, stats.history]
  );

  const edgeRefsRef = useRef(new Map());
  const chainMapRef = useRef(new Map());
  useEffect(() => {
    const map = new Map();
    for (const edge of enrichedEdges) {
      const downstream = enrichedEdges
        .filter(other => other.source === edge.target)
        .map(other => other.id);
      map.set(edge.id, downstream);
    }
    chainMapRef.current = map;
  }, [enrichedEdges]);

  const packetCoordinator = useMemo(() => {
    const registerEdge = (edgeId, refs) => {
      edgeRefsRef.current.set(edgeId, refs);
      return () => {
        if (edgeRefsRef.current.get(edgeId) === refs) {
          edgeRefsRef.current.delete(edgeId);
        }
      };
    };
    const emitPacket = (edgeId, seed) => {
      const refs = edgeRefsRef.current.get(edgeId);
      if (!refs) {
        return;
      }
      const live = refs.liveRef.current;
      const color = seed?.color ?? live.color;
      const size = seed?.size ?? live.size;
      const { duration } = live;
      const pid = `${edgeId}-${refs.nextIdRef.current}`;
      refs.nextIdRef.current += 1;
      refs.setPackets(prev => [...prev, { id: pid, color, size, duration }]);
      setTimeout(() => {
        const downstream = chainMapRef.current.get(edgeId) ?? [];
        for (const downId of downstream) {
          emitPacket(downId, { color, size });
        }
      }, duration * 1000);
      setTimeout(
        () => {
          refs.setPackets(prev => prev.filter(p => p.id !== pid));
        },
        duration * 1000 + 200
      );
    };
    return { registerEdge, emitPacket };
  }, []);

  const [nodes, setNodes, onNodesChange] = useNodesState(dimmedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(enrichedEdges);

  const lastLayoutDirRef = useRef(layoutDir);
  useEffect(() => {
    const directionChanged = lastLayoutDirRef.current !== layoutDir;
    lastLayoutDirRef.current = layoutDir;
    setNodes(currentNodes => {
      if (directionChanged) {
        return dimmedNodes;
      }
      const positionById = new Map(currentNodes.map(n => [n.id, n.position]));
      return dimmedNodes.map(newN => {
        const existingPosition = positionById.get(newN.id);
        return existingPosition ? { ...newN, position: existingPosition } : newN;
      });
    });
  }, [dimmedNodes, setNodes, layoutDir]);

  useEffect(() => {
    setEdges(enrichedEdges);
  }, [enrichedEdges, setEdges]);

  const graphKey = useMemo(
    () =>
      `${layoutDir}:${authFilter}:${isolatedNodeId ?? ''}:${visibleNodes.length}:${visibleEdges.length}`,
    [layoutDir, authFilter, isolatedNodeId, visibleNodes.length, visibleEdges.length]
  );

  const handleNodeDragStop = useCallback(
    (event, node) => {
      if (event.defaultPrevented) {
        return;
      }
      const stored = loadStoredPositions(layoutDir);
      stored[node.id] = node.position;
      saveStoredPositions(layoutDir, stored);
    },
    [layoutDir]
  );

  const handleNodeClick = useCallback((event, node) => {
    if (event.defaultPrevented) {
      return;
    }
    setIsolatedNodeId(node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setIsolatedNodeId(null);
  }, []);

  const handleNodeMouseEnter = useCallback((event, node) => {
    if (event.defaultPrevented) {
      return;
    }
    setHoveredNodeId(node.id);
  }, []);

  const handleNodeMouseLeave = useCallback(() => {
    setHoveredNodeId(null);
  }, []);

  const handleNodeDoubleClick = useCallback(
    (event, node) => {
      if (event.defaultPrevented) {
        return;
      }
      const target = navigationTargetForNode(node);
      if (target) {
        navigate(target);
      }
    },
    [navigate]
  );

  const handleResetLayout = useCallback(() => {
    try {
      window.localStorage.removeItem(storageKeyFor(layoutDir));
    } catch {
      return;
    }
    setIsolatedNodeId(null);
    setHoveredNodeId(null);
    setAuthFilter(prev => prev);
  }, [layoutDir]);

  const presentKinds = useMemo(() => new Set(visibleNodes.map(n => n.data.kind)), [visibleNodes]);

  if (!doc) {
    return null;
  }

  const authProviders = doc.authProviders ?? [];
  const isolatedNode = isolatedNodeId ? fullGraph.nodes.find(n => n.id === isolatedNodeId) : null;

  return (
    <Card className="patchpanel-fullheight-page">
      <Card.Body>
        <div className="d-flex justify-content-between align-items-center mb-2 flex-wrap gap-2">
          <div>
            <Card.Title className="mb-0">Topology</Card.Title>
            <Card.Text className="text-muted small mb-0">
              Click any node to isolate its subgraph · double-click to open its edit page · hover to
              highlight the connected chain · drag to reposition (saved per-browser).
            </Card.Text>
          </div>
          <div className="small text-muted">
            <Badge bg="secondary" className="me-1">
              {visibleNodes.length}
            </Badge>
            nodes ·{' '}
            <Badge bg="secondary" className="ms-1">
              {visibleEdges.length}
            </Badge>{' '}
            edges
          </div>
        </div>
        <Row className="g-2 mb-2 align-items-center">
          <Col xs={12} md={4}>
            <InputGroup size="sm">
              <InputGroup.Text>
                <i className="bi bi-search" />
              </InputGroup.Text>
              <Form.Control
                placeholder="Search hostname / route / backend…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery ? (
                <InputGroup.Text
                  as="button"
                  type="button"
                  onClick={() => setSearchQuery('')}
                  style={{ cursor: 'pointer' }}
                  title="Clear search"
                >
                  <i className="bi bi-x" />
                </InputGroup.Text>
              ) : null}
            </InputGroup>
          </Col>
          <Col xs={12} md={3}>
            <Form.Select
              size="sm"
              value={authFilter}
              onChange={e => setAuthFilter(e.target.value)}
              title="Filter routes by auth gating"
            >
              <option value="all">All routes</option>
              <option value="auth-gated">Auth-gated only</option>
              <option value="open">Open only</option>
              {authProviders.length > 0 ? <option disabled>──────</option> : null}
              {authProviders.map(p => (
                <option key={p.id} value={`provider:${p.id}`}>
                  Gated by: {p.id} ({p.type})
                </option>
              ))}
            </Form.Select>
          </Col>
          <Col xs={12} md={2}>
            <Form.Select
              size="sm"
              value={layoutDir}
              onChange={e => setLayoutDir(e.target.value)}
              title="Graph layout direction (positions are saved per-direction)"
            >
              {LAYOUT_DIRECTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
          </Col>
          <Col xs={12} md={2}>
            <Form.Check
              type="switch"
              id="topology-weathermap-toggle"
              label="Weathermap"
              checked={weathermap}
              onChange={e => setWeathermap(e.target.checked)}
            />
          </Col>
          <Col xs={12} md={1} className="text-md-end">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleResetLayout}
              title="Clear saved node positions for current direction and re-run auto layout"
              aria-label="Reset layout"
            >
              <i className="bi bi-arrow-counterclockwise" />
            </Button>
          </Col>
        </Row>
        {isolatedNode ? (
          <div className="mb-2 small d-flex align-items-center gap-2">
            <Badge bg="info">isolated</Badge>
            <span className="text-muted">
              Subgraph of <strong>{isolatedNode.data.label}</strong> ({isolatedNode.data.kind}).
              Click empty canvas to clear.
            </span>
            <Button
              variant="link"
              size="sm"
              className="p-0"
              onClick={() => setIsolatedNodeId(null)}
            >
              clear
            </Button>
          </div>
        ) : null}
        <div
          className="border rounded patchpanel-topology-pane"
          style={{
            width: '100%',
            flex: '1 1 auto',
            minHeight: 0,
            overflow: 'hidden',
            background: 'var(--bs-body-bg)',
            position: 'relative',
          }}
        >
          <PacketCoordinatorContext.Provider value={packetCoordinator}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeDragStop={handleNodeDragStop}
              onNodeClick={handleNodeClick}
              onNodeDoubleClick={handleNodeDoubleClick}
              onNodeMouseEnter={handleNodeMouseEnter}
              onNodeMouseLeave={handleNodeMouseLeave}
              onPaneClick={handlePaneClick}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              nodesDraggable
              minZoom={0.05}
              maxZoom={2}
              proOptions={{ hideAttribution: true }}
              style={{ width: '100%', height: '100%' }}
            >
              <ViewportFitter graphKey={graphKey} />
              <Background gap={20} color="#888" />
              <Controls position="bottom-right" />
              <MiniMap
                position="top-right"
                pannable
                zoomable
                nodeColor={MINIMAP_NODE_COLOR}
                style={{ background: 'rgba(33,37,41,0.85)' }}
                maskColor="rgba(33,37,41,0.5)"
              />
            </ReactFlow>
          </PacketCoordinatorContext.Provider>
          <Legend weathermap={weathermap} presentKinds={presentKinds} />
        </div>
        {visibleNodes.length === 0 ? (
          <p className="text-muted small mt-2 mb-0">
            No nodes visible. Either no routes are defined yet, or your filters exclude everything —
            clear the auth filter or search to see the full graph.
          </p>
        ) : null}
      </Card.Body>
    </Card>
  );
};

TopologyPage.propTypes = {
  doc: stateDocShape,
};
