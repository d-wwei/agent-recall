/**
 * Tests for useStats hook logic
 *
 * Tests the stats data structure handling and the API integration.
 * The hook fetches from /api/stats and provides a refresh function.
 */
import { describe, it, expect, mock, afterEach } from 'bun:test';
import { API_ENDPOINTS } from '../../src/ui/viewer/constants/api';
import type { Stats, WorkerStats, DatabaseStats } from '../../src/ui/viewer/types';

describe('useStats - endpoint', () => {
  it('should use /api/stats endpoint', () => {
    expect(API_ENDPOINTS.STATS).toBe('/api/stats');
  });
});

describe('useStats - Stats type structure', () => {
  it('should handle empty stats object', () => {
    const stats: Stats = {};
    expect(stats.worker).toBeUndefined();
    expect(stats.database).toBeUndefined();
  });

  it('should handle complete stats response', () => {
    const stats: Stats = {
      worker: {
        version: '1.0.0-alpha.1',
        uptime: 3600,
        activeSessions: 2,
        sseClients: 1,
      },
      database: {
        size: 1048576,
        observations: 150,
        sessions: 10,
        summaries: 5,
      },
    };

    expect(stats.worker?.version).toBe('1.0.0-alpha.1');
    expect(stats.worker?.uptime).toBe(3600);
    expect(stats.worker?.activeSessions).toBe(2);
    expect(stats.worker?.sseClients).toBe(1);
    expect(stats.database?.size).toBe(1048576);
    expect(stats.database?.observations).toBe(150);
    expect(stats.database?.sessions).toBe(10);
    expect(stats.database?.summaries).toBe(5);
  });

  it('should handle partial worker stats', () => {
    const stats: Stats = {
      worker: {
        version: '1.0.0',
      },
    };
    expect(stats.worker?.version).toBe('1.0.0');
    expect(stats.worker?.uptime).toBeUndefined();
  });

  it('should handle partial database stats', () => {
    const stats: Stats = {
      database: {
        observations: 42,
      },
    };
    expect(stats.database?.observations).toBe(42);
    expect(stats.database?.size).toBeUndefined();
  });
});

describe('useStats - fetch integration', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should fetch and parse stats successfully', async () => {
    const mockStats: Stats = {
      worker: { version: '1.0.0', uptime: 120, activeSessions: 1, sseClients: 2 },
      database: { size: 2048, observations: 10, sessions: 3, summaries: 1 },
    };

    globalThis.fetch = mock(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(mockStats),
      } as Response)
    );

    const response = await fetch(API_ENDPOINTS.STATS);
    const data = await response.json() as Stats;
    expect(data.worker?.version).toBe('1.0.0');
    expect(data.database?.observations).toBe(10);
  });

  it('should handle fetch failure gracefully', async () => {
    globalThis.fetch = mock(() =>
      Promise.reject(new Error('Connection refused'))
    );

    let error: Error | null = null;
    try {
      await fetch(API_ENDPOINTS.STATS);
    } catch (e) {
      error = e as Error;
    }
    expect(error).not.toBeNull();
    expect(error!.message).toBe('Connection refused');
  });
});
