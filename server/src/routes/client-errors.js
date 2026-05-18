import { Router } from 'express';

import * as audit from '../lib/audit.js';
import { log } from '../lib/logger.js';

// Receives error reports shipped by the React UI's Logger.js. The body shape
// is `{ errors: [...], recent: [...] }` where `errors` is the batch that
// triggered the flush (error-level only) and `recent` is the in-memory ring
// buffer of the last ~100 entries for context. Each entry is recorded in
// the audit log with category `client-error` so an operator can correlate
// client-side crashes with server-side state.
//
// Public: unauthenticated errors (e.g. on the login page) need to ship too.
// Listed in middleware/auth.js PUBLIC_PATHS. Relies on the global rate
// limiter for abuse protection — the Logger.js side already debounces
// (~1s) and caps the queue, so well-behaved clients are well under the
// rate limit even during error storms.

const MAX_ENTRIES_PER_REQUEST = 200;
const MAX_MESSAGE_LENGTH = 4096;
const MAX_METADATA_BYTES = 16 * 1024;

const truncate = (value, limit) => {
  if (typeof value !== 'string') {
    return value;
  }
  return value.length > limit ? `${value.slice(0, limit)}…[truncated]` : value;
};

const sanitizeMetadata = metadata => {
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  let serialized;
  try {
    serialized = JSON.stringify(metadata);
  } catch {
    return { _serializationError: 'metadata contained non-serializable values' };
  }
  if (serialized.length > MAX_METADATA_BYTES) {
    return {
      _truncated: true,
      preview: serialized.slice(0, MAX_METADATA_BYTES),
    };
  }
  return metadata;
};

const sanitizeEntry = raw => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const ts = typeof raw.ts === 'string' ? raw.ts : new Date().toISOString();
  const level = typeof raw.level === 'string' ? raw.level : 'error';
  const category = typeof raw.category === 'string' ? raw.category : 'app';
  const message = typeof raw.message === 'string' ? truncate(raw.message, MAX_MESSAGE_LENGTH) : '';
  return {
    ts,
    level,
    category,
    message,
    metadata: sanitizeMetadata(raw.metadata),
  };
};

const sanitizeArray = (input, max) => {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.slice(0, max).map(sanitizeEntry).filter(Boolean);
};

export const clientErrorsRouter = () => {
  const router = Router();

  /**
   * @swagger
   * /api/client-errors:
   *   post:
   *     summary: Receive a batch of frontend error reports
   *     description: |
   *       Endpoint the React UI's `Logger.js` ships error-level logs to. Each batch is a recent set of error entries plus an optional `recent` ring-buffer snapshot for context. Public (unauthenticated errors on the login page or before session establishment must ship too), but rate-limited by the global limiter and capped in entry count + payload size. Each error is recorded in the audit log under category `client-error`.
   *     tags: [Documentation]
   *     security: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               errors:
   *                 type: array
   *                 description: Error-level entries that triggered the flush.
   *                 items:
   *                   type: object
   *                   properties:
   *                     ts: { type: string, format: 'date-time' }
   *                     level: { type: string, enum: [error] }
   *                     category: { type: string }
   *                     message: { type: string }
   *                     metadata: { type: object, nullable: true }
   *               recent:
   *                 type: array
   *                 description: Ring-buffer snapshot (any level) at flush time.
   *                 items:
   *                   type: object
   *     responses:
   *       200:
   *         description: Errors recorded
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Success' }
   */
  router.post('/client-errors', (req, res) => {
    const actor = req.user?.id ?? null;
    const errors = sanitizeArray(req.body?.errors, MAX_ENTRIES_PER_REQUEST);
    const recent = sanitizeArray(req.body?.recent, MAX_ENTRIES_PER_REQUEST);

    if (errors.length === 0) {
      res.json({ ok: true });
      return;
    }

    const recentForContext = recent.slice(-20);
    for (const entry of errors) {
      log.api.warn('client error reported', {
        actor,
        category: entry.category,
        message: entry.message,
        ts: entry.ts,
      });
      audit.record({
        actor,
        category: 'client-error',
        action: 'report',
        target: entry.category,
        outcome: 'error',
        details: {
          ts: entry.ts,
          message: entry.message,
          metadata: entry.metadata,
          recent: recentForContext,
          ip: req.ip,
        },
      });
    }

    res.json({ ok: true });
  });

  return router;
};
