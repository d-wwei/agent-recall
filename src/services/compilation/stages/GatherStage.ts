/**
 * GatherStage — second stage of the compilation pipeline.
 *
 * Queries observations created since the last compilation for the project,
 * filters out private observations via PrivacyGuard, and groups the
 * remainder by their first concept (topic).
 *
 * Observations without any concepts are grouped under the 'general' topic.
 */

import { PrivacyGuard } from '../PrivacyGuard.js';
import type { CompilationContext, TopicGroup, ObservationRow } from '../types.js';

export class GatherStage {
  private readonly privacyGuard = new PrivacyGuard();

  /**
   * Gather and group observations for compilation.
   *
   * 1. Query observations since lastCompilationEpoch for the project.
   * 2. Filter through PrivacyGuard (exclude <private> tagged content).
   * 3. Group by first concept; default to 'general' when concepts are empty.
   */
  execute(ctx: CompilationContext): TopicGroup[] {
    let rows: ObservationRow[];

    try {
      rows = ctx.db
        .prepare(
          `SELECT id, type, title, subtitle, narrative, facts, concepts, project, created_at_epoch
           FROM observations
           WHERE project = ? AND created_at_epoch > ? AND type != 'synthesis'
           ORDER BY created_at_epoch ASC`
        )
        .all(ctx.project, ctx.lastCompilationEpoch) as ObservationRow[];
    } catch {
      // Table may not exist yet — treat as zero observations.
      return [];
    }

    // Privacy filter first (applies to all observations)
    const filtered = this.privacyGuard.filterForCompilation(rows);

    // Group ALL observations by topic
    const groupMap = new Map<string, ObservationRow[]>();
    for (const obs of filtered) {
      const topic = this.extractFirstConcept(obs);
      const group = groupMap.get(topic);
      if (group) {
        group.push(obs);
      } else {
        groupMap.set(topic, [obs]);
      }
    }

    // Incremental: only include topic groups that have at least one NEW (uncompiled) observation.
    // This enables page updates (version > 1) while still being incremental.
    const compiledSourceIds = this.getCompiledSourceIds(ctx);
    const groups: TopicGroup[] = [];
    for (const [topic, observations] of groupMap) {
      if (compiledSourceIds.size === 0) {
        // No compiled pages yet — include everything
        groups.push({ topic, observations });
      } else {
        const hasNew = observations.some(obs => !compiledSourceIds.has(obs.id));
        if (hasNew) {
          // Topic has new observations — include ALL observations (old + new) for full re-merge
          groups.push({ topic, observations });
        }
        // Topics with only already-compiled observations are skipped
      }
    }

    return groups;
  }

  /**
   * Collect observation IDs that have already been compiled into knowledge pages.
   * Used to skip re-processing and avoid redundant compilation work.
   */
  private getCompiledSourceIds(ctx: CompilationContext): Set<number> {
    const ids = new Set<number>();
    try {
      const existingPages = ctx.db.prepare(
        'SELECT source_observation_ids FROM compiled_knowledge WHERE project = ? AND valid_until IS NULL'
      ).all(ctx.project) as { source_observation_ids: string }[];

      for (const page of existingPages) {
        try {
          const parsed = JSON.parse(page.source_observation_ids);
          if (Array.isArray(parsed)) {
            for (const id of parsed) {
              if (typeof id === 'number') ids.add(id);
            }
          }
        } catch {
          // Malformed JSON — skip this page
        }
      }
    } catch {
      // Table may not exist — return empty set
    }
    return ids;
  }

  /**
   * Extract the first concept from an observation's concepts field.
   * concepts is stored as a JSON string array in the database.
   * Falls back to 'general' when no concepts are available.
   */
  private extractFirstConcept(obs: ObservationRow): string {
    if (!obs.concepts) return 'general';

    try {
      const parsed =
        typeof obs.concepts === 'string'
          ? JSON.parse(obs.concepts)
          : obs.concepts;

      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'string') {
        // Normalize: lowercase, trim, collapse whitespace/special chars to hyphens
        return parsed[0].trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'general';
      }
    } catch {
      // Malformed JSON — fall through to default.
    }

    return 'general';
  }
}
