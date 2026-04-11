/**
 * ResponseParser — parses LLM-generated Markdown responses into structured data.
 *
 * Used by the compilation pipeline to extract structured metadata
 * (conflicts, superseded entries) from AI synthesis output.
 */

// ─── Exported Types ───────────────────────────────────────────────────────────

export interface ConflictEntry {
  oldId: number;
  newId: number;
  description: string;
}

export interface SupersededEntry {
  oldId: number;
  newId: number;
  reason: string;
}

export interface SynthesisResult {
  content: string;
  conflicts: ConflictEntry[];
  superseded: SupersededEntry[];
}

// ─── Section Boundaries ───────────────────────────────────────────────────────

/**
 * Regex that matches a level-2 heading introducing the Conflicts section.
 * Handles optional leading whitespace and any casing.
 */
const CONFLICTS_HEADING_RE = /^##\s+Conflicts\s*$/im;

/**
 * Regex that matches a level-2 heading introducing the Superseded section.
 */
const SUPERSEDED_HEADING_RE = /^##\s+Superseded\s*$/im;

/**
 * Matches a conflict line produced by the LLM.
 *
 * Example:
 *   ⚠️ Observation #3 ("uses REST") contradicts #7 ("uses GraphQL"). Resolution: keep newer
 *
 * Capture groups:
 *   1 → oldId  (digits after first #)
 *   2 → old quoted label (text inside first pair of quotes, may be absent)
 *   3 → newId  (digits after "contradicts #")
 *   4 → new quoted label (text inside second pair of quotes, may be absent)
 */
const CONFLICT_LINE_RE =
  /⚠️[^#]*#(\d+)\s*(?:\("([^"]*)"\))?\s*contradicts\s*#(\d+)\s*(?:\("([^"]*)"\))?/i;

/**
 * Matches a superseded line produced by the LLM.
 *
 * Example:
 *   - #3 superseded by #7: migrated from REST to GraphQL
 *
 * Capture groups:
 *   1 → oldId
 *   2 → newId
 *   3 → reason (everything after the colon, trimmed)
 */
const SUPERSEDED_LINE_RE = /^-\s*#(\d+)\s+superseded\s+by\s+#(\d+)\s*:\s*(.+)$/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Split the response into named sections.
 * Returns an object with the text that belongs to each section
 * (Conflicts, Superseded) and the remainder (everything else).
 */
function splitSections(response: string): {
  body: string;
  conflictsSection: string;
  supersededSection: string;
} {
  // Find heading positions
  const conflictsMatch = CONFLICTS_HEADING_RE.exec(response);
  const supersededMatch = SUPERSEDED_HEADING_RE.exec(response);

  if (!conflictsMatch && !supersededMatch) {
    return { body: response, conflictsSection: '', supersededSection: '' };
  }

  // Build an ordered list of section starts so we can slice between them.
  type SectionMark = { name: 'conflicts' | 'superseded'; index: number; end: number };
  const marks: SectionMark[] = [];

  if (conflictsMatch) {
    marks.push({ name: 'conflicts', index: conflictsMatch.index, end: conflictsMatch.index + conflictsMatch[0].length });
  }
  if (supersededMatch) {
    marks.push({ name: 'superseded', index: supersededMatch.index, end: supersededMatch.index + supersededMatch[0].length });
  }
  marks.sort((a, b) => a.index - b.index);

  let conflictsSection = '';
  let supersededSection = '';
  let body = response;

  // Process sections from last to first so that slicing indices stay valid.
  for (let i = marks.length - 1; i >= 0; i--) {
    const mark = marks[i];
    // The section content runs from after the heading to the start of the
    // next known section (or end of string).
    const sectionEnd = i < marks.length - 1 ? marks[i + 1].index : response.length;
    const sectionText = response.slice(mark.end, sectionEnd);
    const fullBlock = response.slice(mark.index, sectionEnd);

    if (mark.name === 'conflicts') conflictsSection = sectionText;
    if (mark.name === 'superseded') supersededSection = sectionText;

    // Remove this block from body
    body = body.slice(0, mark.index) + body.slice(sectionEnd);
  }

  return { body: body.trimEnd(), conflictsSection, supersededSection };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse an LLM synthesis response into structured data.
 *
 * - `content`: The Markdown text with Conflicts and Superseded sections removed.
 * - `conflicts`: Parsed conflict entries (oldId, newId, description).
 * - `superseded`: Parsed superseded entries (oldId, newId, reason).
 *
 * Gracefully handles:
 * - Missing sections → empty arrays
 * - Malformed response (no sections) → content = raw text, empty arrays
 * - Malformed individual lines → skipped, parsing continues
 */
export function parseSynthesisResponse(response: string): SynthesisResult {
  if (!response) {
    return { content: '', conflicts: [], superseded: [] };
  }

  const { body, conflictsSection, supersededSection } = splitSections(response);

  // ── Parse conflicts ────────────────────────────────────────────────────────
  const conflicts: ConflictEntry[] = [];
  for (const line of conflictsSection.split('\n')) {
    try {
      const m = CONFLICT_LINE_RE.exec(line);
      if (!m) continue;
      const oldId = parseInt(m[1], 10);
      const newId = parseInt(m[3], 10);
      const oldLabel = m[2] ?? '';
      const newLabel = m[4] ?? '';
      const description = oldLabel && newLabel
        ? `"${oldLabel}" vs "${newLabel}"`
        : line.trim();
      conflicts.push({ oldId, newId, description });
    } catch {
      // Skip malformed line, continue parsing.
    }
  }

  // ── Parse superseded ───────────────────────────────────────────────────────
  const superseded: SupersededEntry[] = [];
  for (const line of supersededSection.split('\n')) {
    try {
      const m = SUPERSEDED_LINE_RE.exec(line.trim());
      if (!m) continue;
      const oldId = parseInt(m[1], 10);
      const newId = parseInt(m[2], 10);
      const reason = m[3].trim();
      superseded.push({ oldId, newId, reason });
    } catch {
      // Skip malformed line, continue parsing.
    }
  }

  return { content: body, conflicts, superseded };
}

/**
 * Extract mermaid diagram code from LLM response.
 *
 * Returns an array of mermaid diagram strings (without the ```mermaid wrapper).
 * Returns an empty array if no blocks are found.
 */
export function parseMermaidResponse(response: string): string[] {
  if (!response) return [];

  const results: string[] = [];
  const MERMAID_BLOCK_RE = /```mermaid\n([\s\S]*?)```/g;

  let match: RegExpExecArray | null;
  while ((match = MERMAID_BLOCK_RE.exec(response)) !== null) {
    results.push(match[1].replace(/\n$/, ''));
  }

  return results;
}
