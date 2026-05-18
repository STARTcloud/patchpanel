import { describe, expect, it } from 'vitest';

import { log, redact } from './Logger.js';

// Vitest runs in `node` by default. Logger.js is safe to import there
// because the only browser-global access at module-load time is guarded
// (`typeof document !== 'undefined'`) for the visibility-change listener.
// Browser-only paths (`window.location`, `navigator.userAgent`, `fetch`)
// live inside async functions that are never invoked during these tests.

const CATEGORIES = ['app', 'auth', 'api', 'state', 'haproxy', 'cert', 'peer', 'error'];
const LEVELS = ['trace', 'debug', 'info', 'warn', 'error'];

describe('Logger', () => {
  describe('exported `log` namespace', () => {
    it('exposes all 8 patchpanel categories', () => {
      for (const category of CATEGORIES) {
        expect(log[category]).toBeDefined();
      }
    });

    it('each category has all 5 level methods', () => {
      for (const category of CATEGORIES) {
        for (const level of LEVELS) {
          expect(typeof log[category][level]).toBe('function');
        }
      }
    });

    it('calling a level method does not throw with no metadata', () => {
      expect(() => log.app.debug('test')).not.toThrow();
    });

    it('calling a level method does not throw with metadata', () => {
      expect(() => log.app.debug('test', { value: 42 })).not.toThrow();
    });

    it('calling a level method does not throw with undefined metadata', () => {
      expect(() => log.app.debug('test', undefined)).not.toThrow();
    });
  });

  describe('redact()', () => {
    it('returns primitives unchanged', () => {
      expect(redact('hello')).toBe('hello');
      expect(redact(42)).toBe(42);
      expect(redact(true)).toBe(true);
      expect(redact(null)).toBe(null);
      expect(redact(undefined)).toBe(undefined);
    });

    it('redacts top-level sensitive keys', () => {
      const input = { password: 'hunter2', username: 'admin' };
      const out = redact(input);
      expect(out.password).toBe('[redacted]');
      expect(out.username).toBe('admin');
    });

    it('redacts every documented sensitive key', () => {
      const input = {
        password: 'a',
        passwd: 'a',
        currentPassword: 'a',
        newPassword: 'a',
        secret: 'a',
        token: 'a',
        authToken: 'a',
        auth_token: 'a',
        authorization: 'a',
        apiKey: 'a',
        api_key: 'a',
        jwt: 'a',
        cookie: 'a',
        wire: 'a',
        privkey: 'a',
        privkeyPem: 'a',
        privateKey: 'a',
        pem: 'a',
        fullchain: 'a',
        fullchainPem: 'a',
      };
      const out = redact(input);
      for (const key of Object.keys(input)) {
        expect(out[key]).toBe('[redacted]');
      }
    });

    it('matches keys case-insensitively', () => {
      const out = redact({ PASSWORD: 'x', Token: 'y', JWT: 'z' });
      expect(out.PASSWORD).toBe('[redacted]');
      expect(out.Token).toBe('[redacted]');
      expect(out.JWT).toBe('[redacted]');
    });

    it('redacts nested objects recursively', () => {
      const input = {
        outer: {
          password: 'secret1',
          inner: { token: 'secret2', safe: 'visible' },
        },
        sibling: 'visible',
      };
      const out = redact(input);
      expect(out.outer.password).toBe('[redacted]');
      expect(out.outer.inner.token).toBe('[redacted]');
      expect(out.outer.inner.safe).toBe('visible');
      expect(out.sibling).toBe('visible');
    });

    it('redacts inside arrays', () => {
      const input = [{ password: 'a' }, { token: 'b' }, { safe: 'c' }];
      const out = redact(input);
      expect(out[0].password).toBe('[redacted]');
      expect(out[1].token).toBe('[redacted]');
      expect(out[2].safe).toBe('c');
    });

    it('does not mutate the input object', () => {
      const input = { password: 'hunter2', nested: { token: 'xyz' } };
      const snapshot = JSON.parse(JSON.stringify(input));
      redact(input);
      expect(input).toEqual(snapshot);
    });

    it('preserves date strings, numbers, booleans, null inside metadata', () => {
      const input = {
        ts: '2026-05-17T12:00:00Z',
        count: 7,
        ok: true,
        missing: null,
        password: 'should-go',
      };
      const out = redact(input);
      expect(out.ts).toBe('2026-05-17T12:00:00Z');
      expect(out.count).toBe(7);
      expect(out.ok).toBe(true);
      expect(out.missing).toBe(null);
      expect(out.password).toBe('[redacted]');
    });

    it('handles patchpanel-specific keys (wire, privkey, fullchain)', () => {
      const input = {
        keyId: 'pp_abcd1234',
        name: 'ci-token',
        wire: 'pp_abcd1234.0123456789abcdef',
      };
      const out = redact(input);
      expect(out.keyId).toBe('pp_abcd1234');
      expect(out.name).toBe('ci-token');
      expect(out.wire).toBe('[redacted]');
    });
  });
});
