/**
 * DataRetentionService
 *
 * Provides configurable data lifecycle cleanup for observations, summaries,
 * and orphaned sessions. All destructive operations run inside a transaction
 * so either everything succeeds or nothing changes.
 *
 * Design:
 * - preview() shows what WOULD be deleted without touching data
 * - execute() performs the actual cleanup (supports dryRun mode)
 * - getStats() returns current database size/counts
 * - Never deletes sessions that are still processing
 * - Observations and summaries have independent retention periods
 * - Orphaned sessions (no observations AND no summaries) are cleaned up
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface CleanupPreview {
  observations_to_delete: number;
  summaries_to_delete: number;
  sessions_to_cleanup: number;
  oldest_observation_date: string | null;
  newest_deletion_date: string | null;
}

export interface CleanupResult extends CleanupPreview {
  executed: boolean;
  duration_ms: number;
}

export interface DatabaseStats {
  total_observations: number;
  total_summaries: number;
  total_sessions: number;
  total_prompts: number;
  db_size_bytes: number;
  oldest_record: string | null;
  newest_record: string | null;
}

export class DataRetentionService {
  /**
   * Preview what would be deleted without making any changes.
   */
  static preview(
    db: Database,
    retentionDays: number,
    summaryRetentionDays: number
  ): CleanupPreview {
    const obsCutoffEpoch = Date.now() - (retentionDays * 86_400_000);
    const summaryCutoffEpoch = Date.now() - (summaryRetentionDays * 86_400_000);

    // Count observations eligible for deletion
    // Exclude observations belonging to active/processing sessions
    const obsCount = db.prepare(`
      SELECT COUNT(*) as count FROM observations
      WHERE created_at_epoch < ?
        AND memory_session_id NOT IN (
          SELECT memory_session_id FROM sdk_sessions
          WHERE status = 'active' AND memory_session_id IS NOT NULL
        )
    `).get(obsCutoffEpoch) as { count: number };

    // Count summaries eligible for deletion
    // Exclude summaries belonging to active/processing sessions
    const sumCount = db.prepare(`
      SELECT COUNT(*) as count FROM session_summaries
      WHERE created_at_epoch < ?
        AND memory_session_id NOT IN (
          SELECT memory_session_id FROM sdk_sessions
          WHERE status = 'active' AND memory_session_id IS NOT NULL
        )
    `).get(summaryCutoffEpoch) as { count: number };

    // Count orphan sessions that would be cleaned up:
    // Sessions that have no observations AND no summaries AND are not active
    const orphanCount = db.prepare(`
      SELECT COUNT(*) as count FROM sdk_sessions s
      WHERE s.status != 'active'
        AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.memory_session_id = s.memory_session_id)
        AND NOT EXISTS (SELECT 1 FROM session_summaries ss WHERE ss.memory_session_id = s.memory_session_id)
        AND s.started_at_epoch < ?
    `).get(obsCutoffEpoch) as { count: number };

    // Get the oldest observation date that would be deleted
    const oldestObs = db.prepare(`
      SELECT MIN(created_at) as oldest FROM observations
      WHERE created_at_epoch < ?
        AND memory_session_id NOT IN (
          SELECT memory_session_id FROM sdk_sessions
          WHERE status = 'active' AND memory_session_id IS NOT NULL
        )
    `).get(obsCutoffEpoch) as { oldest: string | null };

    // Get the newest date among records that would be deleted
    const newestDeletion = db.prepare(`
      SELECT MAX(created_at) as newest FROM observations
      WHERE created_at_epoch < ?
        AND memory_session_id NOT IN (
          SELECT memory_session_id FROM sdk_sessions
          WHERE status = 'active' AND memory_session_id IS NOT NULL
        )
    `).get(obsCutoffEpoch) as { newest: string | null };

    return {
      observations_to_delete: obsCount.count,
      summaries_to_delete: sumCount.count,
      sessions_to_cleanup: orphanCount.count,
      oldest_observation_date: oldestObs.oldest,
      newest_deletion_date: newestDeletion.newest,
    };
  }

  /**
   * Execute the cleanup operation. When dryRun is true, previews only.
   * Uses a transaction to ensure atomicity.
   */
  static execute(
    db: Database,
    retentionDays: number,
    summaryRetentionDays: number,
    dryRun: boolean = false
  ): CleanupResult {
    const startMs = Date.now();

    // Always compute preview first
    const preview = this.preview(db, retentionDays, summaryRetentionDays);

    if (dryRun) {
      return {
        ...preview,
        executed: false,
        duration_ms: Date.now() - startMs,
      };
    }

    const obsCutoffEpoch = Date.now() - (retentionDays * 86_400_000);
    const summaryCutoffEpoch = Date.now() - (summaryRetentionDays * 86_400_000);

    const runCleanup = db.transaction(() => {
      // 1. Delete old observations (excluding active sessions)
      const obsResult = db.prepare(`
        DELETE FROM observations
        WHERE created_at_epoch < ?
          AND memory_session_id NOT IN (
            SELECT memory_session_id FROM sdk_sessions
            WHERE status = 'active' AND memory_session_id IS NOT NULL
          )
      `).run(obsCutoffEpoch);

      // 2. Delete old summaries (excluding active sessions)
      const sumResult = db.prepare(`
        DELETE FROM session_summaries
        WHERE created_at_epoch < ?
          AND memory_session_id NOT IN (
            SELECT memory_session_id FROM sdk_sessions
            WHERE status = 'active' AND memory_session_id IS NOT NULL
          )
      `).run(summaryCutoffEpoch);

      // 3. Delete orphan sessions (no observations, no summaries, not active)
      const sessionResult = db.prepare(`
        DELETE FROM sdk_sessions
        WHERE status != 'active'
          AND NOT EXISTS (SELECT 1 FROM observations o WHERE o.memory_session_id = sdk_sessions.memory_session_id)
          AND NOT EXISTS (SELECT 1 FROM session_summaries ss WHERE ss.memory_session_id = sdk_sessions.memory_session_id)
          AND started_at_epoch < ?
      `).run(obsCutoffEpoch);

      return {
        observations_deleted: obsResult.changes,
        summaries_deleted: sumResult.changes,
        sessions_deleted: sessionResult.changes,
      };
    });

    try {
      const result = runCleanup();

      logger.info('CLEANUP', 'Data retention cleanup completed', {
        observations_deleted: result.observations_deleted,
        summaries_deleted: result.summaries_deleted,
        sessions_deleted: result.sessions_deleted,
        retention_days: retentionDays,
        summary_retention_days: summaryRetentionDays,
      });

      return {
        ...preview,
        executed: true,
        duration_ms: Date.now() - startMs,
      };
    } catch (error) {
      logger.error('CLEANUP', 'Data retention cleanup failed', {
        retention_days: retentionDays,
        summary_retention_days: summaryRetentionDays,
      }, error as Error);
      throw error;
    }
  }

  /**
   * Get current database statistics.
   */
  static getStats(db: Database): DatabaseStats {
    const totalObs = db.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number };
    const totalSum = db.prepare('SELECT COUNT(*) as count FROM session_summaries').get() as { count: number };
    const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sdk_sessions').get() as { count: number };

    // user_prompts table may not exist in all environments
    let totalPrompts = 0;
    try {
      const promptResult = db.prepare('SELECT COUNT(*) as count FROM user_prompts').get() as { count: number };
      totalPrompts = promptResult.count;
    } catch {
      // Table doesn't exist yet - that's fine
    }

    // Calculate DB size using PRAGMA page_count * page_size
    const pageCount = db.prepare('PRAGMA page_count').get() as { page_count: number };
    const pageSize = db.prepare('PRAGMA page_size').get() as { page_size: number };
    const dbSizeBytes = pageCount.page_count * pageSize.page_size;

    // Get oldest and newest record dates
    const oldest = db.prepare(`
      SELECT MIN(created_at) as oldest FROM (
        SELECT created_at FROM observations
        UNION ALL
        SELECT created_at FROM session_summaries
      )
    `).get() as { oldest: string | null };

    const newest = db.prepare(`
      SELECT MAX(created_at) as newest FROM (
        SELECT created_at FROM observations
        UNION ALL
        SELECT created_at FROM session_summaries
      )
    `).get() as { newest: string | null };

    return {
      total_observations: totalObs.count,
      total_summaries: totalSum.count,
      total_sessions: totalSessions.count,
      total_prompts: totalPrompts,
      db_size_bytes: dbSizeBytes,
      oldest_record: oldest.oldest,
      newest_record: newest.newest,
    };
  }
}
