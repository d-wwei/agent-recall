/**
 * Data Retention Service tests
 * Tests cleanup preview, execution, dry-run, stats, and edge cases
 * with in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { DataRetentionService } from '../../src/services/cleanup/DataRetentionService.js';
import type { Database } from 'bun:sqlite';

// Helper: milliseconds per day
const DAY_MS = 86_400_000;

describe('DataRetentionService', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Insert a test session
   */
  function insertSession(
    contentSessionId: string,
    memorySessionId: string,
    project: string,
    status: 'active' | 'completed' | 'failed',
    startedAtEpoch: number
  ): void {
    db.prepare(`
      INSERT OR IGNORE INTO sdk_sessions
        (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      contentSessionId,
      memorySessionId,
      project,
      new Date(startedAtEpoch).toISOString(),
      startedAtEpoch,
      status
    );
  }

  /**
   * Insert a test observation
   */
  function insertObservation(
    memorySessionId: string,
    project: string,
    text: string,
    createdAtEpoch: number
  ): void {
    db.prepare(`
      INSERT INTO observations
        (memory_session_id, project, text, type, created_at, created_at_epoch)
      VALUES (?, ?, ?, 'tool_use', ?, ?)
    `).run(
      memorySessionId,
      project,
      text,
      new Date(createdAtEpoch).toISOString(),
      createdAtEpoch
    );
  }

  /**
   * Insert a test summary
   */
  function insertSummary(
    memorySessionId: string,
    project: string,
    createdAtEpoch: number
  ): void {
    db.prepare(`
      INSERT INTO session_summaries
        (memory_session_id, project, request, created_at, created_at_epoch)
      VALUES (?, ?, 'test request', ?, ?)
    `).run(
      memorySessionId,
      project,
      new Date(createdAtEpoch).toISOString(),
      createdAtEpoch
    );
  }

  /**
   * Count rows in a table
   */
  function countRows(table: string): number {
    return (db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number }).count;
  }

  describe('preview()', () => {
    it('should return correct counts for old data', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS); // 100 days ago
      const recentEpoch = now - (10 * DAY_MS); // 10 days ago

      // Old completed session with old observations
      insertSession('cs-old', 'ms-old', 'proj', 'completed', oldEpoch);
      insertObservation('ms-old', 'proj', 'old observation 1', oldEpoch);
      insertObservation('ms-old', 'proj', 'old observation 2', oldEpoch + 1000);
      insertSummary('ms-old', 'proj', oldEpoch);

      // Recent session with recent observations
      insertSession('cs-recent', 'ms-recent', 'proj', 'completed', recentEpoch);
      insertObservation('ms-recent', 'proj', 'recent observation', recentEpoch);
      insertSummary('ms-recent', 'proj', recentEpoch);

      // 90-day retention for observations, 365-day retention for summaries
      const preview = DataRetentionService.preview(db, 90, 365);

      expect(preview.observations_to_delete).toBe(2); // Only old observations
      expect(preview.summaries_to_delete).toBe(0); // Summary only 100 days old, within 365 days
      expect(preview.oldest_observation_date).not.toBeNull();
      expect(preview.newest_deletion_date).not.toBeNull();
    });

    it('should handle empty database', () => {
      const preview = DataRetentionService.preview(db, 90, 365);

      expect(preview.observations_to_delete).toBe(0);
      expect(preview.summaries_to_delete).toBe(0);
      expect(preview.sessions_to_cleanup).toBe(0);
      expect(preview.oldest_observation_date).toBeNull();
      expect(preview.newest_deletion_date).toBeNull();
    });

    it('should count summaries with shorter retention', () => {
      const now = Date.now();
      const oldEpoch = now - (400 * DAY_MS); // 400 days ago

      insertSession('cs-1', 'ms-1', 'proj', 'completed', oldEpoch);
      insertSummary('ms-1', 'proj', oldEpoch);

      // Summary is 400 days old, beyond 365-day retention
      const preview = DataRetentionService.preview(db, 90, 365);
      expect(preview.summaries_to_delete).toBe(1);
    });
  });

  describe('execute()', () => {
    it('should delete old observations', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS);
      const recentEpoch = now - (10 * DAY_MS);

      insertSession('cs-old', 'ms-old', 'proj', 'completed', oldEpoch);
      insertObservation('ms-old', 'proj', 'old obs', oldEpoch);

      insertSession('cs-recent', 'ms-recent', 'proj', 'completed', recentEpoch);
      insertObservation('ms-recent', 'proj', 'recent obs', recentEpoch);

      expect(countRows('observations')).toBe(2);

      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.executed).toBe(true);
      expect(result.observations_to_delete).toBe(1);
      expect(countRows('observations')).toBe(1); // Only recent remains

      // Verify the remaining observation is the recent one
      const remaining = db.prepare('SELECT text FROM observations').get() as { text: string };
      expect(remaining.text).toBe('recent obs');
    });

    it('should delete old summaries separately from observations', () => {
      const now = Date.now();
      const veryOldEpoch = now - (400 * DAY_MS);

      insertSession('cs-old', 'ms-old', 'proj', 'completed', veryOldEpoch);
      insertObservation('ms-old', 'proj', 'old obs', veryOldEpoch);
      insertSummary('ms-old', 'proj', veryOldEpoch);

      // 90-day retention for obs, 365-day for summaries
      // At 400 days, both should be deleted
      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.executed).toBe(true);
      expect(result.observations_to_delete).toBe(1);
      expect(result.summaries_to_delete).toBe(1);
      expect(countRows('observations')).toBe(0);
      expect(countRows('session_summaries')).toBe(0);
    });

    it('should never delete active sessions', () => {
      const now = Date.now();
      const oldEpoch = now - (200 * DAY_MS);

      // Active session with old observations
      insertSession('cs-active', 'ms-active', 'proj', 'active', oldEpoch);
      insertObservation('ms-active', 'proj', 'active obs', oldEpoch);

      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.observations_to_delete).toBe(0); // Active session protected
      expect(countRows('observations')).toBe(1);
      expect(countRows('sdk_sessions')).toBe(1);
    });

    it('should respect different retention periods for observations vs summaries', () => {
      const now = Date.now();
      const epoch120DaysAgo = now - (120 * DAY_MS); // Between 90 and 365

      insertSession('cs-1', 'ms-1', 'proj', 'completed', epoch120DaysAgo);
      insertObservation('ms-1', 'proj', 'obs 120 days', epoch120DaysAgo);
      insertSummary('ms-1', 'proj', epoch120DaysAgo);

      // 90-day obs retention, 365-day summary retention
      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.observations_to_delete).toBe(1); // Obs older than 90 days
      expect(result.summaries_to_delete).toBe(0); // Summary within 365 days
      expect(countRows('observations')).toBe(0);
      expect(countRows('session_summaries')).toBe(1);
    });

    it('should clean up orphan sessions', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS);

      // Session with no observations and no summaries
      insertSession('cs-orphan', 'ms-orphan', 'proj', 'completed', oldEpoch);

      // Session with observations (should not be cleaned)
      insertSession('cs-with-obs', 'ms-with-obs', 'proj', 'completed', oldEpoch);
      insertObservation('ms-with-obs', 'proj', 'has obs', oldEpoch);

      expect(countRows('sdk_sessions')).toBe(2);

      // After cleanup, old observations are deleted AND orphan session is cleaned
      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.sessions_to_cleanup).toBeGreaterThanOrEqual(1);
      // ms-orphan should be gone (orphan) and ms-with-obs may also be orphaned after obs deletion
      // Both old sessions should be eligible for cleanup after their data is removed
    });

    it('should return duration_ms', () => {
      const result = DataRetentionService.execute(db, 90, 365);
      expect(result.duration_ms).toBeGreaterThanOrEqual(0);
      expect(typeof result.duration_ms).toBe('number');
    });
  });

  describe('execute() with dryRun', () => {
    it('should not delete anything when dryRun is true', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS);

      insertSession('cs-old', 'ms-old', 'proj', 'completed', oldEpoch);
      insertObservation('ms-old', 'proj', 'old obs', oldEpoch);
      insertSummary('ms-old', 'proj', oldEpoch);

      const before = countRows('observations');
      const result = DataRetentionService.execute(db, 90, 365, true);

      expect(result.executed).toBe(false);
      expect(result.observations_to_delete).toBe(1);
      expect(countRows('observations')).toBe(before); // Nothing deleted
      expect(countRows('session_summaries')).toBe(1); // Nothing deleted
    });
  });

  describe('getStats()', () => {
    it('should return correct database statistics', () => {
      const now = Date.now();

      insertSession('cs-1', 'ms-1', 'proj', 'completed', now - DAY_MS);
      insertSession('cs-2', 'ms-2', 'proj', 'active', now);
      insertObservation('ms-1', 'proj', 'obs 1', now - DAY_MS);
      insertObservation('ms-2', 'proj', 'obs 2', now);
      insertSummary('ms-1', 'proj', now - DAY_MS);

      const stats = DataRetentionService.getStats(db);

      expect(stats.total_observations).toBe(2);
      expect(stats.total_summaries).toBe(1);
      expect(stats.total_sessions).toBe(2);
      expect(stats.db_size_bytes).toBeGreaterThan(0);
      expect(stats.oldest_record).not.toBeNull();
      expect(stats.newest_record).not.toBeNull();
    });

    it('should handle empty database', () => {
      const stats = DataRetentionService.getStats(db);

      expect(stats.total_observations).toBe(0);
      expect(stats.total_summaries).toBe(0);
      expect(stats.db_size_bytes).toBeGreaterThan(0); // Even empty DB has some size
      expect(stats.oldest_record).toBeNull();
      expect(stats.newest_record).toBeNull();
    });

    it('should calculate db_size_bytes from page_count * page_size', () => {
      const stats = DataRetentionService.getStats(db);

      // Verify it's a reasonable positive number
      expect(stats.db_size_bytes).toBeGreaterThan(0);
      expect(Number.isInteger(stats.db_size_bytes)).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle multiple observations across sessions', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS);
      const recentEpoch = now - (10 * DAY_MS);

      // Old completed session
      insertSession('cs-old1', 'ms-old1', 'proj', 'completed', oldEpoch);
      insertObservation('ms-old1', 'proj', 'obs-1', oldEpoch);
      insertObservation('ms-old1', 'proj', 'obs-2', oldEpoch + 1000);
      insertObservation('ms-old1', 'proj', 'obs-3', oldEpoch + 2000);

      // Another old session
      insertSession('cs-old2', 'ms-old2', 'proj', 'failed', oldEpoch);
      insertObservation('ms-old2', 'proj', 'obs-4', oldEpoch);

      // Recent session
      insertSession('cs-new', 'ms-new', 'proj', 'completed', recentEpoch);
      insertObservation('ms-new', 'proj', 'obs-5', recentEpoch);

      expect(countRows('observations')).toBe(5);

      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.observations_to_delete).toBe(4); // All old obs from both old sessions
      expect(countRows('observations')).toBe(1); // Only recent remains
    });

    it('should not delete sessions that still have observations within retention', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS);
      const recentEpoch = now - (10 * DAY_MS);

      // Session with mix of old and recent observations
      insertSession('cs-mixed', 'ms-mixed', 'proj', 'completed', oldEpoch);
      insertObservation('ms-mixed', 'proj', 'old obs', oldEpoch);
      insertObservation('ms-mixed', 'proj', 'recent obs', recentEpoch);

      const result = DataRetentionService.execute(db, 90, 365);

      // Old observation deleted but recent one preserved
      expect(countRows('observations')).toBe(1);
      // Session should NOT be orphan-cleaned because it still has a recent observation
      expect(countRows('sdk_sessions')).toBe(1);
    });

    it('should not treat active sessions as orphans even without data', () => {
      const now = Date.now();
      const oldEpoch = now - (200 * DAY_MS);

      // Active session with no data - should be protected
      insertSession('cs-active-empty', 'ms-active-empty', 'proj', 'active', oldEpoch);

      const result = DataRetentionService.execute(db, 90, 365);

      expect(result.sessions_to_cleanup).toBe(0);
      expect(countRows('sdk_sessions')).toBe(1);
    });

    it('should handle transaction atomicity on success', () => {
      const now = Date.now();
      const oldEpoch = now - (100 * DAY_MS);

      insertSession('cs-1', 'ms-1', 'proj', 'completed', oldEpoch);
      insertObservation('ms-1', 'proj', 'obs', oldEpoch);
      insertSummary('ms-1', 'proj', oldEpoch - (300 * DAY_MS)); // Very old summary

      const result = DataRetentionService.execute(db, 90, 365);

      // Both observation and summary should be cleaned up
      expect(result.executed).toBe(true);
      expect(countRows('observations')).toBe(0);
      expect(countRows('session_summaries')).toBe(0);
    });
  });
});
