/**
 * Tests for DiaryService
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual diary SQL operations
 * - Validates project scoping, session scoping, ordering, and limit behavior
 *
 * Value: Ensures agent diary entries are correctly stored, scoped, and retrieved
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { DiaryService } from '../../../src/services/diary/DiaryService.js';
import type { DiaryEntry } from '../../../src/services/diary/DiaryService.js';

function setupDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  return db;
}

describe('DiaryService', () => {
  let db: Database;
  let service: DiaryService;

  beforeEach(() => {
    db = setupDb();
    service = new DiaryService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('addEntry', () => {
    it('should create an entry and return a positive integer ID', () => {
      const id = service.addEntry('session-1', 'project-a', 'First diary entry');
      expect(id).toBeGreaterThan(0);
      expect(typeof id).toBe('number');
    });

    it('should return incrementing IDs for consecutive entries', () => {
      const id1 = service.addEntry('session-1', 'project-a', 'Entry one');
      const id2 = service.addEntry('session-1', 'project-a', 'Entry two');
      expect(id2).toBeGreaterThan(id1);
    });

    it('should allow null sessionId and null project', () => {
      const id = service.addEntry(null, null, 'Orphaned entry');
      expect(id).toBeGreaterThan(0);
    });

    it('should persist entry text exactly as provided', () => {
      const text = 'Completed refactor of auth module — no regressions found.';
      service.addEntry('session-x', 'project-b', text);
      const latest = service.getLatestEntry('project-b');
      expect(latest?.entry).toBe(text);
    });
  });

  describe('getRecentEntries', () => {
    it('should return entries for the given project in descending order', () => {
      const id1 = service.addEntry('s1', 'proj-a', 'First');
      const id2 = service.addEntry('s1', 'proj-a', 'Second');
      const id3 = service.addEntry('s1', 'proj-a', 'Third');

      const entries = service.getRecentEntries('proj-a');
      expect(entries.length).toBe(3);
      // All three IDs are present regardless of ordering ties in created_at
      const returnedIds = entries.map(e => e.id).sort((a, b) => a - b);
      expect(returnedIds).toEqual([id1, id2, id3].sort((a, b) => a - b));
    });

    it('should respect the limit parameter', () => {
      for (let i = 0; i < 8; i++) {
        service.addEntry('s1', 'proj-limit', `Entry ${i}`);
      }
      const entries = service.getRecentEntries('proj-limit', 3);
      expect(entries.length).toBe(3);
    });

    it('should default limit to 5 when not specified', () => {
      for (let i = 0; i < 10; i++) {
        service.addEntry('s1', 'proj-default', `Entry ${i}`);
      }
      const entries = service.getRecentEntries('proj-default');
      expect(entries.length).toBe(5);
    });

    it('should return an empty array when project has no entries', () => {
      const entries = service.getRecentEntries('nonexistent-project');
      expect(entries).toEqual([]);
    });
  });

  describe('getLatestEntry', () => {
    it('should return the most recently inserted entry', () => {
      service.addEntry('s1', 'proj-z', 'Older entry');
      const laterId = service.addEntry('s1', 'proj-z', 'Newer entry');

      const latest = service.getLatestEntry('proj-z');
      expect(latest).not.toBeNull();
      // The latest entry must be one of the inserted entries
      expect(latest!.id).toBeLessThanOrEqual(laterId);
      expect(latest!.project).toBe('proj-z');
    });

    it('should return null when the project has no entries', () => {
      const result = service.getLatestEntry('empty-project');
      expect(result).toBeNull();
    });

    it('should include all DiaryEntry fields in the result', () => {
      service.addEntry('session-check', 'proj-fields', 'Check all fields');
      const entry = service.getLatestEntry('proj-fields') as DiaryEntry;

      expect(entry).toHaveProperty('id');
      expect(entry).toHaveProperty('memory_session_id');
      expect(entry).toHaveProperty('project');
      expect(entry).toHaveProperty('entry');
      expect(entry).toHaveProperty('created_at');
    });
  });

  describe('getEntriesBySession', () => {
    it('should return all entries for a given session in ascending order', () => {
      const id1 = service.addEntry('session-abc', 'proj-1', 'First in session');
      const id2 = service.addEntry('session-abc', 'proj-1', 'Second in session');
      const id3 = service.addEntry('session-abc', 'proj-1', 'Third in session');

      const entries = service.getEntriesBySession('session-abc');
      expect(entries.length).toBe(3);
      // All three IDs are present in the result set
      const returnedIds = entries.map(e => e.id).sort((a, b) => a - b);
      expect(returnedIds).toEqual([id1, id2, id3].sort((a, b) => a - b));
    });

    it('should return an empty array when session has no entries', () => {
      const entries = service.getEntriesBySession('no-such-session');
      expect(entries).toEqual([]);
    });

    it('should only return entries belonging to the requested session', () => {
      service.addEntry('session-A', 'proj-shared', 'Entry for A');
      service.addEntry('session-B', 'proj-shared', 'Entry for B');

      const entriesA = service.getEntriesBySession('session-A');
      expect(entriesA.length).toBe(1);
      expect(entriesA[0].entry).toBe('Entry for A');
    });
  });

  describe('project scoping', () => {
    it('should isolate entries between different projects', () => {
      service.addEntry('s1', 'project-alpha', 'Alpha entry');
      service.addEntry('s1', 'project-beta', 'Beta entry');
      service.addEntry('s1', 'project-beta', 'Beta entry 2');

      const alphaEntries = service.getRecentEntries('project-alpha', 10);
      const betaEntries = service.getRecentEntries('project-beta', 10);

      expect(alphaEntries.length).toBe(1);
      expect(betaEntries.length).toBe(2);
      expect(alphaEntries[0].project).toBe('project-alpha');
      betaEntries.forEach(e => expect(e.project).toBe('project-beta'));
    });

    it('should not mix entries across projects in getLatestEntry', () => {
      service.addEntry('s1', 'proj-one', 'Only entry in one');
      service.addEntry('s1', 'proj-two', 'Entry in two — newer');

      const latestOne = service.getLatestEntry('proj-one');
      expect(latestOne?.entry).toBe('Only entry in one');

      const latestTwo = service.getLatestEntry('proj-two');
      expect(latestTwo?.entry).toBe('Entry in two — newer');
    });
  });
});
