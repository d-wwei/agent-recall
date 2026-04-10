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
 * Merge strategy: structuredMerge classifies observations into Status/Facts/Timeline
 * sections, deduplicates, and produces clean Markdown output. An aiMerge method
 * is prepared for future LLM-powered summarisation.
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

// ─── AI Merge prompt (stored for future LLM integration) ─────────────────

/**
 * Prompt template for AI-powered knowledge merge.
 * Currently unused — structuredMerge is used instead.
 * When LLM integration is available, aiMerge() will call Haiku with this prompt.
 */
const AI_MERGE_PROMPT_TEMPLATE = `You are a knowledge compiler. Merge these observations about "{{topic}}" into a concise, structured knowledge page.

{{existing_block}}{{observations}}

Rules:
- For STATUS information (current state, tech stack): replace old values with new
- For FACTS (permanent truths): append, don't replace
- For EVENTS (decisions, bugs, migrations): add to timeline
- Remove duplicates and contradictions (keep the newer one)
- Output clean Markdown with sections: ## Status, ## Facts, ## Timeline
- Be concise — each item one line`;

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

      const content = this.structuredMerge(group.topic, group.observations, existingContent);
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

  /**
   * AI-powered merge (future enhancement).
   *
   * Builds a prompt and would call an LLM for intelligent merging.
   * Currently falls back to structuredMerge since we don't want to require API keys.
   * In production, this would call Haiku via the existing agent infrastructure.
   */
  private async aiMerge(topic: string, observations: ObservationRow[], existingContent: string | null): Promise<string> {
    const obsText = observations.map(o =>
      `- [${o.type}] ${o.title}: ${o.narrative || ''}`
    ).join('\n');

    // Build the prompt from template (kept for documentation / future use)
    const _prompt = AI_MERGE_PROMPT_TEMPLATE
      .replace('{{topic}}', topic)
      .replace('{{existing_block}}', existingContent ? `Existing knowledge:\n${existingContent}\n\nNew observations to integrate:\n` : 'Observations:\n')
      .replace('{{observations}}', obsText);

    // For now, use structured local merge since we don't want to require API keys
    // In production, this would call Haiku via the existing agent infrastructure
    return this.structuredMerge(topic, observations, existingContent);
  }

  /**
   * Structured text-based merge that classifies observations into
   * Status / Facts / Timeline sections with deduplication.
   */
  private structuredMerge(topic: string, observations: ObservationRow[], existingContent: string | null): string {
    const status: string[] = [];
    const facts: string[] = [];
    const timeline: string[] = [];

    // Parse existing content sections if available
    if (existingContent) {
      const sections = this.parseSections(existingContent);
      status.push(...sections.status);
      facts.push(...sections.facts);
      timeline.push(...sections.timeline);
    }

    // Classify new observations
    for (const obs of observations) {
      const line = `${obs.title}${obs.narrative ? ': ' + obs.narrative.substring(0, 200) : ''}`;

      // Also gather any structured facts from the observation
      const parsedFacts = this.parseFacts(obs);

      if (obs.type === 'decision' || obs.type === 'change') {
        status.push(line);
      } else if (obs.type === 'discovery' || obs.type === 'feature') {
        facts.push(line);
        // Append structured facts from JSON as well
        facts.push(...parsedFacts);
      } else {
        timeline.push(`[${obs.type}] ${line}`);
        // Append structured facts from non-status/fact types too
        if (parsedFacts.length) facts.push(...parsedFacts);
      }
    }

    // Deduplicate
    const dedup = (arr: string[]) => [...new Set(arr)];

    // Build structured output
    const sections: string[] = [`## ${topic}\n`];
    if (status.length) sections.push('### Status\n' + dedup(status).map(s => `- ${s}`).join('\n'));
    if (facts.length) sections.push('### Facts\n' + dedup(facts).map(f => `- ${f}`).join('\n'));
    if (timeline.length) sections.push('### Timeline\n' + dedup(timeline).map(t => `- ${t}`).join('\n'));

    return sections.join('\n\n');
  }

  /**
   * Parse existing structured content into Status / Facts / Timeline arrays.
   */
  private parseSections(content: string): { status: string[]; facts: string[]; timeline: string[] } {
    const result = { status: [] as string[], facts: [] as string[], timeline: [] as string[] };
    let current: 'status' | 'facts' | 'timeline' | null = null;

    for (const line of content.split('\n')) {
      if (line.match(/^###?\s*Status/i)) current = 'status';
      else if (line.match(/^###?\s*Facts/i)) current = 'facts';
      else if (line.match(/^###?\s*Timeline/i)) current = 'timeline';
      else if (line.startsWith('- ') && current) {
        result[current].push(line.substring(2));
      }
    }
    return result;
  }

  /** Parse facts JSON string into a string array. */
  private parseFacts(obs: ObservationRow): string[] {
    if (!obs.facts) return [];
    try {
      const parsed = typeof obs.facts === 'string' ? JSON.parse(obs.facts) : obs.facts;
      if (Array.isArray(parsed)) return parsed.filter((f: unknown) => typeof f === 'string');
    } catch {
      // Malformed JSON — skip.
    }
    return [];
  }
}
