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
 * Merge strategy: when ANTHROPIC_API_KEY is set and AI merge is enabled,
 * aiMerge() calls the LLM for intelligent synthesis; otherwise structuredMerge
 * classifies observations into Status/Facts/Timeline sections, deduplicates,
 * and produces clean Markdown output.
 */

import type { CompiledKnowledgeRow } from './OrientStage.js';
import type { TopicGroup, ObservationRow, CompiledPage, CompilationContext, EvidenceEntry, AIMergeResult } from '../types.js';
import { LLMCompiler } from '../LLMCompiler.js';
import { buildSynthesisPrompt, buildMermaidPrompt } from '../prompts.js';
import { parseSynthesisResponse, parseMermaidResponse } from '../ResponseParser.js';

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

// ─── ConsolidateStage ────────────────────────────────────────────────────────

export class ConsolidateStage {
  /**
   * Returns a configured LLMCompiler if an API key is present and AI merge is
   * not explicitly disabled via AGENT_RECALL_AI_MERGE_ENABLED=false.
   * Returns null when the feature should be skipped.
   */
  private getLLMCompiler(): LLMCompiler | null {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const aiEnabled = process.env.AGENT_RECALL_AI_MERGE_ENABLED !== 'false';
    if (!apiKey || !aiEnabled) return null;
    const model = process.env.AGENT_RECALL_COMPILATION_MODEL || 'claude-opus-4-6';
    return new LLMCompiler({ apiKey, model });
  }

  /**
   * Merge topic groups into compiled pages.
   *
   * When an API key is configured (and AI merge is not disabled), each topic
   * group is merged via LLM synthesis. Otherwise structuredMerge is used as
   * the fallback.
   *
   * @param groups - Topic groups from GatherStage
   * @param existingKnowledge - Current compiled knowledge from OrientStage
   * @param _ctx - Compilation context
   */
  async execute(
    groups: TopicGroup[],
    existingKnowledge: Map<string, CompiledKnowledgeRow>,
    _ctx: CompilationContext
  ): Promise<CompiledPage[]> {
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

      const classification = dominantClassification(group.observations);

      // Confidence: high if all observations agree on classification,
      // medium if mixed types are present
      const classifications = new Set(group.observations.map(o => classifyObservation(o)));
      const confidence = classifications.size === 1 ? 'high' : 'medium';

      // Build evidence timeline from source observations
      const evidenceTimeline: EvidenceEntry[] = group.observations.map(obs => ({
        observationId: obs.id,
        date: obs.created_at_epoch,
        type: obs.type,
        title: obs.title,
        summary: (obs.narrative || '').substring(0, 100),
      }));

      // Attempt AI merge; fall back to structured merge on null result
      const aiResult = await this.aiMerge(group.topic, group.observations, existingContent);
      const content = aiResult
        ? aiResult.content
        : this.structuredMerge(group.topic, group.observations, existingContent);

      const page: CompiledPage = {
        topic: group.topic,
        content,
        sourceObservationIds: allIds,
        confidence,
        classification,
        evidenceTimeline,
      };

      if (aiResult) {
        page.aiSuperseded = aiResult.superseded;
        page.tokensUsed = aiResult.tokensUsed;
      }

      pages.push(page);
    }

    return pages;
  }

  /**
   * AI-powered merge using the Anthropic Messages API.
   *
   * Returns null when no API key is configured, AI merge is disabled, or the
   * LLM call fails — the caller must fall back to structuredMerge in that case.
   */
  private async aiMerge(topic: string, observations: ObservationRow[], existingContent: string | null): Promise<AIMergeResult | null> {
    const compiler = this.getLLMCompiler();
    if (!compiler) return null;

    const prompt = buildSynthesisPrompt(topic, observations, existingContent);
    const response = await compiler.call(prompt);
    if (!response) return null;

    const parsed = parseSynthesisResponse(response);
    return {
      content: parsed.content,
      conflicts: parsed.conflicts,
      superseded: parsed.superseded,
      tokensUsed: compiler.getTotalTokensUsed(),
    };
  }

  /**
   * Generate Mermaid diagrams that visualise cross-topic relationships.
   *
   * Called after execute() completes. Returns a synthetic CompiledPage with
   * topic '_mermaid_diagrams', or null if generation is disabled / unavailable.
   */
  async generateMermaidDiagrams(pages: CompiledPage[], _ctx: CompilationContext): Promise<CompiledPage | null> {
    const mermaidEnabled = process.env.AGENT_RECALL_MERMAID_ENABLED !== 'false';
    if (!mermaidEnabled) return null;

    const compiler = this.getLLMCompiler();
    if (!compiler) return null;

    const pageData = pages.map(p => ({ topic: p.topic, content: p.content }));
    const prompt = buildMermaidPrompt(pageData);
    if (!prompt) return null;

    const response = await compiler.call(prompt);
    if (!response) return null;

    const diagrams = parseMermaidResponse(response);
    if (diagrams.length === 0) return null;

    const content = diagrams.map(d => '```mermaid\n' + d + '\n```').join('\n\n');
    return {
      topic: '_mermaid_diagrams',
      content,
      sourceObservationIds: pages.flatMap(p => p.sourceObservationIds),
      confidence: 'medium' as const,
      classification: 'fact' as const,
      evidenceTimeline: [],
    };
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
