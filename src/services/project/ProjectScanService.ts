/**
 * ProjectScanService - Scans database for project statistics
 *
 * Queries sdk_sessions, observations, session_summaries, and agent_profiles
 * to build a per-project summary of activity and persona configuration.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface ProjectScanResult {
  project: string;
  session_count: number;
  observation_count: number;
  summary_count: number;
  first_seen: string;  // ISO date
  last_seen: string;   // ISO date
  has_persona: boolean;
}

interface ProjectAggregateRow {
  project: string;
  session_count: number;
  observation_count: number;
  summary_count: number;
  first_seen_epoch: number;
  last_seen_epoch: number;
}

export class ProjectScanService {
  constructor(private db: Database) {}

  /**
   * Scan all known projects from the database and return aggregated statistics.
   * Results are sorted by last_seen descending (most recently active first).
   */
  scanProjects(): ProjectScanResult[] {
    try {
      // Aggregate session, observation, and summary counts per project in a single query.
      // Uses LEFT JOINs so projects with no observations or summaries still appear.
      const rows = this.db.prepare(`
        SELECT
          s.project,
          COUNT(DISTINCT s.id) AS session_count,
          COUNT(DISTINCT o.id) AS observation_count,
          COUNT(DISTINCT ss.id) AS summary_count,
          MIN(s.started_at_epoch) AS first_seen_epoch,
          MAX(COALESCE(s.completed_at_epoch, s.started_at_epoch)) AS last_seen_epoch
        FROM sdk_sessions s
        LEFT JOIN observations o ON o.project = s.project
        LEFT JOIN session_summaries ss ON ss.project = s.project
        GROUP BY s.project
        ORDER BY last_seen_epoch DESC
      `).all() as ProjectAggregateRow[];

      // Build a set of projects that have at least one agent_profile entry
      const profileScopes = this.getProfileScopes();

      return rows.map(row => ({
        project: row.project,
        session_count: row.session_count,
        observation_count: row.observation_count,
        summary_count: row.summary_count,
        first_seen: new Date(row.first_seen_epoch).toISOString(),
        last_seen: new Date(row.last_seen_epoch).toISOString(),
        has_persona: profileScopes.has(row.project),
      }));
    } catch (error) {
      logger.error('DB', 'Failed to scan projects', {}, error as Error);
      return [];
    }
  }

  /**
   * Get the set of scopes that have at least one agent_profile row.
   * Excludes the 'global' scope since that is not project-specific.
   */
  private getProfileScopes(): Set<string> {
    try {
      const rows = this.db.prepare(
        "SELECT DISTINCT scope FROM agent_profiles WHERE scope != 'global'"
      ).all() as { scope: string }[];
      return new Set(rows.map(r => r.scope));
    } catch {
      // agent_profiles table may not exist on older databases
      return new Set();
    }
  }
}
