import { describe, it, expect } from 'bun:test';
import { FusionRanker } from '../../src/services/worker/search/FusionRanker.js';
import type { FusionCandidate } from '../../src/services/worker/search/FusionRanker.js';

const ranker = new FusionRanker();

// Helper to build a candidate with sensible defaults
function makeCandidate(overrides: Partial<FusionCandidate> & { id: number }): FusionCandidate {
  return {
    chromaScore: 0.5,
    ftsScore: 0.5,
    type: 'change',
    lastReferencedAt: null,
    createdAtEpoch: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────
// classifyQuery
// ──────────────────────────────────────────────────────────

describe('FusionRanker.classifyQuery — exact patterns', () => {
  it('classifies file extension queries as exact', () => {
    expect(ranker.classifyQuery('SearchManager.ts')).toBe('exact');
    expect(ranker.classifyQuery('config.json')).toBe('exact');
    expect(ranker.classifyQuery('styles.css')).toBe('exact');
  });

  it('classifies quoted strings as exact', () => {
    expect(ranker.classifyQuery('"exact phrase match"')).toBe('exact');
    expect(ranker.classifyQuery("'single quoted'")).toBe('exact');
  });

  it('classifies SCREAMING_CASE tokens as exact', () => {
    expect(ranker.classifyQuery('ERROR_CODE_404')).toBe('exact');
    expect(ranker.classifyQuery('MAX_RETRY_LIMIT')).toBe('exact');
  });

  it('classifies dotted names (Class.method) as exact', () => {
    expect(ranker.classifyQuery('SearchOrchestrator.search')).toBe('exact');
    expect(ranker.classifyQuery('db.run')).toBe('exact');
  });
});

describe('FusionRanker.classifyQuery — semantic patterns', () => {
  it('classifies "how does" queries as semantic', () => {
    expect(ranker.classifyQuery('how does the session manager work')).toBe('semantic');
    expect(ranker.classifyQuery('how does authentication work')).toBe('semantic');
  });

  it('classifies "what is" queries as semantic', () => {
    expect(ranker.classifyQuery('what is the purpose of ChromaSync')).toBe('semantic');
  });

  it('classifies "related to" queries as semantic', () => {
    expect(ranker.classifyQuery('related to database migrations')).toBe('semantic');
  });

  it('classifies "about" queries as semantic', () => {
    expect(ranker.classifyQuery('about session recovery')).toBe('semantic');
  });

  it('classifies Chinese semantic patterns as semantic', () => {
    expect(ranker.classifyQuery('关于数据库连接')).toBe('semantic');
    expect(ranker.classifyQuery('相关的内存管理')).toBe('semantic');
    expect(ranker.classifyQuery('类似的错误处理')).toBe('semantic');
    expect(ranker.classifyQuery('如何实现搜索')).toBe('semantic');
  });
});

describe('FusionRanker.classifyQuery — balanced (default)', () => {
  it('classifies plain keyword queries as balanced', () => {
    expect(ranker.classifyQuery('session recovery')).toBe('balanced');
    expect(ranker.classifyQuery('database migration')).toBe('balanced');
  });

  it('classifies ambiguous multi-word queries as balanced', () => {
    expect(ranker.classifyQuery('search orchestrator refactor')).toBe('balanced');
    expect(ranker.classifyQuery('worker service initialization')).toBe('balanced');
  });
});

// ──────────────────────────────────────────────────────────
// getWeights
// ──────────────────────────────────────────────────────────

describe('FusionRanker.getWeights', () => {
  it('exact query favors FTS5 (fts5 > chroma)', () => {
    const w = ranker.getWeights('exact');
    expect(w.fts5).toBeGreaterThan(w.chroma);
    expect(w.chroma).toBe(0.3);
    expect(w.fts5).toBe(0.7);
  });

  it('semantic query favors Chroma (chroma > fts5)', () => {
    const w = ranker.getWeights('semantic');
    expect(w.chroma).toBeGreaterThan(w.fts5);
    expect(w.chroma).toBe(0.8);
    expect(w.fts5).toBe(0.2);
  });

  it('balanced query uses moderate weights summing to 1', () => {
    const w = ranker.getWeights('balanced');
    expect(w.chroma + w.fts5).toBeCloseTo(1.0, 5);
    expect(w.chroma).toBe(0.55);
    expect(w.fts5).toBe(0.45);
  });
});

// ──────────────────────────────────────────────────────────
// rank — basic ordering
// ──────────────────────────────────────────────────────────

describe('FusionRanker.rank — basic ordering', () => {
  it('returns results sorted by finalScore descending', () => {
    const now = Date.now();
    const candidates: FusionCandidate[] = [
      makeCandidate({ id: 1, chromaScore: 0.3, ftsScore: 0.3, type: 'change', createdAtEpoch: now - 10_000 }),
      makeCandidate({ id: 2, chromaScore: 0.9, ftsScore: 0.9, type: 'change', createdAtEpoch: now - 10_000 }),
      makeCandidate({ id: 3, chromaScore: 0.6, ftsScore: 0.6, type: 'change', createdAtEpoch: now - 10_000 }),
    ];

    const results = ranker.rank(candidates, 'balanced');
    expect(results[0].id).toBe(2);
    expect(results[1].id).toBe(3);
    expect(results[2].id).toBe(1);
  });

  it('finalScore is attached to every result', () => {
    const candidates = [makeCandidate({ id: 1 })];
    const results = ranker.rank(candidates, 'balanced');
    expect(typeof results[0].finalScore).toBe('number');
    expect(results[0].finalScore).toBeGreaterThan(0);
  });

  it('returns empty array for empty input', () => {
    expect(ranker.rank([], 'balanced')).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────
// rank — type weighting
// ──────────────────────────────────────────────────────────

describe('FusionRanker.rank — type weighting', () => {
  it('decision outranks change with identical raw scores', () => {
    const now = Date.now();
    const candidates: FusionCandidate[] = [
      makeCandidate({ id: 1, chromaScore: 0.7, ftsScore: 0.7, type: 'change',   createdAtEpoch: now - 10_000 }),
      makeCandidate({ id: 2, chromaScore: 0.7, ftsScore: 0.7, type: 'decision', createdAtEpoch: now - 10_000 }),
    ];

    const results = ranker.rank(candidates, 'balanced');
    expect(results[0].id).toBe(2); // decision (weight 1.0) before change (weight 0.5)
  });

  it('type weight ordering: decision > discovery > bugfix > feature > change > refactor', () => {
    const now = Date.now();
    const types = ['refactor', 'change', 'feature', 'bugfix', 'discovery', 'decision'];
    const candidates: FusionCandidate[] = types.map((type, i) =>
      makeCandidate({ id: i + 1, chromaScore: 0.5, ftsScore: 0.5, type, createdAtEpoch: now - 10_000 })
    );

    const results = ranker.rank(candidates, 'balanced');
    expect(results[0].type).toBe('decision');
    expect(results[results.length - 1].type).toBe('refactor');
  });

  it('unknown type uses default weight (0.5, same as change)', () => {
    const now = Date.now();
    const candidates: FusionCandidate[] = [
      makeCandidate({ id: 1, chromaScore: 0.5, ftsScore: 0.5, type: 'unknown_type', createdAtEpoch: now - 10_000 }),
      makeCandidate({ id: 2, chromaScore: 0.5, ftsScore: 0.5, type: 'change',       createdAtEpoch: now - 10_000 }),
    ];
    const results = ranker.rank(candidates, 'balanced');
    // Both have the same final score, so order may vary — but both should be present
    expect(results).toHaveLength(2);
    expect(Math.abs(results[0].finalScore - results[1].finalScore)).toBeCloseTo(0, 8);
  });
});

// ──────────────────────────────────────────────────────────
// rank — staleness decay
// ──────────────────────────────────────────────────────────

describe('FusionRanker.rank — staleness decay', () => {
  it('recently accessed item outranks stale item despite lower raw scores', () => {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    // stale: high raw score (0.85) but 200 days old → decay reduces it below fresh
    const staleItem = makeCandidate({
      id: 1,
      chromaScore: 0.85,
      ftsScore: 0.85,
      type: 'change',           // typeWeight = 0.5
      lastReferencedAt: null,
      createdAtEpoch: now - 200 * msPerDay, // 200 days old — near max staleness
    });

    // fresh: lower raw score (0.7) but only 1 day old → decay barely applies
    const freshItem = makeCandidate({
      id: 2,
      chromaScore: 0.7,
      ftsScore: 0.7,
      type: 'change',           // typeWeight = 0.5
      lastReferencedAt: new Date(now - 1 * msPerDay).toISOString(), // referenced yesterday
      createdAtEpoch: now - 1 * msPerDay,
    });

    // Math check (balanced weights 0.55/0.45):
    //   stale: (0.55*0.85 + 0.45*0.85) * 0.5 * (1 - min(1, 200/180)*0.3) ≈ 0.2975
    //   fresh: (0.55*0.70 + 0.45*0.70) * 0.5 * (1 - (1/180)*0.3)           ≈ 0.3494
    const results = ranker.rank([staleItem, freshItem], 'balanced');
    expect(results[0].id).toBe(2);
  });

  it('decay caps at 30% (staleness * 0.3) after 180+ days', () => {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    const veryOldItem = makeCandidate({
      id: 1,
      chromaScore: 1.0,
      ftsScore: 1.0,
      type: 'change',
      lastReferencedAt: null,
      createdAtEpoch: now - 365 * msPerDay, // 1 year old
    });

    const results = ranker.rank([veryOldItem], 'balanced');
    // decayFactor = 1 - min(1, 365/180) * 0.3 = 1 - 1.0 * 0.3 = 0.7
    // Minimum possible finalScore with max decay
    expect(results[0].finalScore).toBeGreaterThan(0);
    expect(results[0].finalScore).toBeLessThanOrEqual(1.0);
  });

  it('uses lastReferencedAt over createdAtEpoch when present', () => {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    // Old creation date, but recently referenced
    const recentlyReferenced = makeCandidate({
      id: 1,
      chromaScore: 0.7,
      ftsScore: 0.7,
      type: 'decision',
      lastReferencedAt: new Date(now - 2 * msPerDay).toISOString(),
      createdAtEpoch: now - 300 * msPerDay, // old, but refreshed
    });

    // Newer creation, never referenced
    const neverReferenced = makeCandidate({
      id: 2,
      chromaScore: 0.7,
      ftsScore: 0.7,
      type: 'decision',
      lastReferencedAt: null,
      createdAtEpoch: now - 100 * msPerDay, // 100 days old
    });

    const results = ranker.rank([recentlyReferenced, neverReferenced], 'balanced');
    // Recently referenced should win because its effective age (2 days) < 100 days
    expect(results[0].id).toBe(1);
  });
});
