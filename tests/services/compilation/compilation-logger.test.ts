/**
 * Tests for CompilationLogger (migration 42)
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with full migrations
 * - Validates log insertion, completion, failure, history, and stats
 *
 * Value: Ensures compilation run observability works end-to-end,
 *        including duration tracking and aggregate statistics.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { CompilationLogger } from '../../../src/services/compilation/CompilationLogger.js';
import type { CompilationLog } from '../../../src/services/compilation/CompilationLogger.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  return db;
}

const PROJECT = 'test-project';
const OTHER_PROJECT = 'other-project';

// ─── startLog ────────────────────────────────────────────────────────────────

describe('startLog()', () => {
  let db: Database;
  let logger: CompilationLogger;

  beforeEach(() => {
    db = createDb();
    logger = new CompilationLogger(db);
  });

  afterEach(() => db.close());

  it('returns a positive integer ID', () => {
    const id = logger.startLog(PROJECT);
    expect(id).toBeGreaterThan(0);
  });

  it('creates a row with status running', () => {
    const id = logger.startLog(PROJECT);
    const row = db.prepare('SELECT * FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.status).toBe('running');
  });

  it('stores the project name', () => {
    const id = logger.startLog(PROJECT);
    const row = db.prepare('SELECT project FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.project).toBe(PROJECT);
  });

  it('sets started_at to a valid ISO timestamp', () => {
    const id = logger.startLog(PROJECT);
    const row = db.prepare('SELECT started_at FROM compilation_logs WHERE id = ?').get(id) as any;
    const date = new Date(row.started_at);
    expect(date.toString()).not.toBe('Invalid Date');
  });

  it('returns incrementing IDs for multiple starts', () => {
    const id1 = logger.startLog(PROJECT);
    const id2 = logger.startLog(PROJECT);
    expect(id2).toBeGreaterThan(id1);
  });

  it('completed_at is null for a new log entry', () => {
    const id = logger.startLog(PROJECT);
    const row = db.prepare('SELECT completed_at FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.completed_at).toBeNull();
  });
});

// ─── completeLog ─────────────────────────────────────────────────────────────

describe('completeLog()', () => {
  let db: Database;
  let logger: CompilationLogger;

  beforeEach(() => {
    db = createDb();
    logger = new CompilationLogger(db);
  });

  afterEach(() => db.close());

  it('sets status to success', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 10, pagesCreated: 3, pagesUpdated: 1 });
    const row = db.prepare('SELECT status FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.status).toBe('success');
  });

  it('stores observation counts', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 42, pagesCreated: 5, pagesUpdated: 2 });
    const row = db.prepare('SELECT * FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.observations_processed).toBe(42);
    expect(row.pages_created).toBe(5);
    expect(row.pages_updated).toBe(2);
  });

  it('stores tokens_used when provided', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 5, pagesCreated: 1, pagesUpdated: 0, tokensUsed: 1500 });
    const row = db.prepare('SELECT tokens_used FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.tokens_used).toBe(1500);
  });

  it('defaults tokens_used to 0 when omitted', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 5, pagesCreated: 1, pagesUpdated: 0 });
    const row = db.prepare('SELECT tokens_used FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.tokens_used).toBe(0);
  });

  it('sets completed_at to a valid timestamp', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 1, pagesCreated: 0, pagesUpdated: 0 });
    const row = db.prepare('SELECT completed_at FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.completed_at).not.toBeNull();
    expect(new Date(row.completed_at).toString()).not.toBe('Invalid Date');
  });

  it('calculates a non-negative duration_ms', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 1, pagesCreated: 0, pagesUpdated: 0 });
    const row = db.prepare('SELECT duration_ms FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('does nothing when ID does not exist', () => {
    expect(() => {
      logger.completeLog(99999, { observationsProcessed: 0, pagesCreated: 0, pagesUpdated: 0 });
    }).not.toThrow();
  });
});

// ─── failLog ──────────────────────────────────────────────────────────────────

describe('failLog()', () => {
  let db: Database;
  let logger: CompilationLogger;

  beforeEach(() => {
    db = createDb();
    logger = new CompilationLogger(db);
  });

  afterEach(() => db.close());

  it('sets status to failed', () => {
    const id = logger.startLog(PROJECT);
    logger.failLog(id, 'Connection timeout');
    const row = db.prepare('SELECT status FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.status).toBe('failed');
  });

  it('stores the error message', () => {
    const id = logger.startLog(PROJECT);
    logger.failLog(id, 'Out of memory');
    const row = db.prepare('SELECT error FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.error).toBe('Out of memory');
  });

  it('sets completed_at to a valid timestamp', () => {
    const id = logger.startLog(PROJECT);
    logger.failLog(id, 'Disk full');
    const row = db.prepare('SELECT completed_at FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.completed_at).not.toBeNull();
  });

  it('calculates a non-negative duration_ms', () => {
    const id = logger.startLog(PROJECT);
    logger.failLog(id, 'Timeout');
    const row = db.prepare('SELECT duration_ms FROM compilation_logs WHERE id = ?').get(id) as any;
    expect(row.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('does nothing when ID does not exist', () => {
    expect(() => logger.failLog(99999, 'error')).not.toThrow();
  });
});

// ─── getHistory ───────────────────────────────────────────────────────────────

describe('getHistory()', () => {
  let db: Database;
  let logger: CompilationLogger;

  beforeEach(() => {
    db = createDb();
    logger = new CompilationLogger(db);
  });

  afterEach(() => db.close());

  it('returns empty array when no runs exist', () => {
    const history = logger.getHistory(PROJECT);
    expect(history).toHaveLength(0);
  });

  it('returns logs for the specified project only', () => {
    logger.startLog(PROJECT);
    logger.startLog(OTHER_PROJECT);
    const history = logger.getHistory(PROJECT);
    expect(history).toHaveLength(1);
    expect(history[0].project).toBe(PROJECT);
  });

  it('returns logs ordered newest first', async () => {
    const id1 = logger.startLog(PROJECT);
    logger.completeLog(id1, { observationsProcessed: 1, pagesCreated: 0, pagesUpdated: 0 });
    // slight delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 5));
    const id2 = logger.startLog(PROJECT);
    logger.completeLog(id2, { observationsProcessed: 2, pagesCreated: 0, pagesUpdated: 0 });

    const history = logger.getHistory(PROJECT);
    expect(history[0].id).toBe(id2);
    expect(history[1].id).toBe(id1);
  });

  it('respects the limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      logger.startLog(PROJECT);
    }
    const history = logger.getHistory(PROJECT, 3);
    expect(history).toHaveLength(3);
  });

  it('maps all fields correctly', () => {
    const id = logger.startLog(PROJECT);
    logger.completeLog(id, { observationsProcessed: 7, pagesCreated: 2, pagesUpdated: 1, tokensUsed: 500 });
    const history = logger.getHistory(PROJECT);
    const entry = history[0];
    expect(entry.id).toBe(id);
    expect(entry.project).toBe(PROJECT);
    expect(entry.observationsProcessed).toBe(7);
    expect(entry.pagesCreated).toBe(2);
    expect(entry.pagesUpdated).toBe(1);
    expect(entry.tokensUsed).toBe(500);
    expect(entry.status).toBe('success');
  });
});

// ─── getStats ─────────────────────────────────────────────────────────────────

describe('getStats()', () => {
  let db: Database;
  let logger: CompilationLogger;

  beforeEach(() => {
    db = createDb();
    logger = new CompilationLogger(db);
  });

  afterEach(() => db.close());

  it('returns zero stats when no runs exist', () => {
    const stats = logger.getStats(PROJECT);
    expect(stats.totalRuns).toBe(0);
    expect(stats.successRate).toBe(0);
    expect(stats.avgDurationMs).toBe(0);
    expect(stats.totalTokens).toBe(0);
  });

  it('calculates 100% success rate for all successes', () => {
    const id1 = logger.startLog(PROJECT);
    logger.completeLog(id1, { observationsProcessed: 5, pagesCreated: 1, pagesUpdated: 0 });
    const id2 = logger.startLog(PROJECT);
    logger.completeLog(id2, { observationsProcessed: 3, pagesCreated: 0, pagesUpdated: 1 });

    const stats = logger.getStats(PROJECT);
    expect(stats.totalRuns).toBe(2);
    expect(stats.successRate).toBe(1.0);
  });

  it('calculates 50% success rate for mixed results', () => {
    const id1 = logger.startLog(PROJECT);
    logger.completeLog(id1, { observationsProcessed: 5, pagesCreated: 1, pagesUpdated: 0 });
    const id2 = logger.startLog(PROJECT);
    logger.failLog(id2, 'Error');

    const stats = logger.getStats(PROJECT);
    expect(stats.totalRuns).toBe(2);
    expect(stats.successRate).toBe(0.5);
  });

  it('sums tokens correctly', () => {
    const id1 = logger.startLog(PROJECT);
    logger.completeLog(id1, { observationsProcessed: 5, pagesCreated: 1, pagesUpdated: 0, tokensUsed: 1000 });
    const id2 = logger.startLog(PROJECT);
    logger.completeLog(id2, { observationsProcessed: 3, pagesCreated: 0, pagesUpdated: 1, tokensUsed: 2000 });

    const stats = logger.getStats(PROJECT);
    expect(stats.totalTokens).toBe(3000);
  });

  it('only counts runs for the specified project', () => {
    const id1 = logger.startLog(PROJECT);
    logger.completeLog(id1, { observationsProcessed: 5, pagesCreated: 1, pagesUpdated: 0 });
    const id2 = logger.startLog(OTHER_PROJECT);
    logger.completeLog(id2, { observationsProcessed: 3, pagesCreated: 1, pagesUpdated: 0 });

    const stats = logger.getStats(PROJECT);
    expect(stats.totalRuns).toBe(1);
  });
});
