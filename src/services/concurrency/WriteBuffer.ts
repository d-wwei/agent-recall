/**
 * WriteBuffer — session-scoped observation write buffer (Phase 1 concurrency safety)
 *
 * Accumulates observations in the `observation_buffer` staging table,
 * then flushes them atomically to the main `observations` table on SessionEnd.
 * This prevents write contention across concurrent sessions by serialising
 * per-session writes into a single bulk transaction.
 */

import { Database } from 'bun:sqlite';

const DEFAULT_STALE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

export class WriteBuffer {
  constructor(private db: Database) {}

  /**
   * Write a payload to the buffer table for the given session.
   * Does NOT touch the main observations table.
   */
  write(sessionId: string, payload: Record<string, any>): void {
    this.db
      .prepare('INSERT INTO observation_buffer (session_id, payload) VALUES (?, ?)')
      .run(sessionId, JSON.stringify(payload));
  }

  /**
   * Flush all buffered entries for the given sessionId into the observations table.
   *
   * Runs inside a transaction:
   *   1. SELECT all buffer rows for the session
   *   2. INSERT each into observations (payload stored as JSON in the `text` field)
   *   3. DELETE the flushed rows from the buffer
   *
   * Returns the number of rows flushed.
   */
  flush(sessionId: string): number {
    interface BufferRow {
      id: number;
      session_id: string;
      payload: string;
      created_at: string;
    }

    const rows = this.db
      .prepare('SELECT id, session_id, payload, created_at FROM observation_buffer WHERE session_id = ?')
      .all(sessionId) as BufferRow[];

    if (rows.length === 0) return 0;

    const insertObs = this.db.prepare(`
      INSERT INTO observations
        (memory_session_id, project, type, text, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const deleteBuffer = this.db.prepare('DELETE FROM observation_buffer WHERE id = ?');

    const runFlush = this.db.transaction(() => {
      for (const row of rows) {
        const payload = JSON.parse(row.payload) as Record<string, any>;
        insertObs.run(
          row.session_id,
          (payload.project as string) ?? 'unknown',
          (payload.type as string) ?? 'buffered',
          row.payload,
          row.created_at,
          new Date(row.created_at).getTime() || Date.now()
        );
        deleteBuffer.run(row.id);
      }
      return rows.length;
    });

    return runFlush() as number;
  }

  /**
   * Return the number of un-flushed entries for the given session.
   */
  getBufferedCount(sessionId: string): number {
    const result = this.db
      .prepare('SELECT COUNT(*) as cnt FROM observation_buffer WHERE session_id = ?')
      .get(sessionId) as { cnt: number };
    return result.cnt;
  }

  /**
   * Delete buffer entries that are older than `maxAgeMs` milliseconds.
   * Defaults to 24 hours.
   * Returns the number of rows deleted.
   */
  clearStale(maxAgeMs: number = DEFAULT_STALE_AGE_MS): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db
      .prepare("DELETE FROM observation_buffer WHERE created_at < ?")
      .run(cutoff);
    return result.changes;
  }
}
