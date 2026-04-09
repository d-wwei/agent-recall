/**
 * Tests for WriteBuffer — session-scoped observation write buffer
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with manually created tables
 * - Tests actual SQL semantics: INSERT, SELECT, DELETE, transactions
 *
 * Coverage:
 * 1. write() adds to buffer, NOT to observations
 * 2. flush() moves session entries to observations table
 * 3. flush() only affects the specified sessionId
 * 4. getBufferedCount() returns correct count
 * 5. clearStale() removes old entries (and only old entries)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { WriteBuffer } from '../../../src/services/concurrency/WriteBuffer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ObservationRow {
  id: number;
  memory_session_id: string;
  text: string;
}

interface BufferRow {
  id: number;
  session_id: string;
  payload: string;
  created_at: string;
}

function countObservations(db: Database, sessionId?: string): number {
  if (sessionId) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM observations WHERE memory_session_id = ?').get(sessionId) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM observations').get() as { cnt: number };
  return row.cnt;
}

function countBuffer(db: Database, sessionId?: string): number {
  if (sessionId) {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM observation_buffer WHERE session_id = ?').get(sessionId) as { cnt: number };
    return row.cnt;
  }
  const row = db.prepare('SELECT COUNT(*) as cnt FROM observation_buffer').get() as { cnt: number };
  return row.cnt;
}

// ---------------------------------------------------------------------------
// Schema setup — create tables in-memory (no migrations needed for unit tests)
// ---------------------------------------------------------------------------

function createSchema(db: Database): void {
  // Minimal observations table (only the columns WriteBuffer.flush() uses)
  db.run(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL DEFAULT 'unknown',
      type TEXT NOT NULL DEFAULT 'buffered',
      text TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS observation_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_observation_buffer_session ON observation_buffer(session_id)');
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('WriteBuffer', () => {
  let db: Database;
  let buffer: WriteBuffer;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA journal_mode = WAL');
    createSchema(db);
    buffer = new WriteBuffer(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // 1. write() adds to buffer, NOT to observations
  // -------------------------------------------------------------------------
  describe('write()', () => {
    it('inserts a row into observation_buffer', () => {
      buffer.write('session-A', { type: 'tool_use', project: 'my-project' });

      expect(countBuffer(db, 'session-A')).toBe(1);
    });

    it('does NOT insert into the observations table', () => {
      buffer.write('session-A', { type: 'tool_use', project: 'my-project' });

      expect(countObservations(db)).toBe(0);
    });

    it('serialises the payload as JSON', () => {
      const payload = { type: 'file_read', project: 'proj', extra: [1, 2, 3] };
      buffer.write('session-A', payload);

      const row = db.prepare('SELECT payload FROM observation_buffer WHERE session_id = ?').get('session-A') as BufferRow;
      expect(JSON.parse(row.payload)).toEqual(payload);
    });

    it('supports multiple writes per session', () => {
      buffer.write('session-A', { type: 'a' });
      buffer.write('session-A', { type: 'b' });
      buffer.write('session-A', { type: 'c' });

      expect(countBuffer(db, 'session-A')).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // 2. flush() moves session entries to observations
  // -------------------------------------------------------------------------
  describe('flush()', () => {
    it('moves all buffered entries to observations table', () => {
      buffer.write('session-A', { type: 'tool_use', project: 'proj' });
      buffer.write('session-A', { type: 'file_read', project: 'proj' });

      const flushed = buffer.flush('session-A');

      expect(flushed).toBe(2);
      expect(countObservations(db, 'session-A')).toBe(2);
      expect(countBuffer(db, 'session-A')).toBe(0);
    });

    it('removes flushed entries from buffer', () => {
      buffer.write('session-A', { type: 'tool_use', project: 'proj' });
      buffer.flush('session-A');

      expect(countBuffer(db)).toBe(0);
    });

    it('returns 0 when buffer is empty for session', () => {
      const flushed = buffer.flush('no-such-session');
      expect(flushed).toBe(0);
    });

    it('persists the payload as the text field in observations', () => {
      const payload = { type: 'tool_use', project: 'test-project', extra: 'value' };
      buffer.write('session-A', payload);
      buffer.flush('session-A');

      const obs = db.prepare('SELECT text FROM observations WHERE memory_session_id = ?').get('session-A') as ObservationRow;
      expect(JSON.parse(obs.text)).toEqual(payload);
    });

    it('uses project from payload when available', () => {
      buffer.write('session-A', { type: 'x', project: 'my-proj' });
      buffer.flush('session-A');

      const obs = db.prepare('SELECT project FROM observations WHERE memory_session_id = ?').get('session-A') as { project: string };
      expect(obs.project).toBe('my-proj');
    });

    it('falls back to "unknown" when payload has no project', () => {
      buffer.write('session-A', { type: 'x' });
      buffer.flush('session-A');

      const obs = db.prepare('SELECT project FROM observations WHERE memory_session_id = ?').get('session-A') as { project: string };
      expect(obs.project).toBe('unknown');
    });
  });

  // -------------------------------------------------------------------------
  // 3. flush() only affects the specified sessionId
  // -------------------------------------------------------------------------
  describe('flush() session isolation', () => {
    it('does not flush entries belonging to other sessions', () => {
      buffer.write('session-A', { type: 'a', project: 'p' });
      buffer.write('session-B', { type: 'b', project: 'p' });
      buffer.write('session-B', { type: 'c', project: 'p' });

      buffer.flush('session-A');

      // session-A observations flushed; session-B still buffered
      expect(countObservations(db, 'session-A')).toBe(1);
      expect(countObservations(db, 'session-B')).toBe(0);
      expect(countBuffer(db, 'session-B')).toBe(2);
    });

    it('returns only the count of flushed session rows', () => {
      buffer.write('session-A', { type: 'a', project: 'p' });
      buffer.write('session-B', { type: 'b', project: 'p' });

      const flushed = buffer.flush('session-A');

      expect(flushed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. getBufferedCount() returns correct count
  // -------------------------------------------------------------------------
  describe('getBufferedCount()', () => {
    it('returns 0 for an unknown session', () => {
      expect(buffer.getBufferedCount('ghost-session')).toBe(0);
    });

    it('returns the correct count after writes', () => {
      buffer.write('session-A', { type: 'x' });
      buffer.write('session-A', { type: 'y' });

      expect(buffer.getBufferedCount('session-A')).toBe(2);
    });

    it('returns 0 after flush', () => {
      buffer.write('session-A', { type: 'x' });
      buffer.flush('session-A');

      expect(buffer.getBufferedCount('session-A')).toBe(0);
    });

    it('is session-scoped — does not count other sessions', () => {
      buffer.write('session-A', { type: 'a' });
      buffer.write('session-B', { type: 'b' });
      buffer.write('session-B', { type: 'c' });

      expect(buffer.getBufferedCount('session-A')).toBe(1);
      expect(buffer.getBufferedCount('session-B')).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 5. clearStale() removes old entries (and only old entries)
  // -------------------------------------------------------------------------
  describe('clearStale()', () => {
    it('removes entries older than maxAgeMs', () => {
      // Insert a row with a created_at far in the past
      const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(); // 48h ago
      db.prepare("INSERT INTO observation_buffer (session_id, payload, created_at) VALUES (?, ?, ?)").run(
        'stale-session', '{"type":"old"}', oldDate
      );

      const deleted = buffer.clearStale(24 * 60 * 60 * 1000); // 24h window

      expect(deleted).toBe(1);
      expect(countBuffer(db)).toBe(0);
    });

    it('keeps entries newer than maxAgeMs', () => {
      // Insert a row with a recent created_at (default datetime('now'))
      buffer.write('fresh-session', { type: 'new' });

      const deleted = buffer.clearStale(24 * 60 * 60 * 1000);

      expect(deleted).toBe(0);
      expect(countBuffer(db, 'fresh-session')).toBe(1);
    });

    it('removes only stale entries, leaves fresh ones', () => {
      const oldDate = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(); // 36h ago
      db.prepare("INSERT INTO observation_buffer (session_id, payload, created_at) VALUES (?, ?, ?)").run(
        'old-session', '{"type":"old"}', oldDate
      );
      buffer.write('new-session', { type: 'new' });

      const deleted = buffer.clearStale(24 * 60 * 60 * 1000);

      expect(deleted).toBe(1);
      expect(countBuffer(db, 'old-session')).toBe(0);
      expect(countBuffer(db, 'new-session')).toBe(1);
    });

    it('uses 24h as default maxAgeMs', () => {
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25h ago
      db.prepare("INSERT INTO observation_buffer (session_id, payload, created_at) VALUES (?, ?, ?)").run(
        'stale-session', '{"type":"old"}', oldDate
      );

      // Call without arguments — should use 24h default
      const deleted = buffer.clearStale();

      expect(deleted).toBe(1);
    });
  });
});
