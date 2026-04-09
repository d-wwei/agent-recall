import { describe, it, expect } from 'bun:test';
import { TemporalParser } from '../../src/services/worker/search/TemporalParser.js';

// Fixed reference "now" for all deterministic tests
const NOW = new Date('2026-04-09T12:00:00Z');
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parser = new TemporalParser();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Relative anchor offset from NOW in whole days (rounded). */
function anchorOffsetDays(anchorDate: Date): number {
  return Math.round((anchorDate.getTime() - NOW.getTime()) / MS_PER_DAY);
}

// ---------------------------------------------------------------------------
// English fixed patterns
// ---------------------------------------------------------------------------

describe('TemporalParser — English fixed patterns', () => {
  it('parses "yesterday" → anchorDate = -1 day, windowDays = 1', () => {
    const result = parser.parse('show me yesterday', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-1);
    expect(result!.windowDays).toBe(1);
  });

  it('parses "today" → anchorDate = now, windowDays = 1', () => {
    const result = parser.parse('what happened today', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(0);
    expect(result!.windowDays).toBe(1);
  });

  it('parses "this week" → anchorDate = now, windowDays = 7', () => {
    const result = parser.parse('tasks this week', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(0);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "last week" → anchorDate = -7 days, windowDays = 7', () => {
    const result = parser.parse('commits last week', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-7);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "recently" → anchorDate = now, windowDays = 7', () => {
    const result = parser.parse('what did I do recently', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(0);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "last month" → anchorDate = -30 days, windowDays = 30', () => {
    const result = parser.parse('reviews last month', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-30);
    expect(result!.windowDays).toBe(30);
  });
});

// ---------------------------------------------------------------------------
// English dynamic patterns: N days/weeks/months ago
// ---------------------------------------------------------------------------

describe('TemporalParser — English "N ago" patterns', () => {
  it('parses "3 days ago" → offset = -3d, window = 3d', () => {
    const result = parser.parse('bug fixed 3 days ago', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-3);
    expect(result!.windowDays).toBe(3);
  });

  it('parses "1 day ago" (singular) → offset = -1d, window = 1d', () => {
    const result = parser.parse('deployed 1 day ago', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-1);
    expect(result!.windowDays).toBe(1);
  });

  it('parses "2 weeks ago" → offset = -14d, window = 14d', () => {
    const result = parser.parse('sprint review 2 weeks ago', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-14);
    expect(result!.windowDays).toBe(14);
  });

  it('parses "1 week ago" (singular) → offset = -7d, window = 7d', () => {
    const result = parser.parse('meeting 1 week ago', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-7);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "2 months ago" → offset = -60d, window = 60d', () => {
    const result = parser.parse('release 2 months ago', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-60);
    expect(result!.windowDays).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// English dynamic patterns: past N days/weeks
// ---------------------------------------------------------------------------

describe('TemporalParser — English "past N" patterns', () => {
  it('parses "past 5 days" → window = 5d', () => {
    const result = parser.parse('errors in the past 5 days', NOW);
    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(5);
  });

  it('parses "past 2 weeks" → window = 14d', () => {
    const result = parser.parse('changes past 2 weeks', NOW);
    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(14);
  });

  it('parses "past 1 week" (singular) → window = 7d', () => {
    const result = parser.parse('past 1 week activity', NOW);
    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Chinese fixed patterns
// ---------------------------------------------------------------------------

describe('TemporalParser — Chinese fixed patterns', () => {
  it('parses "昨天" → offset = -1d, window = 1d', () => {
    const result = parser.parse('昨天的提交', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-1);
    expect(result!.windowDays).toBe(1);
  });

  it('parses "今天" → offset = 0, window = 1d', () => {
    const result = parser.parse('今天做了什么', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(0);
    expect(result!.windowDays).toBe(1);
  });

  it('parses "上周" → offset = -7d, window = 7d', () => {
    const result = parser.parse('上周的进度', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-7);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "上个月" → offset = -30d, window = 30d', () => {
    const result = parser.parse('上个月的报告', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-30);
    expect(result!.windowDays).toBe(30);
  });

  it('parses "最近" → offset = 0, window = 7d', () => {
    const result = parser.parse('最近有什么更新', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(0);
    expect(result!.windowDays).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Chinese dynamic patterns: N天前 / N周前
// ---------------------------------------------------------------------------

describe('TemporalParser — Chinese "N前" patterns', () => {
  it('parses "3天前" (digit) → offset = -3d, window = 3d', () => {
    const result = parser.parse('3天前修复的 bug', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-3);
    expect(result!.windowDays).toBe(3);
  });

  it('parses "两天前" (Chinese numeral 两) → offset = -2d, window = 2d', () => {
    const result = parser.parse('两天前的会议记录', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-2);
    expect(result!.windowDays).toBe(2);
  });

  it('parses "七天前" (Chinese numeral 七) → offset = -7d, window = 7d', () => {
    const result = parser.parse('七天前部署的版本', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-7);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "一周前" → offset = -7d, window = 7d', () => {
    const result = parser.parse('一周前的设计评审', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-7);
    expect(result!.windowDays).toBe(7);
  });

  it('parses "2周前" (digit) → offset = -14d, window = 14d', () => {
    const result = parser.parse('2周前的需求', NOW);
    expect(result).not.toBeNull();
    expect(anchorOffsetDays(result!.anchorDate)).toBe(-14);
    expect(result!.windowDays).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// Non-temporal queries → null
// ---------------------------------------------------------------------------

describe('TemporalParser — non-temporal returns null', () => {
  it('returns null for a plain keyword query', () => {
    expect(parser.parse('authentication bug fix', NOW)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parser.parse('', NOW)).toBeNull();
  });

  it('returns null for a query with a year but no temporal keyword', () => {
    expect(parser.parse('release notes 2026', NOW)).toBeNull();
  });

  it('returns null for a Chinese query without temporal keywords', () => {
    expect(parser.parse('用户认证问题', NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boost calculation
// ---------------------------------------------------------------------------

describe('TemporalParser — boost calculation', () => {
  it('returns 0.4 for a target exactly at anchorDate (daysDiff = 0, window = 7)', () => {
    // "recently" → window = 7, anchor = now
    const result = parser.parse('recently', NOW)!;
    // target = exactly NOW
    const boost = result.calculateBoost(NOW.getTime());
    expect(boost).toBeCloseTo(0.4, 5);
  });

  it('returns 0 for a target outside the window', () => {
    // "yesterday" → window = 1, anchor = NOW - 1d
    const result = parser.parse('yesterday', NOW)!;
    // target is 5 days ago → daysDiff = 5, window = 1 → boost = max(0, 0.4*(1-5)) < 0 → 0
    const targetEpoch = NOW.getTime() - 5 * MS_PER_DAY;
    expect(result.calculateBoost(targetEpoch)).toBe(0);
  });

  it('returns positive boost for a target inside the window', () => {
    // "last week" → window = 7, anchor = NOW - 7d
    const result = parser.parse('last week', NOW)!;
    // target = 3 days ago → daysDiff = 3, boost = 0.4*(1 - 3/7) ≈ 0.228
    const targetEpoch = NOW.getTime() - 3 * MS_PER_DAY;
    const boost = result.calculateBoost(targetEpoch);
    expect(boost).toBeGreaterThan(0);
    expect(boost).toBeLessThanOrEqual(0.4);
  });

  it('boost value decreases as target moves further from now', () => {
    const result = parser.parse('past 10 days', NOW)!;
    const boost3d = result.calculateBoost(NOW.getTime() - 3 * MS_PER_DAY);
    const boost7d = result.calculateBoost(NOW.getTime() - 7 * MS_PER_DAY);
    expect(boost3d).toBeGreaterThan(boost7d);
  });

  it('boost for "past 7 days" at 7-day boundary is exactly 0', () => {
    // window = 7, daysDiff = 7 → boost = 0.4*(1 - 7/7) = 0
    const result = parser.parse('past 7 days', NOW)!;
    const targetEpoch = NOW.getTime() - 7 * MS_PER_DAY;
    expect(result.calculateBoost(targetEpoch)).toBeCloseTo(0, 5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('TemporalParser — edge cases', () => {
  it('uses current Date when "now" parameter is omitted', () => {
    // Just verify it does not throw and returns a result
    const result = parser.parse('yesterday');
    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(1);
  });

  it('query is case-insensitive for English patterns', () => {
    const result = parser.parse('YESTERDAY news', NOW);
    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(1);
  });

  it('matches pattern within a longer sentence', () => {
    const result = parser.parse('please show commits from last week in the main branch', NOW);
    expect(result).not.toBeNull();
    expect(result!.windowDays).toBe(7);
  });
});
