/**
 * SeekdbSync Tests
 *
 * Tests the embedded vector search backend (seekdb + @seekdb/default-embed).
 * Covers: initialization, sync, query, deduplication, metadata sanitization, close.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SeekdbSync } from '../../src/services/sync/SeekdbSync.js';

describe('SeekdbSync', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'seekdb-test-'));
  });

  afterAll(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  });

  test('initialize creates collection without error', async () => {
    const sync = new SeekdbSync('test-project', tmpDir);
    await sync.initialize();
    await sync.close();
  });

  test('initialize is idempotent', async () => {
    const sync = new SeekdbSync('test-idempotent', tmpDir);
    await sync.initialize();
    await sync.initialize(); // Should not throw
    await sync.close();
  });

  test('syncObservation upserts document', async () => {
    const sync = new SeekdbSync('test-obs', tmpDir);
    await sync.initialize();

    await sync.syncObservation(1, 'Chose JWT for auth system', {
      sqlite_id: 1,
      type: 'decision',
      title: 'JWT auth decision',
      project: 'test-obs',
      created_at_epoch: Date.now(),
    });

    const count = await sync.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await sync.close();
  });

  test('syncSummary upserts document', async () => {
    const sync = new SeekdbSync('test-summary', tmpDir);
    await sync.initialize();

    await sync.syncSummary(1, 'Session investigated auth options', {
      sqlite_id: 1,
      doc_type: 'session_summary',
      project: 'test-summary',
      created_at_epoch: Date.now(),
    });

    const count = await sync.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await sync.close();
  });

  test('upsertDocuments handles batch of documents', async () => {
    const sync = new SeekdbSync('test-batch', tmpDir);
    await sync.initialize();

    const ids = ['obs_10', 'obs_11', 'obs_12'];
    const docs = [
      'Fixed race condition in cleanup',
      'Added WebSocket notifications',
      'Switched from MySQL to PostgreSQL',
    ];
    const metas = ids.map((_, i) => ({
      sqlite_id: 10 + i,
      doc_type: 'observation',
      type: 'discovery',
      project: 'test-batch',
      created_at_epoch: Date.now(),
    }));

    await sync.upsertDocuments(ids, docs, metas);

    const count = await sync.count();
    expect(count).toBe(3);
    await sync.close();
  });

  test('query returns results in ChromaSync-compatible format', async () => {
    const sync = new SeekdbSync('test-query', tmpDir);
    await sync.initialize();

    // Insert test data
    await sync.upsertDocuments(
      ['obs_1', 'obs_2', 'obs_3'],
      [
        'Chose JWT tokens for authentication system',
        'Fixed database connection pool exhaustion',
        'Added user preferences REST API endpoint',
      ],
      [
        { sqlite_id: 1, doc_type: 'observation', type: 'decision', project: 'test-query', created_at_epoch: Date.now() },
        { sqlite_id: 2, doc_type: 'observation', type: 'bugfix', project: 'test-query', created_at_epoch: Date.now() },
        { sqlite_id: 3, doc_type: 'observation', type: 'feature', project: 'test-query', created_at_epoch: Date.now() },
      ]
    );

    const result = await sync.query('authentication JWT', 5);

    // Verify ChromaSync-compatible format
    expect(result).toHaveProperty('ids');
    expect(result).toHaveProperty('distances');
    expect(result).toHaveProperty('metadatas');
    expect(Array.isArray(result.ids)).toBe(true);
    expect(Array.isArray(result.distances)).toBe(true);
    expect(Array.isArray(result.metadatas)).toBe(true);

    // Should find at least one result
    expect(result.ids.length).toBeGreaterThan(0);
    // ids should be numeric (sqlite IDs)
    expect(typeof result.ids[0]).toBe('number');
    // distances should be numeric
    expect(typeof result.distances[0]).toBe('number');

    await sync.close();
  });

  test('query deduplicates by sqlite_id', async () => {
    const sync = new SeekdbSync('test-dedup', tmpDir);
    await sync.initialize();

    // Insert two documents for the same sqlite_id (simulating narrative + text)
    await sync.upsertDocuments(
      ['obs_1_narrative', 'obs_1_text'],
      [
        'Chose JWT for authentication',
        'JWT auth decision was made today',
      ],
      [
        { sqlite_id: 1, doc_type: 'observation', type: 'decision', project: 'test-dedup', created_at_epoch: Date.now() },
        { sqlite_id: 1, doc_type: 'observation', type: 'decision', project: 'test-dedup', created_at_epoch: Date.now() },
      ]
    );

    const result = await sync.query('JWT authentication', 10);

    // Should have exactly 1 unique sqlite_id despite 2 matching documents
    const uniqueIds = new Set(result.ids);
    expect(uniqueIds.size).toBe(result.ids.length); // All IDs are unique
    expect(result.ids).toContain(1);

    await sync.close();
  });

  test('metadata sanitization removes null and empty values', async () => {
    const sync = new SeekdbSync('test-sanitize', tmpDir);
    await sync.initialize();

    // Should not throw even with null/undefined/empty metadata values
    await sync.syncObservation(99, 'Test with dirty metadata', {
      sqlite_id: 99,
      type: 'discovery',
      title: null,
      subtitle: undefined,
      emptyField: '',
      validField: 'valid',
      project: 'test-sanitize',
      created_at_epoch: Date.now(),
    });

    const count = await sync.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await sync.close();
  });

  test('upsertDocuments with empty arrays is a no-op', async () => {
    const sync = new SeekdbSync('test-empty', tmpDir);
    await sync.initialize();

    await sync.upsertDocuments([], [], []);
    const count = await sync.count();
    expect(count).toBe(0);
    await sync.close();
  });

  test('close is safe to call multiple times', async () => {
    const sync = new SeekdbSync('test-close', tmpDir);
    await sync.initialize();
    await sync.close();
    await sync.close(); // Should not throw
  });

  test('query with filter narrows results', async () => {
    const sync = new SeekdbSync('test-filter', tmpDir);
    await sync.initialize();

    await sync.upsertDocuments(
      ['obs_10', 'obs_11'],
      [
        'Authentication via JWT tokens',
        'Authentication via OAuth2',
      ],
      [
        { sqlite_id: 10, doc_type: 'observation', type: 'decision', project: 'test-filter', created_at_epoch: Date.now() },
        { sqlite_id: 11, doc_type: 'observation', type: 'feature', project: 'test-filter', created_at_epoch: Date.now() },
      ]
    );

    const allResults = await sync.query('authentication', 10);
    const filteredResults = await sync.query('authentication', 10, { type: 'decision' });

    // Filtered results should be a subset
    expect(filteredResults.ids.length).toBeLessThanOrEqual(allResults.ids.length);

    await sync.close();
  });

  test('re-initialize after close works without error', async () => {
    const sync = new SeekdbSync('test_reinit', tmpDir);
    await sync.initialize();
    await sync.syncObservation(1, 'First insert', {
      sqlite_id: 1,
      type: 'discovery',
      project: 'test_reinit',
      created_at_epoch: Date.now(),
    });
    await sync.close();

    // Re-initialize should not throw
    await sync.initialize();
    // Insert after re-init should work
    await sync.syncObservation(2, 'Second insert after re-init', {
      sqlite_id: 2,
      type: 'discovery',
      project: 'test_reinit',
      created_at_epoch: Date.now(),
    });
    const count = await sync.count();
    expect(count).toBeGreaterThanOrEqual(1);
    await sync.close();
  });

  test('query returns empty results for no matches', async () => {
    const sync = new SeekdbSync('test-nomatch', tmpDir);
    await sync.initialize();

    // Empty collection
    const result = await sync.query('something completely unrelated', 5);
    expect(result.ids.length).toBe(0);
    expect(result.distances.length).toBe(0);
    expect(result.metadatas.length).toBe(0);
    await sync.close();
  });

  test('syncObservation upsert overwrites on same id', async () => {
    const sync = new SeekdbSync('test-upsert', tmpDir);
    await sync.initialize();

    await sync.syncObservation(42, 'Original text', {
      sqlite_id: 42,
      type: 'discovery',
      project: 'test-upsert',
      created_at_epoch: Date.now(),
    });

    await sync.syncObservation(42, 'Updated text', {
      sqlite_id: 42,
      type: 'decision',
      project: 'test-upsert',
      created_at_epoch: Date.now(),
    });

    const count = await sync.count();
    // Should still be 1 since upsert overwrites
    expect(count).toBe(1);
    await sync.close();
  });
});
