/**
 * StaleBufferRecovery - Recovers unflushed observation buffers on Worker startup
 *
 * When the user closes the terminal unexpectedly, WriteBuffer may have unflushed
 * observations in the observation_buffer staging table. On next Worker startup,
 * this service detects and recovers those entries by flushing them to the main
 * observations table and marking the associated sessions as 'interrupted'.
 */

import { Database } from 'bun:sqlite';
import { WriteBuffer } from '../concurrency/WriteBuffer.js';
import { logger } from '../../utils/logger.js';

/**
 * Recover stale observation buffers left by interrupted sessions.
 *
 * Called early in Worker background initialization, after migrations run.
 * Flushes all orphaned buffer entries to the observations table and marks
 * the associated sessions as 'interrupted'.
 *
 * @returns Number of observations recovered
 */
export function recoverStaleBuffers(db: Database): number {
  // Check if observation_buffer has any orphaned entries
  const staleEntries = db.prepare(
    'SELECT COUNT(*) as count FROM observation_buffer'
  ).get() as { count: number } | null;

  if (!staleEntries || staleEntries.count === 0) return 0;

  // These are from sessions that didn't complete properly
  const buffer = new WriteBuffer(db);

  // Get distinct session IDs from buffer
  const sessions = db.prepare(
    'SELECT DISTINCT session_id FROM observation_buffer'
  ).all() as { session_id: string }[];

  let recovered = 0;
  for (const { session_id } of sessions) {
    try {
      const flushed = buffer.flush(session_id);
      recovered += flushed;

      if (flushed > 0) {
        logger.info('SYSTEM', `Recovered ${flushed} stale observations from interrupted session`, { session_id });
      }

      // Mark the session as 'interrupted' (not 'completed' or 'active')
      markSessionInterrupted(db, session_id);
    } catch (err) {
      // FK constraint failure means the session doesn't exist in sdk_sessions.
      // Clear the orphaned buffer entries instead of leaving them permanently.
      logger.warn('SYSTEM', `Failed to flush buffer for session ${session_id}, clearing orphaned entries`, {
        error: err instanceof Error ? err.message : String(err)
      });
      db.prepare('DELETE FROM observation_buffer WHERE session_id = ?').run(session_id);
    }
  }

  if (recovered > 0) {
    logger.info('SYSTEM', `Stale buffer recovery complete: ${recovered} observations recovered from ${sessions.length} session(s)`);
  }

  return recovered;
}

/**
 * Mark a session as 'interrupted' by session ID.
 * Matches on both content_session_id and memory_session_id since
 * the observation_buffer stores whichever session ID was used.
 */
export function markSessionInterrupted(db: Database, sessionId: string): void {
  // Try matching content_session_id first (most common)
  const result1 = db.prepare(
    "UPDATE sdk_sessions SET status = 'interrupted' WHERE content_session_id = ? AND status = 'active'"
  ).run(sessionId);

  if (result1.changes > 0) return;

  // Fall back to matching memory_session_id
  db.prepare(
    "UPDATE sdk_sessions SET status = 'interrupted' WHERE memory_session_id = ? AND status = 'active'"
  ).run(sessionId);
}
