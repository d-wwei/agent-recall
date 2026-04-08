/**
 * AuditService
 *
 * Provides audit logging for data operations (delete, export, cleanup, profile updates).
 * All methods are static and never throw — failures are logged as warnings.
 *
 * The audit_log table is created by migration 27 in the MigrationRunner.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface AuditEntry {
  action: string;
  details?: Record<string, any>;
  record_count?: number;
}

export interface AuditLogRow {
  id: number;
  action: string;
  details: string | null;
  record_count: number | null;
  performed_at: string;
  performed_at_epoch: number;
}

export interface AuditStats {
  total_entries: number;
  last_review_date: string | null;
  entries_by_action: Record<string, number>;
}

export class AuditService {
  /**
   * Insert an audit log entry.
   * Never throws — wraps in try-catch and logs warning on failure.
   */
  static log(db: Database, entry: AuditEntry): void {
    try {
      const now = new Date();
      db.prepare(`
        INSERT INTO audit_log (action, details, record_count, performed_at, performed_at_epoch)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        entry.action,
        entry.details ? JSON.stringify(entry.details) : null,
        entry.record_count ?? null,
        now.toISOString(),
        now.getTime()
      );
    } catch (error) {
      logger.warn('AUDIT', 'Failed to write audit log entry', {
        action: entry.action,
      }, error as Error);
    }
  }

  /**
   * Query the audit log with optional filters.
   * Returns entries in reverse chronological order (newest first).
   */
  static getLog(
    db: Database,
    opts?: { limit?: number; offset?: number; action?: string }
  ): AuditLogRow[] {
    try {
      const limit = opts?.limit ?? 50;
      const offset = opts?.offset ?? 0;

      if (opts?.action) {
        return db.prepare(`
          SELECT id, action, details, record_count, performed_at, performed_at_epoch
          FROM audit_log
          WHERE action = ?
          ORDER BY performed_at_epoch DESC
          LIMIT ? OFFSET ?
        `).all(opts.action, limit, offset) as AuditLogRow[];
      }

      return db.prepare(`
        SELECT id, action, details, record_count, performed_at, performed_at_epoch
        FROM audit_log
        ORDER BY performed_at_epoch DESC
        LIMIT ? OFFSET ?
      `).all(limit, offset) as AuditLogRow[];
    } catch (error) {
      logger.warn('AUDIT', 'Failed to read audit log', {}, error as Error);
      return [];
    }
  }

  /**
   * Get the date of the most recent 'memory_review' audit entry.
   * Returns null if no review has been performed.
   */
  static getLastReviewDate(db: Database): string | null {
    try {
      const row = db.prepare(`
        SELECT performed_at FROM audit_log
        WHERE action = 'memory_review'
        ORDER BY performed_at_epoch DESC
        LIMIT 1
      `).get() as { performed_at: string } | undefined;

      return row?.performed_at ?? null;
    } catch (error) {
      logger.warn('AUDIT', 'Failed to get last review date', {}, error as Error);
      return null;
    }
  }

  /**
   * Record that a memory review was completed on the given date.
   */
  static setReviewDate(db: Database, date: string): void {
    this.log(db, {
      action: 'memory_review',
      details: { review_date: date },
    });
  }

  /**
   * Get audit statistics: total entries, last review date, and counts by action type.
   */
  static getStats(db: Database): AuditStats {
    try {
      const total = db.prepare('SELECT COUNT(*) as count FROM audit_log').get() as { count: number };

      const lastReviewDate = this.getLastReviewDate(db);

      const actionCounts = db.prepare(`
        SELECT action, COUNT(*) as count
        FROM audit_log
        GROUP BY action
        ORDER BY count DESC
      `).all() as Array<{ action: string; count: number }>;

      const entriesByAction: Record<string, number> = {};
      for (const row of actionCounts) {
        entriesByAction[row.action] = row.count;
      }

      return {
        total_entries: total.count,
        last_review_date: lastReviewDate,
        entries_by_action: entriesByAction,
      };
    } catch (error) {
      logger.warn('AUDIT', 'Failed to get audit stats', {}, error as Error);
      return {
        total_entries: 0,
        last_review_date: null,
        entries_by_action: {},
      };
    }
  }
}
