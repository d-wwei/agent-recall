/**
 * Prompt builders for the AI compilation pipeline.
 *
 * These functions construct prompt strings for the Anthropic Messages API
 * used in ConsolidateStage (synthesis) and the diagram generation step.
 */

import type { ObservationRow } from './types.js';

// ─── buildSynthesisPrompt ─────────────────────────────────────────────────────

const NARRATIVE_MAX_CHARS = 300;

/**
 * Build a prompt that instructs an LLM to merge observations into a
 * structured knowledge page for the given topic.
 *
 * @param topic           - The topic/concept name being compiled.
 * @param observations    - Observations to merge.
 * @param existingContent - Existing compiled content, or null if none.
 * @returns Prompt string ready for the Anthropic Messages API.
 */
export function buildSynthesisPrompt(
  topic: string,
  observations: ObservationRow[],
  existingContent: string | null
): string {
  const obsLines = observations.map(obs => {
    const date = obs.created_at_epoch;
    const title = obs.title ?? '(no title)';
    const narrative = obs.narrative
      ? obs.narrative.substring(0, NARRATIVE_MAX_CHARS)
      : '(no narrative)';
    return `  - id=${obs.id} type=${obs.type} date=${date} title="${title}" narrative="${narrative}"`;
  }).join('\n');

  const existingBlock = existingContent
    ? `Existing knowledge:\n${existingContent}`
    : 'No existing knowledge';

  return `You are a knowledge compiler. Your task is to merge observations about the topic "${topic}" into a structured knowledge page.

${existingBlock}

New observations to integrate:
${obsLines}

Instructions:
- Replace status updates: for STATUS information (current state, decisions), replace old values with the newest.
- Accumulate facts: for FACTS (permanent truths, discoveries, features), append — do not replace.
- Add events to timeline: for EVENTS (bugfixes, refactors, dated occurrences), add entries to the Timeline.
- Detect contradictions: if two observations conflict, note them under Conflicts.
- Preserve observation IDs: each bullet in the output must reference the source observation id(s).
- List superseded observations: if a new observation makes an older one obsolete, list the obsolete IDs under Superseded.

Required output format (use only these sections; omit Conflicts and Superseded if not applicable):

### Status
### Facts
### Timeline
### Conflicts (only if detected)
### Superseded (only if applicable)
`;
}

// ─── buildMermaidPrompt ───────────────────────────────────────────────────────

/**
 * Build a prompt asking the LLM to generate 1–3 Mermaid diagrams that
 * visualise relationships across the provided knowledge pages.
 *
 * @param pages - Array of compiled knowledge pages with topic and content.
 * @returns Prompt string, or empty string if pages array is empty.
 */
export function buildMermaidPrompt(
  pages: Array<{ topic: string; content: string }>
): string {
  if (pages.length === 0) {
    return '';
  }

  const pagesBlock = pages.map(p => `### ${p.topic}\n${p.content}`).join('\n\n');

  return `You are a diagram generator. Based on the following knowledge pages, generate 1 to 3 Mermaid diagrams that best visualise the key relationships, flows, or structures described.

Knowledge pages:

${pagesBlock}

Requirements:
- Output only valid Mermaid diagram syntax.
- Each diagram must be wrapped in a fenced code block labelled \`\`\`mermaid.
- Choose diagram types (flowchart, sequenceDiagram, classDiagram, etc.) that best suit the content.
- Keep diagrams concise — prefer clarity over exhaustiveness.
`;
}
