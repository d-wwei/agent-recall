/**
 * Tests for ResponseParser — parses LLM-generated Markdown responses
 * into structured data for the compilation pipeline.
 *
 * Mock Justification: NONE (0% mock code)
 * - Pure string-parsing functions, no I/O
 *
 * Value: Verifies that parseSynthesisResponse and parseMermaidResponse
 *        correctly extract structured data from LLM output.
 */

import { describe, it, expect } from 'bun:test';
import {
  parseSynthesisResponse,
  parseMermaidResponse,
} from '../../../src/services/compilation/ResponseParser.js';

// ─── parseSynthesisResponse ───────────────────────────────────────────────────

describe('parseSynthesisResponse', () => {
  const WELL_FORMED = `## API Design

The service uses GraphQL for all client-facing endpoints.
REST is used internally for health checks.

## Conflicts

⚠️ Observation #3 ("uses REST") contradicts #7 ("uses GraphQL"). Resolution: keep newer
⚠️ Observation #1 ("v1 schema") contradicts #9 ("v2 schema"). Resolution: keep newer

## Superseded

- #3 superseded by #7: migrated from REST to GraphQL
- #1 superseded by #9: schema upgraded to v2
`;

  it('extracts content with Conflicts and Superseded sections removed', () => {
    const result = parseSynthesisResponse(WELL_FORMED);

    // Content should include the main body
    expect(result.content).toContain('## API Design');
    expect(result.content).toContain('The service uses GraphQL');

    // Conflicts and Superseded sections must be stripped
    expect(result.content).not.toContain('## Conflicts');
    expect(result.content).not.toContain('## Superseded');
    expect(result.content).not.toContain('⚠️');
    expect(result.content).not.toContain('superseded by');
  });

  it('extracts conflicts with correct oldId and newId', () => {
    const result = parseSynthesisResponse(WELL_FORMED);

    expect(result.conflicts).toHaveLength(2);

    expect(result.conflicts[0].oldId).toBe(3);
    expect(result.conflicts[0].newId).toBe(7);

    expect(result.conflicts[1].oldId).toBe(1);
    expect(result.conflicts[1].newId).toBe(9);
  });

  it('extracts conflict descriptions containing both quoted values', () => {
    const result = parseSynthesisResponse(WELL_FORMED);

    expect(result.conflicts[0].description).toContain('uses REST');
    expect(result.conflicts[0].description).toContain('uses GraphQL');
  });

  it('extracts superseded entries with correct oldId, newId and reason', () => {
    const result = parseSynthesisResponse(WELL_FORMED);

    expect(result.superseded).toHaveLength(2);

    expect(result.superseded[0].oldId).toBe(3);
    expect(result.superseded[0].newId).toBe(7);
    expect(result.superseded[0].reason).toBe('migrated from REST to GraphQL');

    expect(result.superseded[1].oldId).toBe(1);
    expect(result.superseded[1].newId).toBe(9);
    expect(result.superseded[1].reason).toBe('schema upgraded to v2');
  });

  it('returns empty arrays when Conflicts section is absent', () => {
    const noConflicts = `## Topic\n\nSome content here.\n\n## Superseded\n\n- #2 superseded by #5: updated\n`;
    const result = parseSynthesisResponse(noConflicts);

    expect(result.conflicts).toEqual([]);
    expect(result.superseded).toHaveLength(1);
  });

  it('returns empty arrays when Superseded section is absent', () => {
    const noSuperseded = `## Topic\n\nSome content here.\n\n## Conflicts\n\n⚠️ Observation #4 ("old") contradicts #8 ("new"). Resolution: keep newer\n`;
    const result = parseSynthesisResponse(noSuperseded);

    expect(result.superseded).toEqual([]);
    expect(result.conflicts).toHaveLength(1);
  });

  it('returns empty arrays when both Conflicts and Superseded sections are absent', () => {
    const plain = `## Just a topic\n\nSome plain content with no special sections.\n`;
    const result = parseSynthesisResponse(plain);

    expect(result.conflicts).toEqual([]);
    expect(result.superseded).toEqual([]);
  });

  it('treats completely plain text (no sections at all) as raw content with empty arrays', () => {
    const raw = 'This is just raw text with no markdown headings.';
    const result = parseSynthesisResponse(raw);

    expect(result.content).toBe(raw);
    expect(result.conflicts).toEqual([]);
    expect(result.superseded).toEqual([]);
  });

  it('handles empty string gracefully', () => {
    const result = parseSynthesisResponse('');

    expect(result.content).toBe('');
    expect(result.conflicts).toEqual([]);
    expect(result.superseded).toEqual([]);
  });

  it('skips malformed conflict lines without throwing', () => {
    const malformed = `## Topic\n\nContent.\n\n## Conflicts\n\n⚠️ This line has no IDs at all.\n⚠️ Observation #5 ("valid") contradicts #10 ("also valid"). Resolution: keep newer\n`;
    const result = parseSynthesisResponse(malformed);

    // Only the well-formed line is extracted; the malformed one is skipped
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].oldId).toBe(5);
    expect(result.conflicts[0].newId).toBe(10);
  });

  it('skips malformed superseded lines without throwing', () => {
    const malformed = `## Topic\n\nContent.\n\n## Superseded\n\n- no IDs here at all\n- #6 superseded by #11: valid reason\n`;
    const result = parseSynthesisResponse(malformed);

    expect(result.superseded).toHaveLength(1);
    expect(result.superseded[0].oldId).toBe(6);
    expect(result.superseded[0].newId).toBe(11);
    expect(result.superseded[0].reason).toBe('valid reason');
  });
});

// ─── parseMermaidResponse ─────────────────────────────────────────────────────

describe('parseMermaidResponse', () => {
  it('extracts a single mermaid code block', () => {
    const response = 'Some text\n```mermaid\ngraph LR\n  A --> B\n```\nMore text';
    const result = parseMermaidResponse(response);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe('graph LR\n  A --> B');
  });

  it('extracts multiple mermaid code blocks', () => {
    const response = [
      '```mermaid',
      'graph LR',
      '  A --> B',
      '```',
      'Some text between blocks',
      '```mermaid',
      'sequenceDiagram',
      '  Alice->>Bob: Hello',
      '```',
    ].join('\n');

    const result = parseMermaidResponse(response);

    expect(result).toHaveLength(2);
    expect(result[0]).toBe('graph LR\n  A --> B');
    expect(result[1]).toBe('sequenceDiagram\n  Alice->>Bob: Hello');
  });

  it('returns empty array when no mermaid blocks are found', () => {
    const response = 'Plain text\n```typescript\nconst x = 1;\n```\nNo mermaid here.';
    const result = parseMermaidResponse(response);

    expect(result).toEqual([]);
  });

  it('returns empty array for empty string', () => {
    expect(parseMermaidResponse('')).toEqual([]);
  });

  it('strips the ```mermaid wrapper and returns only the inner code', () => {
    const response = '```mermaid\ngraph TD\n  X --> Y\n```';
    const result = parseMermaidResponse(response);

    expect(result[0]).not.toContain('```');
    expect(result[0]).not.toContain('mermaid');
    expect(result[0]).toBe('graph TD\n  X --> Y');
  });
});
