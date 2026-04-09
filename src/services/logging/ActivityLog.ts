/**
 * ActivityLog
 *
 * Standardized activity log for recording agent operations.
 * Persists entries to the activity_log table (migration 38).
 *
 * Operations: session | ingest | query | lint | bootstrap | compile | export
 * Format: [YYYY-MM-DD] operation | title — summary
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export type ActivityOperation =
  | 'session'
  | 'ingest'
  | 'query'
  | 'lint'
  | 'bootstrap'
  | 'compile'
  | 'export';

export interface ActivityEntry {
  id: number;
  operation: ActivityOperation;
  title: string;
  summary: string;
  project: string | null;
  created_at: string;
}

export class ActivityLog {
  constructor(private db: Database) {}

  /**
   * Insert an activity log entry.
   * Returns the newly created entry ID.
   * Never throws — wraps in try-catch and logs warning on failure.
   */
  log(operation: ActivityOperation, title: string, summary: string, project?: string): number {
    try {
      const result = this.db
        .prepare(
          `INSERT INTO activity_log (operation, title, summary, project)
           VALUES (?, ?, ?, ?)`
        )
        .run(operation, title, summary, project ?? null);
      return result.lastInsertRowid as number;
    } catch (error) {
      logger.warn('ACTIVITY_LOG', 'Failed to write activity log entry', { operation, title }, error as Error);
      return -1;
    }
  }

  /**
   * Return the most recent N entries, ordered newest-first.
   * Defaults to 20 entries.
   */
  getRecent(limit = 20): ActivityEntry[] {
    try {
      return this.db
        .prepare(
          `SELECT id, operation, title, summary, project, created_at
           FROM activity_log
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(limit) as ActivityEntry[];
    } catch (error) {
      logger.warn('ACTIVITY_LOG', 'Failed to query recent activity log entries', {}, error as Error);
      return [];
    }
  }

  /**
   * Return the most recent N entries for a specific operation type, ordered newest-first.
   * Defaults to 20 entries.
   */
  getByOperation(operation: ActivityOperation, limit = 20): ActivityEntry[] {
    try {
      return this.db
        .prepare(
          `SELECT id, operation, title, summary, project, created_at
           FROM activity_log
           WHERE operation = ?
           ORDER BY id DESC
           LIMIT ?`
        )
        .all(operation, limit) as ActivityEntry[];
    } catch (error) {
      logger.warn('ACTIVITY_LOG', 'Failed to query activity log by operation', { operation }, error as Error);
      return [];
    }
  }

  /**
   * Format a single entry as a human-readable string.
   * Format: [YYYY-MM-DD] operation | title — summary
   */
  format(entry: ActivityEntry): string {
    const date = entry.created_at.slice(0, 10); // Extract YYYY-MM-DD
    return `[${date}] ${entry.operation} | ${entry.title} \u2014 ${entry.summary}`;
  }

  /**
   * Format multiple entries, one per line.
   * Returns an empty string for an empty array.
   */
  formatAll(entries: ActivityEntry[]): string {
    return entries.map(e => this.format(e)).join('\n');
  }
}
