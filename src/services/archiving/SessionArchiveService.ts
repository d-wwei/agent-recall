/**
 * SessionArchiveService - Session archiving with temporal and topic recall
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface ArchiveEntry {
  id: number;
  memory_session_id: string | null;
  project: string;
  summary: string | null;
  key_outcomes: string | null;
  files_changed: string | null;
  tags: string | null;
  duration_minutes: number | null;
  archived_at: string;
  archived_at_epoch: number;
}

export interface ArchiveInput {
  memory_session_id?: string;
  project: string;
  summary: string;
  key_outcomes?: string[];
  files_changed?: string[];
  tags?: string[];
  duration_minutes?: number;
}

export class SessionArchiveService {
  constructor(private db: Database) {}

  /**
   * Archive a session
   */
  archive(input: ArchiveInput): number {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    const result = this.db.prepare(`
      INSERT INTO session_archives (memory_session_id, project, summary, key_outcomes, files_changed, tags, duration_minutes, archived_at, archived_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.memory_session_id || null,
      input.project,
      input.summary,
      input.key_outcomes ? JSON.stringify(input.key_outcomes) : null,
      input.files_changed ? JSON.stringify(input.files_changed) : null,
      input.tags ? JSON.stringify(input.tags) : null,
      input.duration_minutes || null,
      now,
      nowEpoch
    );

    logger.debug('ARCHIVE', `Archived session for ${input.project}`);
    return Number((result as any).lastInsertRowid || 0);
  }

  /**
   * Temporal recall — get archives within a date range
   */
  recallByTime(fromEpoch: number, toEpoch: number, project?: string): ArchiveEntry[] {
    if (project) {
      return this.db.prepare(`
        SELECT * FROM session_archives
        WHERE archived_at_epoch BETWEEN ? AND ? AND project = ?
        ORDER BY archived_at_epoch DESC
      `).all(fromEpoch, toEpoch, project) as ArchiveEntry[];
    }
    return this.db.prepare(`
      SELECT * FROM session_archives
      WHERE archived_at_epoch BETWEEN ? AND ?
      ORDER BY archived_at_epoch DESC
    `).all(fromEpoch, toEpoch) as ArchiveEntry[];
  }

  /**
   * Topic recall — search archives by keyword using FTS5
   */
  recallByTopic(query: string, project?: string, limit: number = 20): ArchiveEntry[] {
    // Try FTS5 first
    try {
      const ftsQuery = query.split(/\s+/).map(w => `"${w}"`).join(' OR ');
      if (project) {
        return this.db.prepare(`
          SELECT sa.* FROM session_archives sa
          JOIN session_archives_fts fts ON sa.id = fts.rowid
          WHERE session_archives_fts MATCH ? AND sa.project = ?
          ORDER BY sa.archived_at_epoch DESC
          LIMIT ?
        `).all(ftsQuery, project, limit) as ArchiveEntry[];
      }
      return this.db.prepare(`
        SELECT sa.* FROM session_archives sa
        JOIN session_archives_fts fts ON sa.id = fts.rowid
        WHERE session_archives_fts MATCH ?
        ORDER BY sa.archived_at_epoch DESC
        LIMIT ?
      `).all(ftsQuery, limit) as ArchiveEntry[];
    } catch {
      // FTS5 not available, fall back to LIKE
      const likePattern = `%${query}%`;
      if (project) {
        return this.db.prepare(`
          SELECT * FROM session_archives
          WHERE (summary LIKE ? OR key_outcomes LIKE ? OR tags LIKE ?) AND project = ?
          ORDER BY archived_at_epoch DESC
          LIMIT ?
        `).all(likePattern, likePattern, likePattern, project, limit) as ArchiveEntry[];
      }
      return this.db.prepare(`
        SELECT * FROM session_archives
        WHERE summary LIKE ? OR key_outcomes LIKE ? OR tags LIKE ?
        ORDER BY archived_at_epoch DESC
        LIMIT ?
      `).all(likePattern, likePattern, likePattern, limit) as ArchiveEntry[];
    }
  }

  /**
   * Get recent archives (index view)
   */
  getRecentArchives(project?: string, limit: number = 30): ArchiveEntry[] {
    if (project) {
      return this.db.prepare(`
        SELECT * FROM session_archives WHERE project = ? ORDER BY archived_at_epoch DESC LIMIT ?
      `).all(project, limit) as ArchiveEntry[];
    }
    return this.db.prepare(`
      SELECT * FROM session_archives ORDER BY archived_at_epoch DESC LIMIT ?
    `).all(limit) as ArchiveEntry[];
  }
}
