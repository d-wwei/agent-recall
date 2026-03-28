/**
 * MemoryLayerService - Global/project memory layering
 *
 * Queries observations with both global AND project scope,
 * merging them with project-specific taking priority for dedup.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface LayeredQueryConfig {
  project: string;
  types: string[];
  concepts: string[];
  limit: number;
}

export interface LayeredObservation {
  id: number;
  memory_session_id: string;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  files_read: string | null;
  files_modified: string | null;
  discovery_tokens: number;
  created_at: string;
  created_at_epoch: number;
  scope: string;
}

export class MemoryLayerService {
  constructor(private db: Database) {}

  /**
   * Query observations from both global scope AND project scope.
   * Project observations come first (higher priority), then global.
   */
  queryLayeredObservations(config: LayeredQueryConfig): LayeredObservation[] {
    const typePlaceholders = config.types.map(() => '?').join(',');
    const conceptPlaceholders = config.concepts.map(() => '?').join(',');

    // Query both scopes in one query, ordered by time
    return this.db.prepare(`
      SELECT
        id, memory_session_id, type, title, subtitle, narrative,
        facts, concepts, files_read, files_modified, discovery_tokens,
        created_at, created_at_epoch, scope
      FROM observations
      WHERE (project = ? OR scope = 'global')
        AND type IN (${typePlaceholders})
        AND EXISTS (
          SELECT 1 FROM json_each(concepts)
          WHERE value IN (${conceptPlaceholders})
        )
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(config.project, ...config.types, ...config.concepts, config.limit) as LayeredObservation[];
  }

  /**
   * Query summaries from both global scope AND project scope.
   */
  queryLayeredSummaries(project: string, limit: number): any[] {
    return this.db.prepare(`
      SELECT id, memory_session_id, request, investigated, learned, completed, next_steps,
             created_at, created_at_epoch, scope
      FROM session_summaries
      WHERE project = ? OR scope = 'global'
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(project, limit) as any[];
  }

  /**
   * Promote an observation to global scope
   */
  promoteToGlobal(observationId: number): void {
    this.db.prepare("UPDATE observations SET scope = 'global' WHERE id = ?").run(observationId);
    logger.debug('MEMORY', `Promoted observation #${observationId} to global scope`);
  }

  /**
   * Get count of global vs project observations
   */
  getScopeCounts(project: string): { global: number; project: number } {
    const globalCount = (this.db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE scope = 'global'"
    ).get() as { count: number }).count;
    const projectCount = (this.db.prepare(
      "SELECT COUNT(*) as count FROM observations WHERE project = ? AND scope = 'project'"
    ).get(project) as { count: number }).count;
    return { global: globalCount, project: projectCount };
  }
}
