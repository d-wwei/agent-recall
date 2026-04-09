/**
 * FusionRanker - Adaptive fusion ranking for FTS5 + ChromaDB search results
 *
 * Combines BM25 (FTS5) and vector-similarity (Chroma) scores using
 * query-type-aware weights, observation type weights, and staleness decay.
 */

export interface FusionCandidate {
  id: number;
  chromaScore: number;       // 0-1 similarity (1 = perfect match)
  ftsScore: number;          // 0-1 normalized BM25 rank
  type: string;              // observation type (decision/bugfix/feature/etc.)
  lastReferencedAt: string | null;
  createdAtEpoch: number;
}

export interface RankedResult extends FusionCandidate {
  finalScore: number;
}

export type QueryType = 'exact' | 'semantic' | 'balanced';

// ─── Constants ────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DECAY_WINDOW_DAYS = 180;
const MAX_DECAY = 0.3;

/**
 * Type weights for observation categories.
 * Higher = more relevant / authoritative.
 */
const TYPE_WEIGHTS: Record<string, number> = {
  decision:  1.0,
  discovery: 0.8,
  bugfix:    0.7,
  feature:   0.6,
  change:    0.5,
  synthesis: 0.5,  // Anti-feedback-loop: synthesis observations ranked below original content
  refactor:  0.4,
};
const DEFAULT_TYPE_WEIGHT = 0.5;

/**
 * Blended weights per query type. Must sum to 1.0.
 */
const QUERY_WEIGHTS: Record<QueryType, { chroma: number; fts5: number }> = {
  exact:    { chroma: 0.3, fts5: 0.7 },
  semantic: { chroma: 0.8, fts5: 0.2 },
  balanced: { chroma: 0.55, fts5: 0.45 },
};

// Regex patterns for query classification
const EXACT_PATTERNS = [
  /\.\w{1,6}(\s|$)/,          // file extension (.ts, .json, .md …)
  /["']/,                      // quoted strings
  /\b[A-Z][A-Z0-9_]{2,}\b/,   // SCREAMING_CASE (≥3 chars, starts uppercase)
  /\b\w+\.\w+\b/,              // dotted names (Class.method)
];

const SEMANTIC_PATTERNS = [
  /\bhow does\b/i,
  /\bwhat is\b/i,
  /\brelated to\b/i,
  /\babout\b/i,
  /关于/,
  /相关/,
  /类似/,
  /如何/,
];

// ─── FusionRanker ─────────────────────────────────────────────────────────────

export class FusionRanker {
  /**
   * Classify a query string into one of three query types that drive
   * the chroma/fts5 weight split.
   */
  classifyQuery(query: string): QueryType {
    // Check exact patterns first (most specific)
    for (const pattern of EXACT_PATTERNS) {
      if (pattern.test(query)) {
        return 'exact';
      }
    }

    // Check semantic patterns
    for (const pattern of SEMANTIC_PATTERNS) {
      if (pattern.test(query)) {
        return 'semantic';
      }
    }

    return 'balanced';
  }

  /**
   * Return the chroma/fts5 weight pair for the given query type.
   */
  getWeights(queryType: QueryType): { chroma: number; fts5: number } {
    return QUERY_WEIGHTS[queryType];
  }

  /**
   * Rank candidates using multi-dimensional scoring:
   *
   *   finalScore = (w.chroma * chromaScore + w.fts5 * ftsScore)
   *                * typeWeight
   *                * decayFactor
   *
   * Results are sorted by finalScore descending.
   */
  rank(candidates: FusionCandidate[], queryType: QueryType): RankedResult[] {
    if (candidates.length === 0) return [];

    const w = this.getWeights(queryType);
    const now = Date.now();

    const ranked: RankedResult[] = candidates.map((c) => {
      const baseScore = w.chroma * c.chromaScore + w.fts5 * c.ftsScore;
      const typeWeight = TYPE_WEIGHTS[c.type] ?? DEFAULT_TYPE_WEIGHT;
      const decayFactor = this._decayFactor(c, now);

      return {
        ...c,
        finalScore: baseScore * typeWeight * decayFactor,
      };
    });

    ranked.sort((a, b) => b.finalScore - a.finalScore);
    return ranked;
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Compute the staleness decay factor for a candidate.
   *
   * Uses lastReferencedAt when available, otherwise falls back to createdAtEpoch.
   *
   *   daysSince  = (now - referenceTime) / MS_PER_DAY
   *   staleness  = min(1.0, daysSince / 180)
   *   decayFactor = 1 - staleness * 0.3
   */
  private _decayFactor(candidate: FusionCandidate, now: number): number {
    const referenceTime = candidate.lastReferencedAt
      ? new Date(candidate.lastReferencedAt).getTime()
      : candidate.createdAtEpoch;

    const daysSince = (now - referenceTime) / MS_PER_DAY;
    const staleness = Math.min(1.0, daysSince / DECAY_WINDOW_DAYS);
    return 1 - staleness * MAX_DECAY;
  }
}
