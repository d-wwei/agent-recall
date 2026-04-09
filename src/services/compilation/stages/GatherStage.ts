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
           WHERE project = ? AND created_at_epoch > ?
           ORDER BY created_at_epoch ASC`
        )
        .all(ctx.project, ctx.lastCompilationEpoch) as ObservationRow[];
    } catch {
      // Table may not exist yet — treat as zero observations.
      return [];
    }

    // Privacy filter
    const filtered = this.privacyGuard.filterForCompilation(rows);

    // Group by first concept
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

    // Convert to TopicGroup[]
    const groups: TopicGroup[] = [];
    for (const [topic, observations] of groupMap) {
      groups.push({ topic, observations });
    }

    return groups;
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
        return parsed[0];
      }
    } catch {
      // Malformed JSON — fall through to default.
    }

    return 'general';
  }
}
