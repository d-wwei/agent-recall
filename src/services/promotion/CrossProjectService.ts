/**
 * CrossProjectService - Knowledge migration across projects
 *
 * Detects patterns that appear across multiple projects, promotes them
 * to global scope, and provides access to global knowledge.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface PromotablePattern {
  pattern: string;
  projects: string[];
  confidence: number;
}

export class CrossProjectService {
  constructor(private db: Database) {}

  /**
   * Detect observations/facts that appear across 2+ projects.
   * Groups by concept keywords, counts distinct projects, and
   * returns patterns seen in multiple projects.
   */
  detectGlobalPatterns(): PromotablePattern[] {
    // Get all observations with concepts across projects
    const rows = this.db.prepare(`
      SELECT concepts, project
      FROM observations
      WHERE concepts IS NOT NULL AND concepts != '' AND concepts != '[]'
        AND scope = 'project'
    `).all() as { concepts: string; project: string }[];

    // Build a map of concept -> projects
    const conceptMap = new Map<string, Set<string>>();

    for (const row of rows) {
      let concepts: string[];
      try {
        concepts = JSON.parse(row.concepts);
      } catch {
        concepts = row.concepts.split(',').map(c => c.trim()).filter(Boolean);
      }

      for (const concept of concepts) {
        const normalized = concept.toLowerCase().trim();
        if (!normalized) continue;

        if (!conceptMap.has(normalized)) {
          conceptMap.set(normalized, new Set());
        }
        conceptMap.get(normalized)!.add(row.project);
      }
    }

    // Return patterns seen across 2+ projects
    const patterns: PromotablePattern[] = [];
    for (const [concept, projects] of conceptMap) {
      if (projects.size >= 2) {
        const projectList = Array.from(projects);
        // Confidence: proportion of projects that have this pattern (capped at 1.0)
        const totalProjects = this._getDistinctProjectCount();
        const confidence = Math.min(projectList.length / Math.max(totalProjects, 1), 1.0);

        patterns.push({
          pattern: concept,
          projects: projectList,
          confidence: Math.round(confidence * 100) / 100,
        });
      }
    }

    // Sort by number of projects desc, then by confidence
    patterns.sort((a, b) => b.projects.length - a.projects.length || b.confidence - a.confidence);

    return patterns;
  }

  /**
   * Promote a pattern to global scope.
   * Creates an entity with _global: prefix in the entities table
   * and a fact linking the pattern to global scope.
   */
  promoteToGlobal(pattern: PromotablePattern): void {
    const entityId = `_global:${pattern.pattern}`;
    const now = new Date().toISOString();

    // Upsert entity
    this.db.prepare(`
      INSERT INTO entities (id, name, type, properties, first_seen_at, last_seen_at)
      VALUES (?, ?, 'global_pattern', ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        properties = ?,
        last_seen_at = ?
    `).run(
      entityId,
      pattern.pattern,
      JSON.stringify({ projects: pattern.projects, confidence: pattern.confidence }),
      now, now,
      JSON.stringify({ projects: pattern.projects, confidence: pattern.confidence }),
      now,
    );

    // Create fact linking to global scope (object is NULL — project list is in entity properties)
    const factId = `_global_fact:${pattern.pattern}:${Date.now()}`;
    this.db.prepare(`
      INSERT OR IGNORE INTO facts (id, subject, predicate, object, confidence, created_at)
      VALUES (?, ?, 'observed_across_projects', NULL, ?, ?)
    `).run(
      factId,
      entityId,
      pattern.confidence,
      now,
    );

    logger.debug('CROSS_PROJECT', `Promoted pattern "${pattern.pattern}" to global (${pattern.projects.length} projects)`);
  }

  /**
   * Get all global knowledge (entities and facts with _global: prefix).
   */
  getGlobalKnowledge(): any[] {
    return this.db.prepare(`
      SELECT e.id, e.name, e.type, e.properties, e.first_seen_at, e.last_seen_at,
             f.predicate, f.object as fact_detail, f.confidence
      FROM entities e
      LEFT JOIN facts f ON f.subject = e.id
      WHERE e.id LIKE '_global:%'
      ORDER BY e.last_seen_at DESC
    `).all();
  }

  /**
   * Get count of distinct projects in observations.
   */
  private _getDistinctProjectCount(): number {
    const row = this.db.prepare(
      'SELECT COUNT(DISTINCT project) as cnt FROM observations'
    ).get() as any;
    return row?.cnt || 0;
  }
}
