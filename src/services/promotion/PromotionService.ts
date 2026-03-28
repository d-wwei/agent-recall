/**
 * PromotionService - Cross-project memory promotion
 *
 * Detects cross-project reusable observations and manages sync policies.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface SyncPolicy {
  project: string;
  default_action: 'ask' | 'always' | 'never';
}

export interface PromotableItem {
  observation_id: number;
  title: string | null;
  narrative: string | null;
  type: string;
  concepts: string | null;
  project: string;
  reason: string;
}

export class PromotionService {
  constructor(private db: Database) {}

  /**
   * Get sync policy for a project
   */
  getSyncPolicy(project: string): SyncPolicy {
    const row = this.db.prepare(
      'SELECT project, default_action FROM sync_policies WHERE project = ?'
    ).get(project) as SyncPolicy | undefined;
    return row || { project, default_action: 'ask' };
  }

  /**
   * Set sync policy for a project
   */
  setSyncPolicy(project: string, action: 'ask' | 'always' | 'never'): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO sync_policies (project, default_action, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project) DO UPDATE SET default_action = ?, updated_at = ?
    `).run(project, action, now, now, action, now);
    logger.debug('PROMOTION', `Set sync policy for ${project}: ${action}`);
  }

  /**
   * Detect observations that might be cross-project reusable.
   * Heuristic: observations of type 'decision' or 'discovery' that have broad concepts.
   */
  detectPromotable(project: string, limit: number = 10): PromotableItem[] {
    const rows = this.db.prepare(`
      SELECT id, title, narrative, type, concepts, project
      FROM observations
      WHERE project = ? AND scope = 'project'
        AND type IN ('decision', 'discovery')
        AND title IS NOT NULL
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(project, limit) as any[];

    return rows.map(row => ({
      observation_id: row.id,
      title: row.title,
      narrative: row.narrative,
      type: row.type,
      concepts: row.concepts,
      project: row.project,
      reason: row.type === 'decision' ? 'Decisions often apply across projects' : 'Discoveries may be reusable'
    }));
  }

  /**
   * Promote a specific observation to global scope
   */
  promoteObservation(observationId: number): void {
    this.db.prepare("UPDATE observations SET scope = 'global' WHERE id = ?").run(observationId);
    logger.debug('PROMOTION', `Promoted observation #${observationId} to global`);
  }

  /**
   * Get promotion history (recently promoted items)
   */
  getPromotionHistory(limit: number = 20): any[] {
    return this.db.prepare(`
      SELECT id, title, type, project, created_at
      FROM observations
      WHERE scope = 'global'
      ORDER BY created_at_epoch DESC
      LIMIT ?
    `).all(limit);
  }
}
