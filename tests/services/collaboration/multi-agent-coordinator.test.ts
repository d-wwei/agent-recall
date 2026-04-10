/**
 * Tests for MultiAgentCoordinator — cross-session awareness and file conflict detection.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with all required tables
 *
 * Value: Verifies active session queries, file conflict detection,
 *        observation propagation, and propagated discovery retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MultiAgentCoordinator } from '../../../src/services/collaboration/MultiAgentCoordinator.js';
import type { SessionInfo, FileConflict } from '../../../src/services/collaboration/MultiAgentCoordinator.js';

const PROJECT = 'test-project';

function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE schema_versions (
      id INTEGER PRIMARY KEY,
      version INTEGER UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      memory_session_id TEXT UNIQUE,
      project TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT '',
      started_at_epoch INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      text TEXT,
      type TEXT NOT NULL,
      title TEXT,
      narrative TEXT,
      concepts TEXT,
      files_read TEXT,
      files_modified TEXT,
      propagated INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT '',
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}

function insertSession(db: Database, contentId: string, memoryId: string, project: string, status: string = 'active', epoch: number = Date.now()): void {
  db.prepare(`
    INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, status, started_at, started_at_epoch)
    VALUES (?, ?, ?, ?, datetime('now'), ?)
  `).run(contentId, memoryId, project, status, epoch);
}

function insertObservation(db: Database, memorySessionId: string, project: string, opts: {
  type?: string; title?: string; narrative?: string; concepts?: string;
  filesModified?: string; epoch?: number; propagated?: number;
} = {}): number {
  const result = db.prepare(`
    INSERT INTO observations (memory_session_id, project, text, type, title, narrative, concepts, files_modified, propagated, created_at, created_at_epoch)
    VALUES (?, ?, 'test', ?, ?, ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    memorySessionId, project,
    opts.type || 'discovery',
    opts.title || null,
    opts.narrative || null,
    opts.concepts || null,
    opts.filesModified || null,
    opts.propagated || 0,
    opts.epoch || Date.now()
  );
  return Number(result.lastInsertRowid);
}

describe('MultiAgentCoordinator', () => {
  let db: Database;
  let coordinator: MultiAgentCoordinator;

  beforeEach(() => {
    db = createTestDb();
    coordinator = new MultiAgentCoordinator(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── getActiveSessions ───────────────────────────────────────────────────

  describe('getActiveSessions', () => {
    it('returns empty array when no sessions exist', () => {
      const sessions = coordinator.getActiveSessions(PROJECT);
      expect(sessions).toEqual([]);
    });

    it('returns only active sessions for the given project', () => {
      insertSession(db, 'session-1', 'mem-1', PROJECT, 'active', 1000);
      insertSession(db, 'session-2', 'mem-2', PROJECT, 'completed', 2000);
      insertSession(db, 'session-3', 'mem-3', 'other-project', 'active', 3000);

      const sessions = coordinator.getActiveSessions(PROJECT);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].sessionId).toBe('session-1');
      expect(sessions[0].project).toBe(PROJECT);
    });

    it('returns multiple active sessions sorted by start time desc', () => {
      insertSession(db, 'session-a', 'mem-a', PROJECT, 'active', 1000);
      insertSession(db, 'session-b', 'mem-b', PROJECT, 'active', 3000);
      insertSession(db, 'session-c', 'mem-c', PROJECT, 'active', 2000);

      const sessions = coordinator.getActiveSessions(PROJECT);
      expect(sessions).toHaveLength(3);
      expect(sessions[0].sessionId).toBe('session-b');
      expect(sessions[1].sessionId).toBe('session-c');
      expect(sessions[2].sessionId).toBe('session-a');
    });

    it('uses observation epoch as lastActivity when available', () => {
      insertSession(db, 'session-1', 'mem-1', PROJECT, 'active', 1000);
      insertObservation(db, 'mem-1', PROJECT, { epoch: 5000 });

      const sessions = coordinator.getActiveSessions(PROJECT);
      expect(sessions).toHaveLength(1);
      expect(sessions[0].startedAt).toBe(1000);
      expect(sessions[0].lastActivity).toBe(5000);
    });

    it('falls back to startedAt when no observations exist', () => {
      insertSession(db, 'session-1', 'mem-1', PROJECT, 'active', 1000);

      const sessions = coordinator.getActiveSessions(PROJECT);
      expect(sessions[0].lastActivity).toBe(1000);
    });
  });

  // ─── detectFileConflicts ─────────────────────────────────────────────────

  describe('detectFileConflicts', () => {
    it('returns empty array when no conflicts exist', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertObservation(db, 'm1', PROJECT, { filesModified: '["src/a.ts"]' });

      const conflicts = coordinator.detectFileConflicts(PROJECT);
      expect(conflicts).toEqual([]);
    });

    it('detects files modified by multiple active sessions', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertSession(db, 's2', 'm2', PROJECT, 'active', 2000);

      insertObservation(db, 'm1', PROJECT, { filesModified: '["src/shared.ts", "src/a.ts"]' });
      insertObservation(db, 'm2', PROJECT, { filesModified: '["src/shared.ts", "src/b.ts"]' });

      const conflicts = coordinator.detectFileConflicts(PROJECT);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file).toBe('src/shared.ts');
      expect(conflicts[0].sessions).toContain('s1');
      expect(conflicts[0].sessions).toContain('s2');
    });

    it('ignores completed sessions', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertSession(db, 's2', 'm2', PROJECT, 'completed', 2000);

      insertObservation(db, 'm1', PROJECT, { filesModified: '["src/shared.ts"]' });
      insertObservation(db, 'm2', PROJECT, { filesModified: '["src/shared.ts"]' });

      const conflicts = coordinator.detectFileConflicts(PROJECT);
      expect(conflicts).toEqual([]);
    });

    it('handles comma-separated file format', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertSession(db, 's2', 'm2', PROJECT, 'active', 2000);

      insertObservation(db, 'm1', PROJECT, { filesModified: 'src/x.ts, src/y.ts' });
      insertObservation(db, 'm2', PROJECT, { filesModified: 'src/x.ts' });

      const conflicts = coordinator.detectFileConflicts(PROJECT);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].file).toBe('src/x.ts');
    });

    it('ignores observations with null files_modified', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertObservation(db, 'm1', PROJECT, { filesModified: undefined });

      const conflicts = coordinator.detectFileConflicts(PROJECT);
      expect(conflicts).toEqual([]);
    });
  });

  // ─── propagateDiscovery ──────────────────────────────────────────────────

  describe('propagateDiscovery', () => {
    it('marks an observation as propagated', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      const obsId = insertObservation(db, 'm1', PROJECT, { title: 'finding' });

      coordinator.propagateDiscovery('s1', obsId);

      const row = db.prepare('SELECT propagated FROM observations WHERE id = ?').get(obsId) as any;
      expect(row.propagated).toBe(1);
    });

    it('does nothing if observation does not belong to session', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertSession(db, 's2', 'm2', PROJECT, 'active', 2000);
      const obsId = insertObservation(db, 'm1', PROJECT, { title: 'finding' });

      coordinator.propagateDiscovery('s2', obsId);

      const row = db.prepare('SELECT propagated FROM observations WHERE id = ?').get(obsId) as any;
      expect(row.propagated).toBe(0);
    });

    it('does nothing for non-existent observation', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      // Should not throw
      coordinator.propagateDiscovery('s1', 9999);
    });
  });

  // ─── getPropagatedDiscoveries ────────────────────────────────────────────

  describe('getPropagatedDiscoveries', () => {
    it('returns empty array when no propagated observations exist', () => {
      const results = coordinator.getPropagatedDiscoveries(PROJECT, 0);
      expect(results).toEqual([]);
    });

    it('returns only propagated observations since the given epoch', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertObservation(db, 'm1', PROJECT, { title: 'old', epoch: 500, propagated: 1 });
      insertObservation(db, 'm1', PROJECT, { title: 'recent', epoch: 2000, propagated: 1 });
      insertObservation(db, 'm1', PROJECT, { title: 'not-propagated', epoch: 3000, propagated: 0 });

      const results = coordinator.getPropagatedDiscoveries(PROJECT, 1000);
      expect(results).toHaveLength(1);
      expect((results[0] as any).title).toBe('recent');
    });

    it('includes source session information', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertObservation(db, 'm1', PROJECT, { title: 'discovery', epoch: 2000, propagated: 1 });

      const results = coordinator.getPropagatedDiscoveries(PROJECT, 0);
      expect(results).toHaveLength(1);
      expect((results[0] as any).source_session).toBe('s1');
    });

    it('returns results ordered by epoch desc', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertObservation(db, 'm1', PROJECT, { title: 'first', epoch: 2000, propagated: 1 });
      insertObservation(db, 'm1', PROJECT, { title: 'second', epoch: 4000, propagated: 1 });
      insertObservation(db, 'm1', PROJECT, { title: 'third', epoch: 3000, propagated: 1 });

      const results = coordinator.getPropagatedDiscoveries(PROJECT, 0);
      expect(results).toHaveLength(3);
      expect((results[0] as any).title).toBe('second');
      expect((results[1] as any).title).toBe('third');
      expect((results[2] as any).title).toBe('first');
    });

    it('filters by project', () => {
      insertSession(db, 's1', 'm1', PROJECT, 'active', 1000);
      insertSession(db, 's2', 'm2', 'other-project', 'active', 1000);
      insertObservation(db, 'm1', PROJECT, { title: 'mine', epoch: 2000, propagated: 1 });
      insertObservation(db, 'm2', 'other-project', { title: 'theirs', epoch: 2000, propagated: 1 });

      const results = coordinator.getPropagatedDiscoveries(PROJECT, 0);
      expect(results).toHaveLength(1);
      expect((results[0] as any).title).toBe('mine');
    });
  });
});
