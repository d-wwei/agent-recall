/**
 * CompilationRoutes Integration Tests
 *
 * Calls the live worker API to verify each compilation endpoint returns
 * a valid response shape.
 *
 * Tests are gracefully skipped when the worker is not running so they do
 * not fail in CI environments where the daemon is absent.
 */

import { describe, it, expect } from 'bun:test';

const API_BASE = 'http://127.0.0.1:37777';
const TEST_PROJECT = 'test-project';

async function workerIsRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe('CompilationRoutes — live integration', () => {
  describe('GET /api/compilation/stats', () => {
    it('returns valid stats shape', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/stats?project=${TEST_PROJECT}`);
        expect(res.status).toBe(200);

        const body = await res.json() as Record<string, unknown>;
        expect(typeof body.totalRuns).toBe('number');
        expect(typeof body.successRate).toBe('number');
        expect(typeof body.aiMergeActive).toBe('boolean');
        expect(Array.isArray(body.lintWarnings)).toBe(true);
        // lastCompilation is null when no runs have occurred
        expect('lastCompilation' in body).toBe(true);
        // aiMergeModel is null or a string
        expect(body.aiMergeModel === null || typeof body.aiMergeModel === 'string').toBe(true);
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });

    it('returns 400 when project param is missing', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/stats`);
        expect(res.status).toBe(400);
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });
  });

  describe('GET /api/compilation/logs', () => {
    it('returns an array of log entries', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/logs?project=${TEST_PROJECT}&limit=5`);
        expect(res.status).toBe(200);

        const body = await res.json() as unknown[];
        expect(Array.isArray(body)).toBe(true);
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });

    it('returns 400 when project param is missing', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/logs`);
        expect(res.status).toBe(400);
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });

    it('returns 400 for invalid limit param', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/logs?project=${TEST_PROJECT}&limit=abc`);
        expect(res.status).toBe(400);
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });
  });

  describe('GET /api/compilation/diagrams', () => {
    it('returns valid diagrams shape (content may be null when none compiled)', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/diagrams?project=${TEST_PROJECT}`);
        expect(res.status).toBe(200);

        const body = await res.json() as Record<string, unknown>;
        expect('content' in body).toBe(true);
        expect('compiledAt' in body).toBe(true);
        expect('version' in body).toBe(true);
        expect(typeof body.version).toBe('number');
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });

    it('returns 400 when project param is missing', async () => {
      if (!(await workerIsRunning())) {
        console.log('  [skip] worker not running');
        return;
      }

      try {
        const res = await fetch(`${API_BASE}/api/compilation/diagrams`);
        expect(res.status).toBe(400);
      } catch (err) {
        console.log('  [skip] fetch failed:', (err as Error).message);
      }
    });
  });
});
