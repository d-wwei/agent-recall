/**
 * Tests for ActivityLog service (migration 38)
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual SQL
 * - Validates log insertion, retrieval, filtering, and formatting
 *
 * Value: Ensures activity_log operations work correctly end-to-end
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../src/services/sqlite/migrations/runner.js';
import { ActivityLog } from '../../src/services/logging/ActivityLog.js';
import type { ActivityEntry, ActivityOperation } from '../../src/services/logging/ActivityLog.js';

function createDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  return db;
}

describe('ActivityLog', () => {
  let db: Database;
  let log: ActivityLog;

  beforeEach(() => {
    db = createDb();
    log = new ActivityLog(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── log() ───────────────────────────────────────────────────────────────

  describe('log()', () => {
    it('creates an entry and returns a positive ID', () => {
      const id = log.log('session', 'Started test-project', 'User asked to refactor auth module');
      expect(id).toBeGreaterThan(0);
    });

    it('persists the entry in the database', () => {
      log.log('ingest', 'Ingested docs', '42 files processed', 'my-project');
      const rows = db.prepare('SELECT * FROM activity_log').all() as ActivityEntry[];
      expect(rows).toHaveLength(1);
      expect(rows[0].operation).toBe('ingest');
      expect(rows[0].title).toBe('Ingested docs');
      expect(rows[0].summary).toBe('42 files processed');
      expect(rows[0].project).toBe('my-project');
    });

    it('stores null project when project is omitted', () => {
      log.log('query', 'Search: auth middleware', '5 results, fusion ranked');
      const row = db.prepare('SELECT project FROM activity_log LIMIT 1').get() as { project: string | null };
      expect(row.project).toBeNull();
    });

    it('increments IDs across multiple insertions', () => {
      const id1 = log.log('session', 'First', 'Summary 1');
      const id2 = log.log('compile', 'Second', 'Summary 2');
      expect(id2).toBeGreaterThan(id1);
    });

    it('accepts all valid operation types without error', () => {
      const ops: ActivityOperation[] = ['session', 'ingest', 'query', 'lint', 'bootstrap', 'compile', 'export'];
      for (const op of ops) {
        const id = log.log(op, `Title for ${op}`, `Summary for ${op}`);
        expect(id).toBeGreaterThan(0);
      }
      const count = (db.prepare('SELECT COUNT(*) as c FROM activity_log').get() as { c: number }).c;
      expect(count).toBe(ops.length);
    });
  });

  // ─── getRecent() ─────────────────────────────────────────────────────────

  describe('getRecent()', () => {
    it('returns an empty array when the log is empty', () => {
      const entries = log.getRecent();
      expect(entries).toEqual([]);
    });

    it('returns entries ordered newest-first', () => {
      log.log('session', 'First', 'S1');
      log.log('ingest', 'Second', 'S2');
      log.log('query', 'Third', 'S3');

      const entries = log.getRecent();
      expect(entries[0].title).toBe('Third');
      expect(entries[1].title).toBe('Second');
      expect(entries[2].title).toBe('First');
    });

    it('defaults to 20 entries when limit is not provided', () => {
      for (let i = 0; i < 25; i++) {
        log.log('session', `Entry ${i}`, `Summary ${i}`);
      }
      const entries = log.getRecent();
      expect(entries).toHaveLength(20);
    });

    it('respects a custom limit', () => {
      for (let i = 0; i < 10; i++) {
        log.log('session', `Entry ${i}`, `Summary ${i}`);
      }
      const entries = log.getRecent(5);
      expect(entries).toHaveLength(5);
    });

    it('returns all entries when limit exceeds total count', () => {
      log.log('export', 'Exported', 'Done');
      const entries = log.getRecent(100);
      expect(entries).toHaveLength(1);
    });
  });

  // ─── getByOperation() ────────────────────────────────────────────────────

  describe('getByOperation()', () => {
    beforeEach(() => {
      log.log('session', 'Session start', 'Started');
      log.log('compile', 'Compile 1', 'Done');
      log.log('session', 'Session end', 'Ended');
      log.log('export', 'Export run', 'Exported 10');
      log.log('compile', 'Compile 2', 'Done again');
    });

    it('filters entries by operation type', () => {
      const compileEntries = log.getByOperation('compile');
      expect(compileEntries).toHaveLength(2);
      for (const e of compileEntries) {
        expect(e.operation).toBe('compile');
      }
    });

    it('returns empty array when no entries match the operation', () => {
      const lintEntries = log.getByOperation('lint');
      expect(lintEntries).toEqual([]);
    });

    it('orders results newest-first', () => {
      const sessionEntries = log.getByOperation('session');
      expect(sessionEntries[0].title).toBe('Session end');
      expect(sessionEntries[1].title).toBe('Session start');
    });

    it('respects a custom limit within the filtered set', () => {
      const entries = log.getByOperation('session', 1);
      expect(entries).toHaveLength(1);
      expect(entries[0].title).toBe('Session end'); // newest
    });
  });

  // ─── format() ────────────────────────────────────────────────────────────

  describe('format()', () => {
    it('produces the correct [YYYY-MM-DD] operation | title — summary format', () => {
      const entry: ActivityEntry = {
        id: 1,
        operation: 'session',
        title: 'Started project-x',
        summary: 'User asked to refactor auth module',
        project: null,
        created_at: '2026-04-09 14:30:00',
      };
      const formatted = log.format(entry);
      expect(formatted).toBe('[2026-04-09] session | Started project-x \u2014 User asked to refactor auth module');
    });

    it('uses the ISO date prefix from created_at even when time part varies', () => {
      const entry: ActivityEntry = {
        id: 2,
        operation: 'compile',
        title: 'Knowledge compiled',
        summary: '3 pages created, 15 observations processed',
        project: 'some-project',
        created_at: '2026-04-09T09:00:00.000Z',
      };
      const formatted = log.format(entry);
      expect(formatted).toStartWith('[2026-04-09]');
      expect(formatted).toContain('compile | Knowledge compiled');
    });
  });

  // ─── formatAll() ─────────────────────────────────────────────────────────

  describe('formatAll()', () => {
    it('returns an empty string for an empty array', () => {
      expect(log.formatAll([])).toBe('');
    });

    it('formats a single entry correctly', () => {
      const entry: ActivityEntry = {
        id: 1,
        operation: 'query',
        title: 'Search: auth middleware',
        summary: '5 results, fusion ranked',
        project: null,
        created_at: '2026-04-09 10:00:00',
      };
      const result = log.formatAll([entry]);
      expect(result).toBe('[2026-04-09] query | Search: auth middleware \u2014 5 results, fusion ranked');
    });

    it('joins multiple entries with newlines', () => {
      const entries: ActivityEntry[] = [
        { id: 1, operation: 'session', title: 'A', summary: 'SA', project: null, created_at: '2026-04-09 08:00:00' },
        { id: 2, operation: 'compile', title: 'B', summary: 'SB', project: null, created_at: '2026-04-09 09:00:00' },
        { id: 3, operation: 'export', title: 'C', summary: 'SC', project: null, created_at: '2026-04-09 10:00:00' },
      ];
      const result = log.formatAll(entries);
      const lines = result.split('\n');
      expect(lines).toHaveLength(3);
      expect(lines[0]).toContain('session | A');
      expect(lines[1]).toContain('compile | B');
      expect(lines[2]).toContain('export | C');
    });
  });

  // ─── Migration 38 ────────────────────────────────────────────────────────

  describe('Migration 38', () => {
    it('creates the activity_log table', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='activity_log'")
        .get() as { name: string } | undefined;
      expect(row).toBeDefined();
      expect(row!.name).toBe('activity_log');
    });

    it('records version 38 in schema_versions', () => {
      const row = db
        .prepare('SELECT version FROM schema_versions WHERE version = 38')
        .get() as { version: number } | undefined;
      expect(row).toBeDefined();
      expect(row!.version).toBe(38);
    });

    it('migration is idempotent when run twice', () => {
      const runner = new MigrationRunner(db);
      // Should not throw
      expect(() => runner.runAllMigrations()).not.toThrow();
      const count = (
        db.prepare('SELECT COUNT(*) as c FROM schema_versions WHERE version = 38').get() as { c: number }
      ).c;
      expect(count).toBe(1);
    });
  });
});
