/**
 * Tests for search quality metric calculations.
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests are pure-function unit tests with no I/O
 * - calculateRecallAtK and calculateNDCG are deterministic
 *
 * Value: Ensures metric formulas are correct before running the baseline benchmark
 */

import { describe, it, expect } from 'bun:test';
import { calculateRecallAtK, calculateNDCG } from './search-benchmark.js';

// ---------------------------------------------------------------------------
// calculateRecallAtK
// ---------------------------------------------------------------------------

describe('calculateRecallAtK', () => {
  it('returns 1.0 for a perfect match (all expected found in top K)', () => {
    const hits = [1, 2, 3, 4, 5];
    const expected = [1, 2, 3];
    expect(calculateRecallAtK(hits, expected, 5)).toBeCloseTo(1.0);
  });

  it('returns correct fraction for partial match', () => {
    const hits = [1, 99, 2, 99, 99]; // 2 of 3 expected found in top 5
    const expected = [1, 2, 3];
    expect(calculateRecallAtK(hits, expected, 5)).toBeCloseTo(2 / 3);
  });

  it('returns 0.0 when no expected IDs appear in top K', () => {
    const hits = [10, 20, 30, 40, 50];
    const expected = [1, 2, 3];
    expect(calculateRecallAtK(hits, expected, 5)).toBeCloseTo(0.0);
  });

  it('returns 1.0 when expected is empty (vacuously true)', () => {
    const hits = [1, 2, 3];
    const expected: number[] = [];
    expect(calculateRecallAtK(hits, expected, 5)).toBe(1.0);
  });

  it('respects the K cutoff — hits beyond K are ignored', () => {
    // expected IDs appear only at position 6+ (beyond K=5)
    const hits = [10, 20, 30, 40, 50, 1, 2, 3];
    const expected = [1, 2, 3];
    expect(calculateRecallAtK(hits, expected, 5)).toBeCloseTo(0.0);
  });

  it('returns 1.0 when all expected appear in exactly K positions', () => {
    const hits = [1, 2, 3];
    const expected = [1, 2, 3];
    expect(calculateRecallAtK(hits, expected, 3)).toBeCloseTo(1.0);
  });

  it('handles K larger than the hits list without error', () => {
    const hits = [1, 2];
    const expected = [1, 2, 3];
    // Only 2 of 3 expected found (no out-of-bounds error)
    expect(calculateRecallAtK(hits, expected, 10)).toBeCloseTo(2 / 3);
  });
});

// ---------------------------------------------------------------------------
// calculateNDCG
// ---------------------------------------------------------------------------

describe('calculateNDCG', () => {
  it('returns 1.0 for a perfect ranking (all expected at top positions)', () => {
    const hits = [1, 2, 3, 99, 99];
    const expected = [1, 2, 3];
    expect(calculateNDCG(hits, expected, 5)).toBeCloseTo(1.0);
  });

  it('returns less than 1.0 when relevant docs appear later in the ranking', () => {
    // All 3 relevant docs present but at positions 3, 4, 5 (1-based) — penalised
    const hits = [99, 99, 1, 2, 3];
    const expected = [1, 2, 3];
    const score = calculateNDCG(hits, expected, 5);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1.0);
  });

  it('returns 0.0 when no expected IDs appear in top K', () => {
    const hits = [10, 20, 30, 40, 50];
    const expected = [1, 2, 3];
    expect(calculateNDCG(hits, expected, 5)).toBeCloseTo(0.0);
  });

  it('returns 1.0 when expected is empty (vacuously true)', () => {
    const hits = [1, 2, 3];
    const expected: number[] = [];
    expect(calculateNDCG(hits, expected, 5)).toBe(1.0);
  });

  it('a single relevant doc at position 1 scores higher than at position 5', () => {
    const hitsFirst = [1, 99, 99, 99, 99];
    const hitsLast  = [99, 99, 99, 99, 1];
    const expected = [1];

    const scoreFirst = calculateNDCG(hitsFirst, expected, 5);
    const scoreLast  = calculateNDCG(hitsLast, expected, 5);

    expect(scoreFirst).toBeGreaterThan(scoreLast);
  });

  it('is monotonically non-decreasing as more relevant docs appear earlier', () => {
    const expected = [1, 2];
    // Perfect: both at top
    const perfect  = calculateNDCG([1, 2, 99, 99, 99], expected, 5);
    // Partial: one at top, one missing
    const partial  = calculateNDCG([1, 99, 99, 99, 99], expected, 5);
    // Zero: neither found
    const zero     = calculateNDCG([99, 99, 99, 99, 99], expected, 5);

    expect(perfect).toBeGreaterThanOrEqual(partial);
    expect(partial).toBeGreaterThanOrEqual(zero);
  });

  it('handles K larger than hits list without error', () => {
    const hits = [1];
    const expected = [1, 2];
    // 1 of 2 found at position 1 — should not throw
    const score = calculateNDCG(hits, expected, 10);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(1.0);
  });
});
