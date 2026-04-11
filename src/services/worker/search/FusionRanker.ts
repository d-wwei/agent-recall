/**
 * FusionRanker - Adaptive fusion ranking for FTS5 + vector search results
 *
 * Combines BM25 (FTS5) and vector-similarity (SeekDB) scores using
 * query-type-aware weights, observation type weights, and staleness decay.
 */

export interface FusionCandidate {
  id: number;
  vectorScore: number;       // 0-1 vector similarity (1 = perfect match)
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
 * Reciprocal Rank Fusion constant.
 * Controls how much top positions are favored over lower positions.
 * Standard value from the RRF literature (Cormack, Clarke & Buettcher, 2009).
 */
export const RRF_K = 60;

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
const QUERY_WEIGHTS: Record<QueryType, { vector: number; fts5: number }> = {
  exact:    { vector: 0.3, fts5: 0.7 },
  semantic: { vector: 0.8, fts5: 0.2 },
  balanced: { vector: 0.55, fts5: 0.45 },
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

// ─── RRF Helper ──────────────────────────────────────────────────────────────

/**
 * Compute Reciprocal Rank Fusion score from ranks in multiple lists.
 * A candidate appearing in both lists gets contributions from both.
 * Rank is 0-based (0 = best). Null rank means not present in that list.
 */
export function computeRRFScore(vectorRank: number | null, ftsRank: number | null): number {
  let score = 0;
  if (vectorRank !== null) score += 1 / (RRF_K + vectorRank + 1);
  if (ftsRank !== null) score += 1 / (RRF_K + ftsRank + 1);
  return score;
}

// ─── FusionRanker ─────────────────────────────────────────────────────────────

export class FusionRanker {
  /**
   * Classify a query string into one of three query types that drive
   * the vector/fts5 weight split.
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
   * Return the vector/fts5 weight pair for the given query type.
   */
  getWeights(queryType: QueryType): { vector: number; fts5: number } {
    return QUERY_WEIGHTS[queryType];
  }

  /**
   * Rank candidates using Reciprocal Rank Fusion (RRF).
   *
   * RRF score = Σ(1 / (k + rank_i)) for each ranking list the item appears in.
   * Type weight and staleness decay are applied on top of the RRF base score.
   *
   * Results are sorted by finalScore descending.
   */
  rank(candidates: FusionCandidate[], queryType: QueryType): RankedResult[] {
    return this.rankRRF(candidates, queryType);
  }

  /**
   * RRF-based ranking implementation.
   *
   * 1. Sort candidates by vectorScore DESC → assign vector ranks
   * 2. Sort candidates by ftsScore DESC → assign fts ranks
   * 3. Compute RRF score from both rank lists
   * 4. Apply typeWeight and decayFactor on top
   * 5. Sort by final score DESC
   */
  rankRRF(candidates: FusionCandidate[], queryType: QueryType): RankedResult[] {
    if (candidates.length === 0) return [];

    const now = Date.now();

    // Build rank maps — rank 0 = best in each list
    const vectorRanks = new Map<number, number>();
    const ftsRanks = new Map<number, number>();

    // Sort a copy by vectorScore DESC to assign vector ranks
    const byVector = [...candidates].sort((a, b) => b.vectorScore - a.vectorScore);
    for (let i = 0; i < byVector.length; i++) {
      vectorRanks.set(byVector[i].id, i);
    }

    // Sort a copy by ftsScore DESC to assign fts ranks
    const byFts = [...candidates].sort((a, b) => b.ftsScore - a.ftsScore);
    for (let i = 0; i < byFts.length; i++) {
      ftsRanks.set(byFts[i].id, i);
    }

    const ranked: RankedResult[] = candidates.map((c) => {
      const vectorRank = vectorRanks.get(c.id) ?? null;
      const ftsRank = ftsRanks.get(c.id) ?? null;

      const rrfScore = computeRRFScore(vectorRank, ftsRank);
      const typeWeight = TYPE_WEIGHTS[c.type] ?? DEFAULT_TYPE_WEIGHT;
      const decayFactor = this._decayFactor(c, now);

      return {
        ...c,
        finalScore: rrfScore * typeWeight * decayFactor,
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
