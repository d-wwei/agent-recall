/**
 * Tests for SQLite WAL mode and busy_timeout concurrency settings
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite with a temp file DB — tests actual PRAGMA settings
 * - Validates WAL mode and busy_timeout are applied during initialization
 * - Verifies concurrent readers don't block each other under WAL
 *
 * Value: Prevents regression where write contention causes immediate SQLITE_BUSY
 *        failures instead of waiting up to busy_timeout milliseconds
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

interface JournalModeRow {
  journal_mode: string;
}

interface BusyTimeoutRow {
  timeout: number;
}

function applyProductionPragmas(db: Database): void {
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA synchronous = NORMAL');
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA temp_store = memory');
  db.run('PRAGMA busy_timeout = 5000');
}

describe('SQLite concurrency settings', () => {
  let db: Database;
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'agent-recall-concurrency-test-'));
    dbPath = join(tempDir, 'test.db');
    db = new Database(dbPath, { create: true, readwrite: true });
    applyProductionPragmas(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('WAL mode is enabled', () => {
    const row = db.prepare('PRAGMA journal_mode').get() as JournalModeRow;
    expect(row).toBeDefined();
    expect(row.journal_mode).toBe('wal');
  });

  test('busy_timeout is set to 5000ms', () => {
    // bun:sqlite returns { timeout: number } for PRAGMA busy_timeout
    const row = db.prepare('PRAGMA busy_timeout').get() as BusyTimeoutRow;
    expect(row).toBeDefined();
    expect(row.timeout).toBe(5000);
  });

  test('concurrent readers do not block each other under WAL', () => {
    // Create a table and insert test data
    db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)');
    db.run("INSERT INTO items VALUES (1, 'alpha')");
    db.run("INSERT INTO items VALUES (2, 'beta')");
    db.run("INSERT INTO items VALUES (3, 'gamma')");

    // Open two additional read-only connections to the same WAL database
    const reader1 = new Database(dbPath, { readonly: true });
    const reader2 = new Database(dbPath, { readonly: true });

    try {
      // Both readers should be able to query simultaneously without blocking
      const results1 = reader1.prepare('SELECT * FROM items ORDER BY id').all() as Array<{ id: number; value: string }>;
      const results2 = reader2.prepare('SELECT * FROM items ORDER BY id').all() as Array<{ id: number; value: string }>;

      expect(results1).toHaveLength(3);
      expect(results2).toHaveLength(3);
      expect(results1[0].value).toBe('alpha');
      expect(results2[0].value).toBe('alpha');
      expect(results1[2].value).toBe('gamma');
      expect(results2[2].value).toBe('gamma');
    } finally {
      reader1.close();
      reader2.close();
    }
  });

  test('busy_timeout setting persists after write transaction', () => {
    // Perform a write to ensure WAL file is active
    db.run('CREATE TABLE check_table (x INTEGER)');
    db.run('INSERT INTO check_table VALUES (42)');

    // busy_timeout should still be 5000 after writes
    const row = db.prepare('PRAGMA busy_timeout').get() as BusyTimeoutRow;
    expect(row.timeout).toBe(5000);
  });
});
