/**
 * Tests for SearchExplainer - search result transparency
 *
 * Mock Justification: NONE (0% mock code)
 * - Pure computation class with no I/O or external dependencies.
 * - All tests exercise real logic on in-memory objects.
 *
 * Coverage:
 *  - Semantic-only (vectorScore only)
 *  - Keyword-only (ftsScore only)
 *  - Hybrid (both scores)
 *  - Keyword extraction from various result fields
 *  - Score calculation (max of available scores)
 *  - Edge cases: empty query, missing fields, stopword filtering
 */
import { describe, it, expect } from 'bun:test';
import { SearchExplainer } from '../../src/services/worker/search/SearchExplainer.js';
import type { ExplainedResult } from '../../src/services/worker/search/SearchExplainer.js';

const explainer = new SearchExplainer();

// Minimal helper for building result objects
function makeResult(overrides: Record<string, any> = {}): any {
  return {
    id: 42,
    title: 'Session migration runner fix',
    narrative: 'Fixed migration runner to handle version conflicts gracefully',
    facts: 'The schema_versions table was queried before core tables existed',
    ...overrides,
  };
}

// ─────────────────────────────────────────────
// Match type classification
// ─────────────────────────────────────────────

describe('SearchExplainer — matchType', () => {
  it('returns semantic when only vectorScore is provided', () => {
    const result = explainer.explain('migration fix', makeResult(), 0.85);
    expect(result.matchType).toBe('semantic');
  });

  it('returns keyword when only ftsScore is provided', () => {
    const result = explainer.explain('migration fix', makeResult(), undefined, 0.7);
    expect(result.matchType).toBe('keyword');
  });

  it('returns hybrid when both vectorScore and ftsScore are provided', () => {
    const result = explainer.explain('migration fix', makeResult(), 0.85, 0.7);
    expect(result.matchType).toBe('hybrid');
  });

  it('returns keyword when neither score is provided (fallback)', () => {
    const result = explainer.explain('migration fix', makeResult());
    expect(result.matchType).toBe('keyword');
  });
});

// ─────────────────────────────────────────────
// Source label
// ─────────────────────────────────────────────

describe('SearchExplainer — source', () => {
  it('sets source to vector when only vectorScore is provided', () => {
    const result = explainer.explain('query', makeResult(), 0.9);
    expect(result.source).toBe('vector');
  });

  it('sets source to fts5 when only ftsScore is provided', () => {
    const result = explainer.explain('query', makeResult(), undefined, 0.6);
    expect(result.source).toBe('fts5');
  });

  it('sets source to both when both scores are provided', () => {
    const result = explainer.explain('query', makeResult(), 0.9, 0.6);
    expect(result.source).toBe('both');
  });
});

// ─────────────────────────────────────────────
// Score calculation
// ─────────────────────────────────────────────

describe('SearchExplainer — matchScore', () => {
  it('uses vectorScore when it is the only score', () => {
    const result = explainer.explain('query', makeResult(), 0.75);
    expect(result.matchScore).toBe(0.75);
  });

  it('uses ftsScore when it is the only score', () => {
    const result = explainer.explain('query', makeResult(), undefined, 0.65);
    expect(result.matchScore).toBe(0.65);
  });

  it('takes max of vectorScore and ftsScore in hybrid mode', () => {
    const result = explainer.explain('query', makeResult(), 0.4, 0.9);
    expect(result.matchScore).toBe(0.9);
  });

  it('takes max when vectorScore is higher', () => {
    const result = explainer.explain('query', makeResult(), 0.95, 0.3);
    expect(result.matchScore).toBe(0.95);
  });

  it('returns 0 when no scores provided', () => {
    const result = explainer.explain('query', makeResult());
    expect(result.matchScore).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Keyword extraction
// ─────────────────────────────────────────────

describe('SearchExplainer — matchedKeywords', () => {
  it('finds keywords present in result title', () => {
    const result = explainer.explain(
      'migration runner',
      makeResult({ title: 'migration runner fix', narrative: '', facts: '' })
    );
    expect(result.matchedKeywords).toContain('migration');
    expect(result.matchedKeywords).toContain('runner');
  });

  it('finds keywords present in result narrative', () => {
    const result = explainer.explain(
      'schema conflict',
      makeResult({ title: 'fix', narrative: 'schema version conflict resolved', facts: '' })
    );
    expect(result.matchedKeywords).toContain('schema');
    expect(result.matchedKeywords).toContain('conflict');
  });

  it('finds keywords present in result facts', () => {
    const result = explainer.explain(
      'table exists',
      makeResult({ title: '', narrative: '', facts: 'The table already exists in the database' })
    );
    expect(result.matchedKeywords).toContain('table');
    expect(result.matchedKeywords).toContain('exists');
  });

  it('returns empty array when no keywords match', () => {
    const result = explainer.explain(
      'quantum entanglement photon',
      makeResult({ title: 'database fix', narrative: 'sql schema update', facts: 'migration ran' })
    );
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('returns empty array for empty query', () => {
    const result = explainer.explain('', makeResult());
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('ignores stopwords in keyword extraction', () => {
    const result = explainer.explain(
      'the fix for the schema',
      makeResult({ title: 'schema fix', narrative: '', facts: '' })
    );
    // "the" and "for" are stopwords; should not appear in matched keywords
    expect(result.matchedKeywords).not.toContain('the');
    expect(result.matchedKeywords).not.toContain('for');
    // meaningful words should be matched
    expect(result.matchedKeywords).toContain('fix');
    expect(result.matchedKeywords).toContain('schema');
  });

  it('searches across multiple text fields simultaneously', () => {
    const result = explainer.explain(
      'migration schema session',
      makeResult({
        title: 'migration fix',
        narrative: 'schema updated',
        facts: 'session was restored',
      })
    );
    expect(result.matchedKeywords).toContain('migration');
    expect(result.matchedKeywords).toContain('schema');
    expect(result.matchedKeywords).toContain('session');
  });

  it('is case-insensitive for keyword matching', () => {
    const result = explainer.explain(
      'MIGRATION RUNNER',
      makeResult({ title: 'migration runner fix' })
    );
    expect(result.matchedKeywords).toContain('migration');
    expect(result.matchedKeywords).toContain('runner');
  });
});

// ─────────────────────────────────────────────
// Result ID passthrough
// ─────────────────────────────────────────────

describe('SearchExplainer — id', () => {
  it('passes through the result id', () => {
    const result = explainer.explain('query', makeResult({ id: 99 }), 0.5);
    expect(result.id).toBe(99);
  });

  it('defaults id to 0 when result has no id', () => {
    const result = explainer.explain('query', { title: 'no id here' }, 0.5);
    expect(result.id).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Edge cases
// ─────────────────────────────────────────────

describe('SearchExplainer — edge cases', () => {
  it('handles null result gracefully', () => {
    const result = explainer.explain('query', null, 0.5);
    expect(result.matchedKeywords).toHaveLength(0);
    expect(result.matchScore).toBe(0.5);
    expect(result.id).toBe(0);
  });

  it('handles result with no matching text fields', () => {
    const result = explainer.explain('migration', { id: 1, type: 'decision' }, 0.5);
    expect(result.matchedKeywords).toHaveLength(0);
  });

  it('returns a well-formed ExplainedResult shape', () => {
    const result: ExplainedResult = explainer.explain('query', makeResult(), 0.8, 0.6);
    expect(typeof result.id).toBe('number');
    expect(typeof result.matchScore).toBe('number');
    expect(['semantic', 'keyword', 'hybrid']).toContain(result.matchType);
    expect(Array.isArray(result.matchedKeywords)).toBe(true);
    expect(typeof result.source).toBe('string');
  });
});
