/**
 * OrientStage — first stage of the compilation pipeline.
 *
 * Loads the current state of compiled knowledge for the project so that
 * subsequent stages can decide whether to create new pages or merge into
 * existing ones.
 *
 * Returns a Map<topic, row> of all active (non-expired) compiled_knowledge
 * entries for the project.
 */

import type { CompilationContext } from '../types.js';

export interface CompiledKnowledgeRow {
  id: number;
  project: string;
  topic: string;
  content: string;
  source_observation_ids: string; // JSON array
  confidence: string;
  protected: number;
  privacy_scope: string;
  version: number;
  compiled_at: string | null;
  valid_until: string | null;
  superseded_by: number | null;
  created_at: string;
}

export class OrientStage {
  /**
   * Query all active compiled knowledge entries for the project.
   *
   * "Active" means valid_until IS NULL — the page has not been expired or
   * superseded.
   */
  execute(ctx: CompilationContext): Map<string, CompiledKnowledgeRow> {
    const result = new Map<string, CompiledKnowledgeRow>();

    try {
      const rows = ctx.db
        .prepare(
          `SELECT * FROM compiled_knowledge
           WHERE project = ? AND valid_until IS NULL`
        )
        .all(ctx.project) as CompiledKnowledgeRow[];

      for (const row of rows) {
        result.set(row.topic, row);
      }
    } catch {
      // Table may not exist yet (e.g. fresh test DB) — return empty map.
    }

    return result;
  }
}
