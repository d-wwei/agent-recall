/**
 * Tests for compilation prompt builders.
 *
 * Mock Justification: NONE (0% mock code)
 * - Pure string computation, no DB or I/O needed.
 *
 * Coverage:
 * buildSynthesisPrompt:
 * 1. Includes the topic name
 * 2. Includes all observation IDs
 * 3. Includes all observation types
 * 4. Includes existing content when provided
 * 5. Includes "No existing knowledge" when existingContent is null
 * 6. Includes observation dates (created_at_epoch)
 * 7. Includes observation titles (when present)
 * 8. Includes observation narratives truncated to 300 chars
 * 9. Works with multiple observations
 *
 * buildMermaidPrompt:
 * 10. Includes all page topics
 * 11. Includes all page content
 * 12. Returns empty string for an empty array
 */

import { describe, it, expect } from 'bun:test';
import { buildSynthesisPrompt, buildMermaidPrompt } from '../../../src/services/compilation/prompts.js';
import type { ObservationRow } from '../../../src/services/compilation/types.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeObs(overrides: Partial<ObservationRow> = {}): ObservationRow {
  return {
    id: 1,
    type: 'change',
    title: 'Test title',
    subtitle: null,
    narrative: 'Test narrative',
    facts: null,
    concepts: null,
    project: 'test-project',
    created_at_epoch: 1700000000000,
    ...overrides,
  };
}

// ─── buildSynthesisPrompt ────────────────────────────────────────────────────

describe('buildSynthesisPrompt', () => {
  it('includes the topic name', () => {
    const obs = makeObs();
    const result = buildSynthesisPrompt('Authentication', [obs], null);
    expect(result).toContain('Authentication');
  });

  it('includes the observation ID', () => {
    const obs = makeObs({ id: 42 });
    const result = buildSynthesisPrompt('Auth', [obs], null);
    expect(result).toContain('42');
  });

  it('includes the observation type', () => {
    const obs = makeObs({ type: 'discovery' });
    const result = buildSynthesisPrompt('Auth', [obs], null);
    expect(result).toContain('discovery');
  });

  it('includes existing content when provided', () => {
    const obs = makeObs();
    const existing = '### Status\n- Using OAuth2';
    const result = buildSynthesisPrompt('Auth', [obs], existing);
    expect(result).toContain('### Status\n- Using OAuth2');
  });

  it('includes "No existing knowledge" when existingContent is null', () => {
    const obs = makeObs();
    const result = buildSynthesisPrompt('Auth', [obs], null);
    expect(result).toContain('No existing knowledge');
  });

  it('includes the observation created_at_epoch date', () => {
    const obs = makeObs({ created_at_epoch: 1700001234567 });
    const result = buildSynthesisPrompt('Auth', [obs], null);
    expect(result).toContain('1700001234567');
  });

  it('includes the observation title when present', () => {
    const obs = makeObs({ title: 'OAuth migration' });
    const result = buildSynthesisPrompt('Auth', [obs], null);
    expect(result).toContain('OAuth migration');
  });

  it('truncates narrative to 300 characters', () => {
    const longNarrative = 'x'.repeat(500);
    const obs = makeObs({ narrative: longNarrative });
    const result = buildSynthesisPrompt('Auth', [obs], null);
    // The full 500-char narrative should NOT appear; the truncated 300-char version should
    expect(result).not.toContain(longNarrative);
    expect(result).toContain('x'.repeat(300));
  });

  it('includes all observations when multiple are provided', () => {
    const obs1 = makeObs({ id: 10, type: 'decision' });
    const obs2 = makeObs({ id: 20, type: 'bugfix' });
    const obs3 = makeObs({ id: 30, type: 'feature' });
    const result = buildSynthesisPrompt('Auth', [obs1, obs2, obs3], null);
    expect(result).toContain('10');
    expect(result).toContain('20');
    expect(result).toContain('30');
    expect(result).toContain('decision');
    expect(result).toContain('bugfix');
    expect(result).toContain('feature');
  });
});

// ─── buildMermaidPrompt ──────────────────────────────────────────────────────

describe('buildMermaidPrompt', () => {
  it('includes all page topics', () => {
    const pages = [
      { topic: 'Authentication', content: 'Auth content here' },
      { topic: 'Database', content: 'DB content here' },
    ];
    const result = buildMermaidPrompt(pages);
    expect(result).toContain('Authentication');
    expect(result).toContain('Database');
  });

  it('includes all page content', () => {
    const pages = [
      { topic: 'Auth', content: 'Uses OAuth2 with JWT tokens' },
      { topic: 'Cache', content: 'Redis cluster with 3 nodes' },
    ];
    const result = buildMermaidPrompt(pages);
    expect(result).toContain('Uses OAuth2 with JWT tokens');
    expect(result).toContain('Redis cluster with 3 nodes');
  });

  it('returns empty string for an empty pages array', () => {
    const result = buildMermaidPrompt([]);
    expect(result).toBe('');
  });
});
