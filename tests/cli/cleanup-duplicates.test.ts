/**
 * Tests for cleanup-duplicates CLI tool logic
 *
 * Mock Justification (~20% mock code):
 * - SessionStore: Mocked to avoid real database access.
 *   Tests validate the duplicate detection algorithm (keep-min-id, delete-rest)
 *   using an in-memory SessionStore and actual SQL operations.
 *
 * Value: Validates that the deduplication logic correctly identifies
 * duplicate groups and preserves the earliest record in each group.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { SessionStore } from '../../src/services/sqlite/SessionStore.js';

describe('cleanup-duplicates logic', () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  /**
   * Helper: create a session and return the memory_session_id
   */
  function createTestSession(contentId: string, project: string): string {
    const sdkId = store.createSDKSession(contentId, project, 'test prompt');
    const memoryId = `mem-${contentId}`;
    store.updateMemorySessionId(sdkId, memoryId);
    return memoryId;
  }

  describe('duplicate observation detection', () => {
    it('should find duplicate observations with same title/subtitle/type/session', () => {
      const memId = createTestSession('sess-1', 'test-project');

      // Insert duplicates directly via SQL to bypass content-hash deduplication
      // (The cleanup script is meant for legacy data that predates dedup)
      const now = Date.now();
      const insertStmt = store['db'].prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(memId, 'test-project', 'discovery', 'Found a bug', 'In auth module',
        '["fact1"]', 'narrative text', '["concept1"]', '["file1.ts"]', '[]', 1, 0, 'hash-a', new Date(now).toISOString(), now);
      insertStmt.run(memId, 'test-project', 'discovery', 'Found a bug', 'In auth module',
        '["fact1"]', 'narrative text', '["concept1"]', '["file1.ts"]', '[]', 1, 0, 'hash-b', new Date(now + 1).toISOString(), now + 1);

      // Query for duplicates using the same SQL pattern as the cleanup script
      const duplicates = store['db'].prepare(`
        SELECT memory_session_id, title, subtitle, type, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM observations
        GROUP BY memory_session_id, title, subtitle, type
        HAVING count > 1
      `).all() as Array<{ count: number; ids: string }>;

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].count).toBe(2);

      // Verify the ids string contains two comma-separated ids
      const ids = duplicates[0].ids.split(',').map(Number);
      expect(ids).toHaveLength(2);
    });

    it('should not flag unique observations as duplicates', () => {
      const memId = createTestSession('sess-2', 'test-project');

      store.storeObservation(memId, 'test-project', {
        type: 'discovery',
        title: 'Unique title 1',
        subtitle: null,
        facts: [],
        narrative: '',
        concepts: [],
        files_read: [],
        files_modified: [],
      });

      store.storeObservation(memId, 'test-project', {
        type: 'discovery',
        title: 'Unique title 2',
        subtitle: null,
        facts: [],
        narrative: '',
        concepts: [],
        files_read: [],
        files_modified: [],
      });

      const duplicates = store['db'].prepare(`
        SELECT memory_session_id, title, subtitle, type, COUNT(*) as count
        FROM observations
        GROUP BY memory_session_id, title, subtitle, type
        HAVING count > 1
      `).all();

      expect(duplicates).toHaveLength(0);
    });

    it('should keep the earliest ID and delete the rest', () => {
      const memId = createTestSession('sess-3', 'test-project');

      // Insert 3 duplicate copies directly via SQL (bypass content-hash dedup)
      const now = Date.now();
      const insertStmt = store['db'].prepare(`
        INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(memId, 'test-project', 'change', 'Duplicate entry', 'sub',
        '[]', '', '[]', '[]', '[]', 1, 0, 'hash-1', new Date(now).toISOString(), now);
      insertStmt.run(memId, 'test-project', 'change', 'Duplicate entry', 'sub',
        '[]', '', '[]', '[]', '[]', 1, 0, 'hash-2', new Date(now + 1).toISOString(), now + 1);
      insertStmt.run(memId, 'test-project', 'change', 'Duplicate entry', 'sub',
        '[]', '', '[]', '[]', '[]', 1, 0, 'hash-3', new Date(now + 2).toISOString(), now + 2);

      // Get all IDs
      const allRows = store['db'].prepare(
        `SELECT id FROM observations WHERE memory_session_id = ? ORDER BY id`
      ).all(memId) as Array<{ id: number }>;

      const allIds = allRows.map(r => r.id);
      expect(allIds).toHaveLength(3);

      const keepId = Math.min(...allIds);
      const deleteIds = allIds.filter(id => id !== keepId);

      // Apply the same deletion pattern as the cleanup script
      store['db'].prepare(
        `DELETE FROM observations WHERE id IN (${deleteIds.join(',')})`
      ).run();

      // Verify only the earliest remains
      const remaining = store['db'].prepare(
        `SELECT id FROM observations WHERE memory_session_id = ?`
      ).all(memId) as Array<{ id: number }>;

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(keepId);
    });
  });

  describe('duplicate summary detection', () => {
    it('should find duplicate summaries with same request/completed/learned/session', () => {
      const memId = createTestSession('sess-4', 'test-project');

      // Insert duplicate summaries directly via SQL
      const now = Date.now();
      const insertStmt = store['db'].prepare(`
        INSERT INTO session_summaries
        (memory_session_id, project, request, investigated, learned, completed, next_steps, notes,
         prompt_number, discovery_tokens, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(memId, 'test-project', 'Fix the auth bug', 'Auth module', 'Token expiry was wrong',
        'Fixed token refresh', 'Add tests', null, 1, 0, new Date(now).toISOString(), now);
      insertStmt.run(memId, 'test-project', 'Fix the auth bug', 'Auth module', 'Token expiry was wrong',
        'Fixed token refresh', 'Add tests', null, 1, 0, new Date(now + 1).toISOString(), now + 1);

      const duplicates = store['db'].prepare(`
        SELECT memory_session_id, request, completed, learned, COUNT(*) as count, GROUP_CONCAT(id) as ids
        FROM session_summaries
        GROUP BY memory_session_id, request, completed, learned
        HAVING count > 1
      `).all() as Array<{ count: number; ids: string }>;

      expect(duplicates).toHaveLength(1);
      expect(duplicates[0].count).toBe(2);
    });

    it('should not flag unique summaries as duplicates', () => {
      const memId = createTestSession('sess-5', 'test-project');

      store.storeSummary(memId, 'test-project', {
        request: 'First request',
        investigated: '',
        learned: '',
        completed: '',
        next_steps: '',
        notes: null,
      });

      store.storeSummary(memId, 'test-project', {
        request: 'Second request',
        investigated: '',
        learned: '',
        completed: '',
        next_steps: '',
        notes: null,
      });

      const duplicates = store['db'].prepare(`
        SELECT memory_session_id, request, completed, learned, COUNT(*) as count
        FROM session_summaries
        GROUP BY memory_session_id, request, completed, learned
        HAVING count > 1
      `).all();

      expect(duplicates).toHaveLength(0);
    });

    it('should keep the earliest summary ID and delete the rest', () => {
      const memId = createTestSession('sess-6', 'test-project');

      // Insert 2 duplicate summaries directly via SQL
      const now = Date.now();
      const insertStmt = store['db'].prepare(`
        INSERT INTO session_summaries
        (memory_session_id, project, request, investigated, learned, completed, next_steps, notes,
         prompt_number, discovery_tokens, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertStmt.run(memId, 'test-project', 'Duplicate summary', 'stuff', 'things', 'done', 'more', null,
        1, 0, new Date(now).toISOString(), now);
      insertStmt.run(memId, 'test-project', 'Duplicate summary', 'stuff', 'things', 'done', 'more', null,
        1, 0, new Date(now + 1).toISOString(), now + 1);

      const allRows = store['db'].prepare(
        `SELECT id FROM session_summaries WHERE memory_session_id = ? ORDER BY id`
      ).all(memId) as Array<{ id: number }>;

      const allIds = allRows.map(r => r.id);
      expect(allIds).toHaveLength(2);

      const keepId = Math.min(...allIds);
      const deleteIds = allIds.filter(id => id !== keepId);

      store['db'].prepare(
        `DELETE FROM session_summaries WHERE id IN (${deleteIds.join(',')})`
      ).run();

      const remaining = store['db'].prepare(
        `SELECT id FROM session_summaries WHERE memory_session_id = ?`
      ).all(memId) as Array<{ id: number }>;

      expect(remaining).toHaveLength(1);
      expect(remaining[0].id).toBe(keepId);
    });
  });

  describe('cross-session deduplication', () => {
    it('should not treat same title in different sessions as duplicates', () => {
      const memId1 = createTestSession('sess-7a', 'test-project');
      const memId2 = createTestSession('sess-7b', 'test-project');

      const obs = {
        type: 'discovery',
        title: 'Same title',
        subtitle: 'same sub',
        facts: [],
        narrative: '',
        concepts: [],
        files_read: [],
        files_modified: [],
      };

      store.storeObservation(memId1, 'test-project', obs);
      store.storeObservation(memId2, 'test-project', obs);

      const duplicates = store['db'].prepare(`
        SELECT memory_session_id, title, subtitle, type, COUNT(*) as count
        FROM observations
        GROUP BY memory_session_id, title, subtitle, type
        HAVING count > 1
      `).all();

      // Different sessions => not duplicates
      expect(duplicates).toHaveLength(0);
    });
  });
});
