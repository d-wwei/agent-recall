/**
 * EmergencySave - Last-resort data preservation on process termination
 *
 * When the Worker receives SIGTERM/SIGHUP/SIGINT (terminal closing), this module
 * saves as much data as possible before the process exits:
 *   1. Flush all WriteBuffers (observation_buffer → observations)
 *   2. Save checkpoints for active sessions
 *   3. Mark active sessions as 'interrupted'
 */

import { Database } from 'bun:sqlite';
import { WriteBuffer } from '../concurrency/WriteBuffer.js';
import { CheckpointService } from './CheckpointService.js';
import { markSessionInterrupted } from './StaleBufferRecovery.js';
import { logger } from '../../utils/logger.js';

export interface EmergencySaveResult {
  buffersFlushed: number;
  checkpointsSaved: number;
  sessionsInterrupted: number;
}

/**
 * Perform emergency save: flush buffers, save checkpoints, mark sessions interrupted.
 *
 * This is designed to be called during graceful shutdown (SIGTERM/SIGHUP/SIGINT).
 * Every operation is wrapped in try/catch to ensure one failure doesn't block others.
 *
 * @param db - The SQLite database connection
 * @returns Summary of what was saved
 */
export function performEmergencySave(db: Database): EmergencySaveResult {
  const result: EmergencySaveResult = {
    buffersFlushed: 0,
    checkpointsSaved: 0,
    sessionsInterrupted: 0,
  };

  logger.info('SYSTEM', 'Emergency save triggered — flushing buffers and saving checkpoints');

  // 1. Flush all WriteBuffers
  try {
    const buffer = new WriteBuffer(db);
    const sessions = db.prepare(
      'SELECT DISTINCT session_id FROM observation_buffer'
    ).all() as { session_id: string }[];

    for (const { session_id } of sessions) {
      try {
        const flushed = buffer.flush(session_id);
        result.buffersFlushed += flushed;
      } catch (err) {
        // Best effort: FK failure means session doesn't exist, clean up
        logger.warn('SYSTEM', `Emergency flush failed for session ${session_id}`, {
          error: err instanceof Error ? err.message : String(err)
        });
        try {
          db.prepare('DELETE FROM observation_buffer WHERE session_id = ?').run(session_id);
        } catch {
          // Ignore cleanup failures during emergency save
        }
      }
    }
  } catch (err) {
    logger.warn('SYSTEM', 'Emergency buffer flush failed', {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  // 2. Save checkpoint for active sessions and mark them as interrupted
  try {
    const activeSessions = db.prepare(
      "SELECT id, content_session_id, project, started_at_epoch FROM sdk_sessions WHERE status = 'active'"
    ).all() as { id: number; content_session_id: string; project: string; started_at_epoch: number }[];

    const checkpointService = new CheckpointService(db);

    for (const session of activeSessions) {
      // Save checkpoint (best effort per session)
      try {
        const observations = db.prepare(
          'SELECT * FROM observations WHERE memory_session_id = ? ORDER BY created_at_epoch DESC LIMIT 20'
        ).all(session.content_session_id) as any[];

        if (observations.length > 0) {
          const checkpoint = checkpointService.buildCheckpointFromObservations(
            session.project,
            session.content_session_id,
            observations,
            null  // no user prompt available during emergency save
          );
          checkpoint.resumeHint = 'Session was interrupted by terminal close. ' + checkpoint.resumeHint;
          checkpointService.saveCheckpoint(session.project, session.content_session_id, checkpoint);
          result.checkpointsSaved++;
        }
      } catch (err) {
        // Best effort — don't let one session's save failure block others
        logger.warn('SYSTEM', `Emergency checkpoint save failed for session ${session.content_session_id}`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }

      // Mark session as interrupted
      try {
        markSessionInterrupted(db, session.content_session_id);
        result.sessionsInterrupted++;
      } catch (err) {
        logger.warn('SYSTEM', `Failed to mark session ${session.content_session_id} as interrupted`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
  } catch (err) {
    logger.warn('SYSTEM', 'Emergency checkpoint/session marking failed', {
      error: err instanceof Error ? err.message : String(err)
    });
  }

  logger.info('SYSTEM', 'Emergency save completed', {
    buffersFlushed: result.buffersFlushed,
    checkpointsSaved: result.checkpointsSaved,
    sessionsInterrupted: result.sessionsInterrupted,
  });

  return result;
}
