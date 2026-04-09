/**
 * TemporalParser - Natural language date/time query parsing
 *
 * Parses temporal expressions from user queries (English and Chinese) and
 * produces anchor dates, time windows, and relevance boost calculations.
 */

export interface TemporalResult {
  /** The reference date anchor for this temporal expression */
  anchorDate: Date;
  /** The time window in days around the anchor date */
  windowDays: number;
  /**
   * Calculate a recency boost for a given target epoch (ms).
   * Returns a value in [0, 0.4] — 0.4 at perfect match, 0 outside window.
   */
  calculateBoost: (targetEpoch: number) => number;
}

// ---------------------------------------------------------------------------
// Chinese numeral helpers
// ---------------------------------------------------------------------------

const CHINESE_DIGIT_MAP: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4,
  '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

/**
 * Parse a Chinese or ASCII numeral string into a JS number.
 * Handles single Chinese characters and multi-digit Arabic numerals.
 */
function parseChineseOrDigit(s: string): number | null {
  if (!s) return null;
  // ASCII digits first
  const n = parseInt(s, 10);
  if (!isNaN(n)) return n;
  // Single Chinese digit
  if (s.length === 1 && CHINESE_DIGIT_MAP[s] !== undefined) {
    return CHINESE_DIGIT_MAP[s];
  }
  // Multi-char Chinese: try character by character (e.g. "二十" = 20 not supported,
  // but single digits are the common case – support "十" alone = 10)
  if (s === '十') return 10;
  return null;
}

// ---------------------------------------------------------------------------
// Internal pattern descriptor
// ---------------------------------------------------------------------------

interface PatternSpec {
  /** A RegExp to match against the lower-cased query */
  re: RegExp;
  /** Given the match array and `now`, return anchor offset (ms from now) and window (days) */
  resolve: (m: RegExpMatchArray, now: Date) => { offsetMs: number; windowDays: number } | null;
}

// ---------------------------------------------------------------------------
// TemporalParser
// ---------------------------------------------------------------------------

export class TemporalParser {
  private readonly patterns: PatternSpec[];

  constructor() {
    this.patterns = buildPatterns();
  }

  /**
   * Parse a temporal expression from `query`.
   *
   * @param query  User query string (English or Chinese).
   * @param now    Reference "now" – defaults to `new Date()`. Pass a fixed
   *               date in tests for deterministic output.
   * @returns      A `TemporalResult` when a temporal expression is found,
   *               `null` otherwise.
   */
  parse(query: string, now: Date = new Date()): TemporalResult | null {
    const lc = query.toLowerCase();

    for (const spec of this.patterns) {
      const m = lc.match(spec.re);
      if (!m) continue;

      const resolved = spec.resolve(m, now);
      if (!resolved) continue;

      const { offsetMs, windowDays } = resolved;
      const anchorDate = new Date(now.getTime() + offsetMs);

      const calculateBoost = (targetEpoch: number): number => {
        const msPerDay = 24 * 60 * 60 * 1000;
        const daysDiff = Math.abs(now.getTime() - targetEpoch) / msPerDay;
        const boost = 0.4 * (1.0 - daysDiff / windowDays);
        return Math.max(0, boost);
      };

      return { anchorDate, windowDays, calculateBoost };
    }

    return null;
  }
}

// ---------------------------------------------------------------------------
// Pattern definitions
// ---------------------------------------------------------------------------

function buildPatterns(): PatternSpec[] {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;

  /**
   * Helper: return a simple fixed-offset spec.
   * offsetDays < 0 means "in the past".
   */
  const fixed = (re: RegExp, offsetDays: number, windowDays: number): PatternSpec => ({
    re,
    resolve: (_m, _now) => ({ offsetMs: offsetDays * MS_PER_DAY, windowDays }),
  });

  return [
    // -----------------------------------------------------------------------
    // English: fixed expressions
    // -----------------------------------------------------------------------
    fixed(/\byesterday\b/, -1, 1),
    fixed(/\btoday\b/, 0, 1),

    // "this week" / "last week" / "recently"
    fixed(/\bthis\s+week\b/, 0, 7),
    fixed(/\blast\s+week\b/, -7, 7),
    fixed(/\brecently\b/, 0, 7),

    // "last month"
    fixed(/\blast\s+month\b/, -30, 30),

    // -----------------------------------------------------------------------
    // English: "N days/weeks/months ago"
    // -----------------------------------------------------------------------
    {
      re: /(\d+)\s+days?\s+ago\b/,
      resolve: (m) => {
        const n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) return null;
        return { offsetMs: -n * MS_PER_DAY, windowDays: n };
      },
    },
    {
      re: /(\d+)\s+weeks?\s+ago\b/,
      resolve: (m) => {
        const n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) return null;
        return { offsetMs: -n * 7 * MS_PER_DAY, windowDays: n * 7 };
      },
    },
    {
      re: /(\d+)\s+months?\s+ago\b/,
      resolve: (m) => {
        const n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) return null;
        return { offsetMs: -n * 30 * MS_PER_DAY, windowDays: n * 30 };
      },
    },

    // -----------------------------------------------------------------------
    // English: "past N days/weeks"
    // -----------------------------------------------------------------------
    {
      re: /\bpast\s+(\d+)\s+days?\b/,
      resolve: (m) => {
        const n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) return null;
        return { offsetMs: 0, windowDays: n };
      },
    },
    {
      re: /\bpast\s+(\d+)\s+weeks?\b/,
      resolve: (m) => {
        const n = parseInt(m[1], 10);
        if (isNaN(n) || n <= 0) return null;
        return { offsetMs: 0, windowDays: n * 7 };
      },
    },

    // -----------------------------------------------------------------------
    // Chinese: fixed expressions (matched against original query, not lc)
    // -----------------------------------------------------------------------
    {
      // 昨天
      re: /昨天/,
      resolve: (_m, _now) => ({ offsetMs: -1 * MS_PER_DAY, windowDays: 1 }),
    },
    {
      // 今天
      re: /今天/,
      resolve: (_m, _now) => ({ offsetMs: 0, windowDays: 1 }),
    },
    {
      // 上周 / 上个星期
      re: /上周|上个星期/,
      resolve: (_m, _now) => ({ offsetMs: -7 * MS_PER_DAY, windowDays: 7 }),
    },
    {
      // 上个月
      re: /上个月/,
      resolve: (_m, _now) => ({ offsetMs: -30 * MS_PER_DAY, windowDays: 30 }),
    },
    {
      // 最近
      re: /最近/,
      resolve: (_m, _now) => ({ offsetMs: 0, windowDays: 7 }),
    },

    // -----------------------------------------------------------------------
    // Chinese: "N天前" (N can be digit or Chinese numeral)
    // -----------------------------------------------------------------------
    {
      re: /([0-9一二两三四五六七八九十]+)天前/,
      resolve: (m) => {
        const n = parseChineseOrDigit(m[1]);
        if (n === null || n <= 0) return null;
        return { offsetMs: -n * MS_PER_DAY, windowDays: n };
      },
    },

    // -----------------------------------------------------------------------
    // Chinese: "N周前" (N can be digit or Chinese numeral)
    // -----------------------------------------------------------------------
    {
      re: /([0-9一二两三四五六七八九十]+)周前/,
      resolve: (m) => {
        const n = parseChineseOrDigit(m[1]);
        if (n === null || n <= 0) return null;
        return { offsetMs: -n * 7 * MS_PER_DAY, windowDays: n * 7 };
      },
    },
  ];
}
