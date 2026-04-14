/**
 * Endpoint Smoke Test
 *
 * Verifies all API endpoints are registered and reachable on the running worker.
 * Tests that endpoints return non-404 responses — does not test business logic.
 *
 * For GET endpoints: expects 200 or 400 (missing params), NOT 404.
 * For POST endpoints: expects 400 (missing body), NOT 404.
 * A 404 means the route was never registered — the exact bug this prevents.
 *
 * Requires worker running on localhost:37777.
 * Skip with: SKIP_SMOKE=1 bun test tests/integration/endpoint-smoke.test.ts
 */

import { describe, it, expect, beforeAll } from 'bun:test';

const BASE = 'http://localhost:37777';

async function isWorkerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

// GET endpoints — should return 200 or 400, never 404
const GET_ENDPOINTS = [
  // Core
  '/health',
  '/api/stats',
  '/api/projects',

  // Backup
  '/api/backup/list',
  '/api/backup/latest',

  // Diary (needs ?project= so expect 400)
  '/api/diary',
  '/api/diary/latest',

  // Collaboration
  '/api/team/shared',
  '/api/agents/active',
  '/api/agents/conflicts',
  '/api/agents/discoveries',

  // Cross-project
  '/api/cross-project/patterns',
  '/api/cross-project/global',

  // Learning (needs params, expect 400)
  '/api/learning/gaps',
  '/api/learning/completeness',
  '/api/learning/prompt',

  // Markdown sync
  '/api/markdown-sync/changes',
  '/api/markdown-sync/status',

  // Context
  '/api/context/recent',

  // Dashboard
  '/api/dashboard',
  '/api/dashboard/summary',

  // Persona
  '/api/persona',

  // Settings
  '/api/settings',
];

// POST endpoints — send empty body, should return 400 (validation), not 404
const POST_ENDPOINTS = [
  '/api/backup/create',
  '/api/backup/prune',
  '/api/diary',
  '/api/team/share',
  '/api/team/import',
  '/api/agents/propagate',
  '/api/cross-project/promote',
  '/api/markdown-sync/export',
  '/api/markdown-sync/import',
  '/api/sessions/init',
  '/api/sessions/observations',
  '/api/sessions/summarize',
  '/api/sessions/complete',
];

describe('Endpoint Smoke Test', () => {
  let workerAvailable = false;

  beforeAll(async () => {
    if (process.env.SKIP_SMOKE === '1') return;
    workerAvailable = await isWorkerRunning();
  });

  describe('GET endpoints are registered', () => {
    for (const endpoint of GET_ENDPOINTS) {
      it(`GET ${endpoint} → not 404`, async () => {
        if (!workerAvailable) {
          console.log('  [SKIP] Worker not running');
          return;
        }

        const res = await fetch(`${BASE}${endpoint}`, { signal: AbortSignal.timeout(5000) });
        expect(res.status).not.toBe(404);
      });
    }
  });

  describe('POST endpoints are registered', () => {
    for (const endpoint of POST_ENDPOINTS) {
      it(`POST ${endpoint} → not 404`, async () => {
        if (!workerAvailable) {
          console.log('  [SKIP] Worker not running');
          return;
        }

        const res = await fetch(`${BASE}${endpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(5000),
        });
        expect(res.status).not.toBe(404);
      });
    }
  });
});
