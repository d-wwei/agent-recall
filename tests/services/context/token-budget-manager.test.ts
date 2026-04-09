import { describe, it, expect, beforeEach } from 'bun:test';
import { TokenBudgetManager } from '../../../src/services/context/TokenBudgetManager.js';
import type { Layer } from '../../../src/services/context/TokenBudgetManager.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sum allocations across all layers. */
function sumAllocations(mgr: TokenBudgetManager): number {
  const layers: Layer[] = ['L0', 'L1', 'L2', 'L3'];
  return layers.reduce((acc, l) => acc + mgr.getBudget(l), 0);
}

// ---------------------------------------------------------------------------
// Constructor & clamping
// ---------------------------------------------------------------------------

describe('TokenBudgetManager — constructor', () => {
  it('uses default budget of 3000 when no arg is provided', () => {
    const mgr = new TokenBudgetManager();
    expect(mgr.totalBudget).toBe(3000);
  });

  it('accepts a custom total budget', () => {
    const mgr = new TokenBudgetManager(4000);
    expect(mgr.totalBudget).toBe(4000);
  });

  it('clamps budget to minimum 1500 when value is too small', () => {
    const mgr = new TokenBudgetManager(500);
    expect(mgr.totalBudget).toBe(1500);
  });

  it('clamps budget to minimum 1500 for zero', () => {
    const mgr = new TokenBudgetManager(0);
    expect(mgr.totalBudget).toBe(1500);
  });

  it('clamps budget to maximum 8000 when value is too large', () => {
    const mgr = new TokenBudgetManager(99999);
    expect(mgr.totalBudget).toBe(8000);
  });

  it('clamps budget to maximum 8000 exactly on the boundary', () => {
    const mgr = new TokenBudgetManager(8000);
    expect(mgr.totalBudget).toBe(8000);
  });

  it('accepts exactly 1500 without clamping', () => {
    const mgr = new TokenBudgetManager(1500);
    expect(mgr.totalBudget).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// Layer allocation percentages
// ---------------------------------------------------------------------------

describe('TokenBudgetManager — getBudget (layer percentages)', () => {
  it('L0 receives 8% of totalBudget (floored)', () => {
    const mgr = new TokenBudgetManager(3000);
    expect(mgr.getBudget('L0')).toBe(Math.floor(3000 * 0.08));
  });

  it('L1 receives 15% of totalBudget (floored)', () => {
    const mgr = new TokenBudgetManager(3000);
    expect(mgr.getBudget('L1')).toBe(Math.floor(3000 * 0.15));
  });

  it('L2 receives 60% of totalBudget (floored)', () => {
    const mgr = new TokenBudgetManager(3000);
    expect(mgr.getBudget('L2')).toBe(Math.floor(3000 * 0.60));
  });

  it('L3 receives the remainder so the total is exact', () => {
    const mgr = new TokenBudgetManager(3000);
    const l0 = Math.floor(3000 * 0.08);
    const l1 = Math.floor(3000 * 0.15);
    const l2 = Math.floor(3000 * 0.60);
    const expectedL3 = 3000 - l0 - l1 - l2;
    expect(mgr.getBudget('L3')).toBe(expectedL3);
  });

  it('layer allocations sum to exactly totalBudget (default 3000)', () => {
    const mgr = new TokenBudgetManager(3000);
    expect(sumAllocations(mgr)).toBe(3000);
  });

  it('layer allocations sum to exactly totalBudget for an odd number', () => {
    // 1777 is intentionally chosen to force rounding
    const mgr = new TokenBudgetManager(1777);
    expect(sumAllocations(mgr)).toBe(1777);
  });

  it('layer allocations sum to exactly totalBudget at max budget (8000)', () => {
    const mgr = new TokenBudgetManager(8000);
    expect(sumAllocations(mgr)).toBe(8000);
  });

  it('layer allocations sum to exactly totalBudget at min budget (1500)', () => {
    const mgr = new TokenBudgetManager(1500);
    expect(sumAllocations(mgr)).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// remaining / canFit / consume
// ---------------------------------------------------------------------------

describe('TokenBudgetManager — remaining, canFit, consume', () => {
  let mgr: TokenBudgetManager;

  beforeEach(() => {
    mgr = new TokenBudgetManager(3000);
  });

  it('remaining equals getBudget before any consumption', () => {
    const layers: Layer[] = ['L0', 'L1', 'L2', 'L3'];
    for (const layer of layers) {
      expect(mgr.remaining(layer)).toBe(mgr.getBudget(layer));
    }
  });

  it('canFit returns true when tokens fit within remaining budget', () => {
    expect(mgr.canFit('L2', 100)).toBe(true);
  });

  it('canFit returns false when tokens exceed remaining budget', () => {
    const budget = mgr.getBudget('L0');
    expect(mgr.canFit('L0', budget + 1)).toBe(false);
  });

  it('canFit returns true for exactly the full remaining budget', () => {
    const budget = mgr.getBudget('L1');
    expect(mgr.canFit('L1', budget)).toBe(true);
  });

  it('consume reduces remaining by the consumed amount', () => {
    const before = mgr.remaining('L2');
    mgr.consume('L2', 100);
    expect(mgr.remaining('L2')).toBe(before - 100);
  });

  it('multiple consume calls accumulate correctly', () => {
    const before = mgr.remaining('L1');
    mgr.consume('L1', 50);
    mgr.consume('L1', 75);
    expect(mgr.remaining('L1')).toBe(before - 125);
  });

  it('consume on one layer does not affect other layers', () => {
    const l0Before = mgr.remaining('L0');
    const l2Before = mgr.remaining('L2');
    mgr.consume('L1', 200);
    expect(mgr.remaining('L0')).toBe(l0Before);
    expect(mgr.remaining('L2')).toBe(l2Before);
  });

  it('canFit returns false after consumption leaves insufficient space', () => {
    const budget = mgr.getBudget('L3');
    mgr.consume('L3', budget - 5);
    expect(mgr.canFit('L3', 10)).toBe(false);
  });

  it('remaining can go negative after over-consumption (no enforcement)', () => {
    const budget = mgr.getBudget('L0');
    mgr.consume('L0', budget + 50);
    expect(mgr.remaining('L0')).toBe(-50);
  });
});

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('TokenBudgetManager.estimateTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(TokenBudgetManager.estimateTokens('')).toBe(0);
  });

  it('returns ceil(length / 4) for a short string', () => {
    // "hello" length=5 → ceil(5/4) = 2
    expect(TokenBudgetManager.estimateTokens('hello')).toBe(2);
  });

  it('returns exactly length/4 when divisible', () => {
    // 8 chars → ceil(8/4) = 2
    expect(TokenBudgetManager.estimateTokens('12345678')).toBe(2);
  });

  it('rounds up when length is not divisible by 4', () => {
    // 9 chars → ceil(9/4) = 3
    expect(TokenBudgetManager.estimateTokens('123456789')).toBe(3);
  });

  it('handles a longer string correctly', () => {
    const text = 'a'.repeat(100);
    expect(TokenBudgetManager.estimateTokens(text)).toBe(25);
  });

  it('handles a single character', () => {
    expect(TokenBudgetManager.estimateTokens('x')).toBe(1);
  });
});
