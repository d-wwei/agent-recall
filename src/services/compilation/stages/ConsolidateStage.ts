/**
 * ConsolidateStage — third stage of the compilation pipeline.
 *
 * For each topic group, produces a CompiledPage by merging observations into
 * a structured narrative. When an existing knowledge page exists for the topic,
 * new observations are merged into the existing content.
 *
 * Classification rules:
 *   - decision / change  -> 'status'  (can be superseded by newer info)
 *   - discovery / feature -> 'fact'    (append, don't replace)
 *   - bugfix / refactor   -> 'event'   (timeline entry)
 *
 * For the MVP, "merge" is simple text concatenation with deduplication.
 * AI-powered summarisation is a future enhancement.
 */

import type { CompiledKnowledgeRow } from './OrientStage.js';
import type { TopicGroup, ObservationRow, CompiledPage, CompilationContext } from '../types.js';

// ─── Classification mapping ────────────────────────────────────────────────

type Classification = 'status' | 'fact' | 'event';

const TYPE_CLASSIFICATION: Record<string, Classification> = {
  decision: 'status',
  change: 'status',
  discovery: 'fact',
  feature: 'fact',
  bugfix: 'event',
  refactor: 'event',
};

function classifyObservation(obs: ObservationRow): Classification {
  return TYPE_CLASSIFICATION[obs.type] ?? 'fact';
}

/**
 * Pick the dominant classification from a group of observations.
 * Priority: status > fact > event  (status pages are most actionable).
 */
function dominantClassification(observations: ObservationRow[]): Classification {
  let hasStatus = false;
  let hasFact = false;

  for (const obs of observations) {
    const c = classifyObservation(obs);
    if (c === 'status') hasStatus = true;
    if (c === 'fact') hasFact = true;
  }

  if (hasStatus) return 'status';
  if (hasFact) return 'fact';
  return 'event';
}

// ─── Content helpers ────────────────────────────────────────────────────────

/** Extract a one-line summary from an observation. */
function summariseObservation(obs: ObservationRow): string {
  const parts: string[] = [];

  if (obs.title) parts.push(obs.title);
  if (obs.subtitle) parts.push(obs.subtitle);
  if (obs.narrative) parts.push(obs.narrative);

  return parts.join(' — ') || `(observation #${obs.id})`;
}

/** Parse facts JSON string into a string array. */
function parseFacts(obs: ObservationRow): string[] {
  if (!obs.facts) return [];
  try {
    const parsed = typeof obs.facts === 'string' ? JSON.parse(obs.facts) : obs.facts;
    if (Array.isArray(parsed)) return parsed.filter((f: unknown) => typeof f === 'string');
  } catch {
    // Malformed JSON — skip.
  }
  return [];
}

/**
 * Build the content string for a compiled page.
 *
 * Format:
 * ```
 * ## {topic}
 *
 * {narrative lines}
 *
 * ### Facts
 * - fact1
 * - fact2
 * ```
 */
function buildContent(
  topic: string,
  observations: ObservationRow[],
  existingContent: string | null
): string {
  const narrativeLines: string[] = [];
  const allFacts: string[] = [];
  const seenFacts = new Set<string>();

  // If we have existing content, include it as the baseline
  if (existingContent) {
    narrativeLines.push(existingContent);
    narrativeLines.push(''); // blank separator
  }

  for (const obs of observations) {
    const summary = summariseObservation(obs);
    // Simple dedup: skip if we've already seen an identical line
    if (!narrativeLines.includes(summary)) {
      narrativeLines.push(`- ${summary}`);
    }

    for (const fact of parseFacts(obs)) {
      if (!seenFacts.has(fact)) {
        seenFacts.add(fact);
        allFacts.push(fact);
      }
    }
  }

  let content = `## ${topic}\n\n${narrativeLines.join('\n')}`;

  if (allFacts.length > 0) {
    content += '\n\n### Facts\n' + allFacts.map(f => `- ${f}`).join('\n');
  }

  return content;
}

// ─── ConsolidateStage ────────────────────────────────────────────────────────

export class ConsolidateStage {
  /**
   * Merge topic groups into compiled pages.
   *
   * @param groups - Topic groups from GatherStage
   * @param existingKnowledge - Current compiled knowledge from OrientStage
   * @param _ctx - Compilation context (reserved for future AI-powered merge)
   */
  execute(
    groups: TopicGroup[],
    existingKnowledge: Map<string, CompiledKnowledgeRow>,
    _ctx: CompilationContext
  ): CompiledPage[] {
    const pages: CompiledPage[] = [];

    for (const group of groups) {
      const existing = existingKnowledge.get(group.topic);
      const existingContent = existing?.content ?? null;

      // Merge existing source IDs with new observation IDs
      let existingIds: number[] = [];
      if (existing?.source_observation_ids) {
        try {
          existingIds = JSON.parse(existing.source_observation_ids);
        } catch {
          // Malformed JSON — start fresh.
        }
      }

      const newIds = group.observations.map(o => o.id);
      const allIds = [...new Set([...existingIds, ...newIds])];

      const content = buildContent(group.topic, group.observations, existingContent);
      const classification = dominantClassification(group.observations);

      // Confidence: high if all observations agree on classification,
      // medium if mixed types are present
      const classifications = new Set(group.observations.map(o => classifyObservation(o)));
      const confidence = classifications.size === 1 ? 'high' : 'medium';

      pages.push({
        topic: group.topic,
        content,
        sourceObservationIds: allIds,
        confidence,
        classification,
      });
    }

    return pages;
  }
}
