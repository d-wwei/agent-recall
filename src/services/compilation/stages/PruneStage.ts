/**
 * PruneStage — fourth and final stage of the compilation pipeline.
 *
 * Writes compiled pages to the compiled_knowledge table (insert or update)
 * and updates source observations to record that they have been referenced
 * by the compilation.
 *
 * For 'status' pages: if an observation is superseded by a newer observation
 * in the same topic, the older observation's superseded_by field is set.
 */

import type { CompiledPage, CompilationContext, CompilationResult } from '../types.js';
import type { CompiledKnowledgeRow } from './OrientStage.js';

export class PruneStage {
  /**
   * Persist compiled pages and update observation metadata.
   *
   * @param pages - Compiled pages from ConsolidateStage
   * @param existingKnowledge - Existing knowledge from OrientStage (for update detection)
   * @param ctx - Compilation context
   * @returns Summary of pages created / updated
   */
  execute(
    pages: CompiledPage[],
    existingKnowledge: Map<string, CompiledKnowledgeRow>,
    ctx: CompilationContext
  ): CompilationResult {
    const result: CompilationResult = {
      pagesCreated: 0,
      pagesUpdated: 0,
      observationsProcessed: 0,
      errors: [],
    };

    const now = new Date().toISOString();

    for (const page of pages) {
      try {
        const existing = existingKnowledge.get(page.topic);
        this.upsertPage(page, existing, now, ctx);

        if (existing) {
          result.pagesUpdated++;
        } else {
          result.pagesCreated++;
        }

        // Mark source observations as referenced
        this.updateObservationReferences(page.sourceObservationIds, now, ctx);

        // For status pages: mark supersession
        if (page.classification === 'status' && page.sourceObservationIds.length > 1) {
          this.markSuperseded(page.sourceObservationIds, ctx);
        }

        result.observationsProcessed += page.sourceObservationIds.length;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.errors.push(`Failed to write page "${page.topic}": ${message}`);
      }
    }

    return result;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Insert a new compiled_knowledge row or update an existing one. */
  private upsertPage(
    page: CompiledPage,
    existing: CompiledKnowledgeRow | undefined,
    now: string,
    ctx: CompilationContext
  ): void {
    const idsJson = JSON.stringify(page.sourceObservationIds);
    const timelineJson = JSON.stringify(page.evidenceTimeline ?? []);

    if (existing) {
      ctx.db
        .prepare(
          `UPDATE compiled_knowledge
           SET content = ?, source_observation_ids = ?, confidence = ?,
               evidence_timeline = ?, version = version + 1, compiled_at = ?
           WHERE id = ?`
        )
        .run(page.content, idsJson, page.confidence, timelineJson, now, existing.id);
    } else {
      ctx.db
        .prepare(
          `INSERT INTO compiled_knowledge
           (project, topic, content, source_observation_ids, confidence, evidence_timeline, compiled_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(ctx.project, page.topic, page.content, idsJson, page.confidence, timelineJson, now);
    }
  }

  /** Update last_referenced_at on source observations. */
  private updateObservationReferences(
    ids: number[],
    now: string,
    ctx: CompilationContext
  ): void {
    if (ids.length === 0) return;

    try {
      const placeholders = ids.map(() => '?').join(',');
      ctx.db
        .prepare(
          `UPDATE observations SET last_referenced_at = ? WHERE id IN (${placeholders})`
        )
        .run(now, ...ids);
    } catch {
      // Column may not exist in older schemas — non-fatal.
    }
  }

  /**
   * For status-classified pages, mark older observations as superseded
   * by the newest observation in the group.
   *
   * The most recent observation (highest id) is the "winner"; all others
   * in the group get superseded_by set to its id.
   */
  private markSuperseded(ids: number[], ctx: CompilationContext): void {
    if (ids.length < 2) return;

    try {
      const sorted = [...ids].sort((a, b) => a - b);
      const newest = sorted[sorted.length - 1];
      const older = sorted.slice(0, -1);

      const placeholders = older.map(() => '?').join(',');
      ctx.db
        .prepare(
          `UPDATE observations SET superseded_by = ? WHERE id IN (${placeholders}) AND superseded_by IS NULL`
        )
        .run(newest, ...older);
    } catch {
      // Column may not exist in older schemas — non-fatal.
    }
  }
}
