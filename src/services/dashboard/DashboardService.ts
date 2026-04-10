/**
 * DashboardService
 *
 * Aggregates memory health metrics for the dashboard API.
 * Reads from the live SQLite database to compute:
 * - Total observations and weekly new count
 * - Type distribution breakdown
 * - Top 10 concepts by frequency
 * - Freshness distribution (hot/warm/cold/archive)
 * - Compiled pages, lint warnings, entities, facts, diary entries
 */

import { Database } from 'bun:sqlite';
import { KnowledgeLint } from '../compilation/KnowledgeLint.js';

export interface DashboardData {
  totalObservations: number;
  thisWeekNew: number;
  byType: Record<string, number>;
  topConcepts: { concept: string; count: number }[];
  freshness: { hot: number; warm: number; cold: number; archive: number };
  compiledPages: number;
  lintWarnings: number;
  totalEntities: number;
  totalFacts: number;
  diaryEntries: number;
}

export class DashboardService {
  constructor(private db: Database) {}

  getDashboard(project: string): DashboardData {
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
    const ninetyDaysAgo = now - 90 * 24 * 60 * 60 * 1000;

    // Total observations for the project
    const total = (this.db.prepare(
      'SELECT COUNT(*) as c FROM observations WHERE project = ?'
    ).get(project) as any)?.c ?? 0;

    // New observations this week
    const thisWeek = (this.db.prepare(
      'SELECT COUNT(*) as c FROM observations WHERE project = ? AND created_at_epoch > ?'
    ).get(project, weekAgo) as any)?.c ?? 0;

    // Distribution by type
    const typeRows = this.db.prepare(
      'SELECT type, COUNT(*) as c FROM observations WHERE project = ? GROUP BY type'
    ).all(project) as { type: string; c: number }[];
    const byType: Record<string, number> = {};
    for (const r of typeRows) byType[r.type] = r.c;

    // Top concepts — parse JSON concepts column, count occurrences
    const allObs = this.db.prepare(
      'SELECT concepts FROM observations WHERE project = ? AND concepts IS NOT NULL'
    ).all(project) as { concepts: string }[];
    const conceptCounts = new Map<string, number>();
    for (const row of allObs) {
      try {
        const concepts = JSON.parse(row.concepts);
        if (Array.isArray(concepts)) {
          for (const c of concepts) {
            if (typeof c === 'string' && c.length > 0) {
              conceptCounts.set(c, (conceptCounts.get(c) ?? 0) + 1);
            }
          }
        }
      } catch {
        // Malformed JSON — skip row
      }
    }
    const topConcepts = [...conceptCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([concept, count]) => ({ concept, count }));

    // Freshness distribution
    // hot   = created within last 7 days
    // warm  = created between 7 and 30 days ago
    // cold  = created between 30 and 90 days ago
    // archive = older than 90 days
    const hot = (this.db.prepare(
      'SELECT COUNT(*) as c FROM observations WHERE project = ? AND created_at_epoch > ?'
    ).get(project, weekAgo) as any)?.c ?? 0;

    const warm = (this.db.prepare(
      'SELECT COUNT(*) as c FROM observations WHERE project = ? AND created_at_epoch > ? AND created_at_epoch <= ?'
    ).get(project, thirtyDaysAgo, weekAgo) as any)?.c ?? 0;

    const cold = (this.db.prepare(
      'SELECT COUNT(*) as c FROM observations WHERE project = ? AND created_at_epoch > ? AND created_at_epoch <= ?'
    ).get(project, ninetyDaysAgo, thirtyDaysAgo) as any)?.c ?? 0;

    const archive = (this.db.prepare(
      'SELECT COUNT(*) as c FROM observations WHERE project = ? AND created_at_epoch <= ?'
    ).get(project, ninetyDaysAgo) as any)?.c ?? 0;

    // Optional supplementary tables — use safeCount so missing tables return 0
    const compiledPages = this.safeCount('compiled_knowledge', 'project = ?', project);
    let lintWarnings = 0;
    try {
      const lint = new KnowledgeLint(this.db);
      const lintResult = lint.run(project);
      lintWarnings = lintResult.warnings.length;
    } catch {
      // Non-blocking: KnowledgeLint may fail on older schemas missing required columns
    }
    const totalEntities = this.safeCount('entities', 'id LIKE ?', `${project}:%`);
    const totalFacts = this.safeCount('facts', 'subject LIKE ?', `${project}:%`);
    const diaryEntries = this.safeCount('agent_diary', 'project = ?', project);

    return {
      totalObservations: total,
      thisWeekNew: thisWeek,
      byType,
      topConcepts,
      freshness: { hot, warm, cold, archive },
      compiledPages,
      lintWarnings,
      totalEntities,
      totalFacts,
      diaryEntries,
    };
  }

  /**
   * Count rows from a potentially-missing table.
   * Returns 0 if the table does not exist instead of throwing.
   */
  private safeCount(table: string, whereClause: string, param: string): number {
    try {
      return (this.db.prepare(
        `SELECT COUNT(*) as c FROM ${table} WHERE ${whereClause}`
      ).get(param) as any)?.c ?? 0;
    } catch {
      return 0;
    }
  }
}
