/**
 * CompilationLogger — tracks compilation run history and statistics (migration 42).
 *
 * Each compilation attempt is logged with start/end times, counts of
 * observations processed, pages created/updated, tokens used, and final status.
 * Enables observability into compilation pipeline performance over time.
 */

import { Database } from 'bun:sqlite';

export interface CompilationLog {
  id: number;
  project: string;
  startedAt: string;
  completedAt: string | null;
  durationMs: number;
  observationsProcessed: number;
  pagesCreated: number;
  pagesUpdated: number;
  tokensUsed: number;
  status: 'running' | 'success' | 'failed' | 'cancelled';
  error: string | null;
}

export interface CompilationCompleteResult {
  observationsProcessed: number;
  pagesCreated: number;
  pagesUpdated: number;
  tokensUsed?: number;
}

export interface CompilationStats {
  totalRuns: number;
  successRate: number;
  avgDurationMs: number;
  totalTokens: number;
}

interface CompilationLogRow {
  id: number;
  project: string;
  started_at: string;
  completed_at: string | null;
  duration_ms: number;
  observations_processed: number;
  pages_created: number;
  pages_updated: number;
  tokens_used: number;
  status: string;
  error: string | null;
}

interface CountRow {
  count: number;
}

interface StatsRow {
  totalRuns: number;
  successCount: number;
  avgDurationMs: number | null;
  totalTokens: number | null;
}

export class CompilationLogger {
  constructor(private db: Database) {}

  /**
   * Start a new compilation log entry.
   * Returns the inserted row ID.
   */
  startLog(project: string): number {
    const stmt = this.db.prepare(
      `INSERT INTO compilation_logs (project, started_at, status)
       VALUES (?, ?, 'running')`
    );
    const result = stmt.run(project, new Date().toISOString());
    return Number(result.lastInsertRowid);
  }

  /**
   * Mark a log entry as successfully completed.
   * Calculates durationMs from started_at to now.
   */
  completeLog(logId: number, result: CompilationCompleteResult): void {
    const row = this.db.prepare(
      `SELECT started_at FROM compilation_logs WHERE id = ?`
    ).get(logId) as { started_at: string } | undefined;

    if (!row) return;

    const completedAt = new Date().toISOString();
    const durationMs = Date.now() - new Date(row.started_at).getTime();

    this.db.prepare(
      `UPDATE compilation_logs
       SET completed_at = ?,
           duration_ms = ?,
           observations_processed = ?,
           pages_created = ?,
           pages_updated = ?,
           tokens_used = ?,
           status = 'success'
       WHERE id = ?`
    ).run(
      completedAt,
      durationMs,
      result.observationsProcessed,
      result.pagesCreated,
      result.pagesUpdated,
      result.tokensUsed ?? 0,
      logId
    );
  }

  /**
   * Mark a log entry as failed with an error message.
   */
  failLog(logId: number, error: string): void {
    const row = this.db.prepare(
      `SELECT started_at FROM compilation_logs WHERE id = ?`
    ).get(logId) as { started_at: string } | undefined;

    const completedAt = new Date().toISOString();
    const durationMs = row
      ? Date.now() - new Date(row.started_at).getTime()
      : 0;

    this.db.prepare(
      `UPDATE compilation_logs
       SET completed_at = ?,
           duration_ms = ?,
           status = 'failed',
           error = ?
       WHERE id = ?`
    ).run(completedAt, durationMs, error, logId);
  }

  /**
   * Cancel a running log entry.
   */
  cancelLog(logId: number): void {
    const row = this.db.prepare(
      `SELECT started_at FROM compilation_logs WHERE id = ?`
    ).get(logId) as { started_at: string } | undefined;

    const completedAt = new Date().toISOString();
    const durationMs = row
      ? Date.now() - new Date(row.started_at).getTime()
      : 0;

    this.db.prepare(
      `UPDATE compilation_logs
       SET completed_at = ?,
           duration_ms = ?,
           status = 'cancelled'
       WHERE id = ?`
    ).run(completedAt, durationMs, logId);
  }

  /**
   * Get the last N compilation runs for a project, newest first.
   */
  getHistory(project: string, limit: number = 20): CompilationLog[] {
    const rows = this.db.prepare(
      `SELECT * FROM compilation_logs
       WHERE project = ?
       ORDER BY started_at DESC
       LIMIT ?`
    ).all(project, limit) as CompilationLogRow[];

    return rows.map(this.mapRow);
  }

  /**
   * Get aggregate statistics for a project's compilation runs.
   * Only counts completed runs (success or failed) for duration stats.
   */
  getStats(project: string): CompilationStats {
    const row = this.db.prepare(
      `SELECT
         COUNT(*) as totalRuns,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as successCount,
         AVG(CASE WHEN status IN ('success', 'failed') THEN duration_ms ELSE NULL END) as avgDurationMs,
         SUM(tokens_used) as totalTokens
       FROM compilation_logs
       WHERE project = ?`
    ).get(project) as StatsRow;

    const totalRuns = row.totalRuns ?? 0;
    const successCount = row.successCount ?? 0;

    return {
      totalRuns,
      successRate: totalRuns > 0 ? successCount / totalRuns : 0,
      avgDurationMs: row.avgDurationMs ?? 0,
      totalTokens: row.totalTokens ?? 0,
    };
  }

  /**
   * Get the most recent compilation log entry for a project.
   */
  getLatestLog(project: string): CompilationLog | null {
    const row = this.db.prepare(
      `SELECT * FROM compilation_logs
       WHERE project = ?
       ORDER BY started_at DESC
       LIMIT 1`
    ).get(project) as CompilationLogRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  private mapRow(row: CompilationLogRow): CompilationLog {
    return {
      id: row.id,
      project: row.project,
      startedAt: row.started_at,
      completedAt: row.completed_at,
      durationMs: row.duration_ms,
      observationsProcessed: row.observations_processed,
      pagesCreated: row.pages_created,
      pagesUpdated: row.pages_updated,
      tokensUsed: row.tokens_used,
      status: row.status as CompilationLog['status'],
      error: row.error,
    };
  }
}
