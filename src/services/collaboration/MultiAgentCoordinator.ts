/**
 * MultiAgentCoordinator - Cross-session awareness for multi-agent collaboration
 *
 * Enables multiple concurrent Claude Code sessions to detect each other,
 * identify file conflicts, and propagate discoveries across sessions.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface SessionInfo {
  sessionId: string;
  project: string;
  startedAt: number;
  lastActivity: number;
}

export interface FileConflict {
  file: string;
  sessions: string[];
}

export class MultiAgentCoordinator {
  constructor(private db: Database) {}

  /**
   * Get all active sessions for a given project.
   * Queries sdk_sessions WHERE status = 'active' AND project = ?.
   */
  getActiveSessions(project: string): SessionInfo[] {
    const rows = this.db.prepare(`
      SELECT content_session_id, project, started_at_epoch,
             COALESCE(
               (SELECT MAX(created_at_epoch) FROM observations WHERE observations.memory_session_id = sdk_sessions.memory_session_id),
               started_at_epoch
             ) as last_activity
      FROM sdk_sessions
      WHERE status = 'active' AND project = ?
      ORDER BY started_at_epoch DESC
    `).all(project) as any[];

    return rows.map(row => ({
      sessionId: row.content_session_id,
      project: row.project,
      startedAt: row.started_at_epoch,
      lastActivity: row.last_activity,
    }));
  }

  /**
   * Detect file conflicts across active sessions for a project.
   * Finds files modified by multiple active sessions by scanning
   * observations.files_modified across active sessions.
   */
  detectFileConflicts(project: string): FileConflict[] {
    // Get files_modified from observations of active sessions
    const rows = this.db.prepare(`
      SELECT o.files_modified, s.content_session_id
      FROM observations o
      JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE s.status = 'active' AND s.project = ?
        AND o.files_modified IS NOT NULL AND o.files_modified != ''
    `).all(project) as any[];

    // Build a map of file -> sessions
    const fileMap = new Map<string, Set<string>>();

    for (const row of rows) {
      let files: string[];
      try {
        files = JSON.parse(row.files_modified);
      } catch {
        // files_modified might be a comma-separated string or single file
        files = row.files_modified.split(',').map((f: string) => f.trim()).filter(Boolean);
      }

      for (const file of files) {
        if (!fileMap.has(file)) {
          fileMap.set(file, new Set());
        }
        fileMap.get(file)!.add(row.content_session_id);
      }
    }

    // Return only files with 2+ sessions
    const conflicts: FileConflict[] = [];
    for (const [file, sessions] of fileMap) {
      if (sessions.size >= 2) {
        conflicts.push({
          file,
          sessions: Array.from(sessions),
        });
      }
    }

    return conflicts;
  }

  /**
   * Mark an observation as "propagatable" so other sessions can discover it.
   * Sets the propagated flag to 1 on the specified observation.
   */
  propagateDiscovery(fromSessionId: string, observationId: number): void {
    // Verify the observation belongs to the session
    const obs = this.db.prepare(`
      SELECT o.id FROM observations o
      JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE o.id = ? AND s.content_session_id = ?
    `).get(observationId, fromSessionId) as any;

    if (!obs) {
      logger.debug('COLLAB', `Observation #${observationId} not found for session ${fromSessionId}`);
      return;
    }

    this.db.prepare('UPDATE observations SET propagated = 1 WHERE id = ?').run(observationId);
    logger.debug('COLLAB', `Propagated observation #${observationId} from session ${fromSessionId}`);
  }

  /**
   * Get observations that have been marked for propagation since a given epoch.
   * Used by other sessions to discover cross-session findings.
   */
  getPropagatedDiscoveries(project: string, sinceEpoch: number): any[] {
    return this.db.prepare(`
      SELECT o.id, o.title, o.narrative, o.type, o.concepts, o.files_modified,
             o.created_at_epoch, s.content_session_id as source_session
      FROM observations o
      JOIN sdk_sessions s ON o.memory_session_id = s.memory_session_id
      WHERE o.project = ? AND o.propagated = 1 AND o.created_at_epoch > ?
      ORDER BY o.created_at_epoch DESC
    `).all(project, sinceEpoch);
  }
}
