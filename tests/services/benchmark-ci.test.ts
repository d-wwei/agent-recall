/**
 * Tests for benchmark-ci.ts — compareWithBaseline logic
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests pure functions: compareWithBaseline
 * - Uses real filesystem with temporary files
 *
 * Value: Ensures regression detection correctly identifies metric drops
 *        above and below the 5% threshold.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { compareWithBaseline, runBenchmark } from '../../scripts/benchmark-ci.js';
import type { BenchmarkBaseline } from '../../scripts/benchmark-ci.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeBaseline(overrides: Partial<BenchmarkBaseline> = {}): BenchmarkBaseline {
  return {
    avgRecallAt5: 0.5,
    avgNdcg: 0.6,
    avgLatencyMs: 100,
    timestamp: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ─── compareWithBaseline ─────────────────────────────────────────────────────

describe('compareWithBaseline', () => {
  const originalBaseline = 'tests/benchmark/results/baseline.json';
  let tmpBaselineDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tmpBaselineDir = join(tmpdir(), `benchmark-ci-test-${Date.now()}`);
    mkdirSync(join(tmpBaselineDir, 'tests', 'benchmark', 'results'), { recursive: true });
    originalCwd = process.cwd();
    process.chdir(tmpBaselineDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tmpBaselineDir, { recursive: true, force: true });
  });

  it('returns pass=true when no baseline file exists', () => {
    const current = makeBaseline();
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(true);
    expect(result.report).toContain('No baseline found');
  });

  it('returns pass=true when metrics match baseline exactly', () => {
    const baseline = makeBaseline();
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    const current = makeBaseline();
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(true);
    expect(result.report).toContain('PASS');
  });

  it('returns pass=true when recall improves', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    // Improve both metrics
    const current = makeBaseline({ avgRecallAt5: 0.7, avgNdcg: 0.8 });
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(true);
    expect(result.report).toContain('PASS');
  });

  it('returns pass=false when recall drops more than 5%', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    // Drop recall by more than 5%
    const current = makeBaseline({ avgRecallAt5: 0.44, avgNdcg: 0.6 });
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(false);
    expect(result.report).toContain('FAIL');
  });

  it('returns pass=false when NDCG drops more than 5%', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    // Drop NDCG by more than 5%
    const current = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.54 });
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(false);
    expect(result.report).toContain('FAIL');
  });

  it('returns pass=true when recall drops exactly at the threshold (< not <=)', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    // Drop recall by exactly 5% (0.05) — threshold is <, so this passes
    const current = makeBaseline({ avgRecallAt5: 0.45, avgNdcg: 0.6 });
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(true);
  });

  it('includes R@5 and NDCG metrics in the report', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    const current = makeBaseline({ avgRecallAt5: 0.55, avgNdcg: 0.65 });
    const result = compareWithBaseline(current);
    expect(result.report).toContain('R@5:');
    expect(result.report).toContain('NDCG:');
    expect(result.report).toContain('baseline:');
    expect(result.report).toContain('delta:');
  });

  it('report includes formatted numbers to 3 decimal places', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    const current = makeBaseline({ avgRecallAt5: 0.123456, avgNdcg: 0.654321 });
    const result = compareWithBaseline(current);
    expect(result.report).toContain('0.123');
    expect(result.report).toContain('0.654');
  });

  it('returns pass=false when BOTH recall and NDCG regress', () => {
    const baseline = makeBaseline({ avgRecallAt5: 0.5, avgNdcg: 0.6 });
    writeFileSync(
      join(tmpBaselineDir, 'tests', 'benchmark', 'results', 'baseline.json'),
      JSON.stringify(baseline, null, 2)
    );

    const current = makeBaseline({ avgRecallAt5: 0.3, avgNdcg: 0.3 });
    const result = compareWithBaseline(current);
    expect(result.pass).toBe(false);
    expect(result.report).toContain('FAIL');
  });
});

// ─── runBenchmark ────────────────────────────────────────────────────────────

describe('runBenchmark', () => {
  it('returns a BenchmarkBaseline object', async () => {
    const result = await runBenchmark();
    expect(result).toBeDefined();
    expect(typeof result.avgRecallAt5).toBe('number');
    expect(typeof result.avgNdcg).toBe('number');
    expect(typeof result.avgLatencyMs).toBe('number');
    expect(typeof result.timestamp).toBe('string');
  });

  it('returns a valid ISO timestamp', async () => {
    const result = await runBenchmark();
    const date = new Date(result.timestamp);
    expect(date.toString()).not.toBe('Invalid Date');
  });

  it('returns non-negative metric values', async () => {
    const result = await runBenchmark();
    expect(result.avgRecallAt5).toBeGreaterThanOrEqual(0);
    expect(result.avgNdcg).toBeGreaterThanOrEqual(0);
    expect(result.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });
});
