/**
 * Search Quality Benchmark — Phase 1 Baseline
 *
 * Measures R@5 and NDCG@5 for the current SQLite/FTS5 search pipeline
 * BEFORE any retrieval improvements. Run this first to establish a baseline,
 * then run after each optimisation to validate improvement.
 *
 * Usage:
 *   bun tests/benchmark/search-benchmark.ts
 */

import { SessionStore } from '../../src/services/sqlite/SessionStore.js';
import { SessionSearch } from '../../src/services/sqlite/SessionSearch.js';
import { seedBenchmarkData } from './fixtures/seed-data.js';
import type { SeedResult } from './fixtures/seed-data.js';
import queries from './fixtures/benchmark-queries.json' assert { type: 'json' };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BenchmarkQuery {
  id: string;
  query: string;
  type: string;
  expected_concepts: string[];
  description: string;
}

export interface QueryResult {
  queryId: string;
  query: string;
  type: string;
  recallAt5: number;
  ndcg: number;
  latencyMs: number;
  hitsFound: number;
  expectedCount: number;
}

export interface ByTypeSummary {
  avgRecallAt5: number;
  avgNdcg: number;
  count: number;
}

export interface BenchmarkSummary {
  totalQueries: number;
  avgRecallAt5: number;
  avgNdcg: number;
  avgLatencyMs: number;
  byType: Record<string, ByTypeSummary>;
  timestamp: string;
  results: QueryResult[];
}

// ---------------------------------------------------------------------------
// Metric calculations (pure functions — exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Recall at K: fraction of expected IDs found in the top-K hits.
 *
 * If expected is empty, returns 1.0 (vacuously true — nothing to find).
 */
export function calculateRecallAtK(hits: number[], expected: number[], k: number): number {
  if (expected.length === 0) return 1.0;

  const topK = hits.slice(0, k);
  const expectedSet = new Set(expected);
  const found = topK.filter(id => expectedSet.has(id)).length;
  return found / expected.length;
}

/**
 * Normalised Discounted Cumulative Gain at K.
 *
 * Relevance is binary: 1 if the ID is in the expected set, 0 otherwise.
 * If expected is empty, returns 1.0 (vacuously true).
 */
export function calculateNDCG(hits: number[], expected: number[], k: number): number {
  if (expected.length === 0) return 1.0;

  const topK = hits.slice(0, k);
  const expectedSet = new Set(expected);

  // Actual DCG
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    const relevance = expectedSet.has(topK[i]) ? 1 : 0;
    dcg += relevance / Math.log2(i + 2); // log2(rank+1), rank is 1-based → i+2
  }

  // Ideal DCG: all relevant docs at the top positions
  const idealHits = Math.min(expected.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  if (idcg === 0) return 0;
  return dcg / idcg;
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

/**
 * Resolve which observation IDs are "expected" for a query.
 *
 * Strategy: look up each concept in expected_concepts against the idMap
 * (which maps concept-keys and observation keys → IDs). Collect unique IDs.
 */
function resolveExpectedIds(
  expectedConcepts: string[],
  idMap: SeedResult
): number[] {
  const ids = new Set<number>();
  for (const concept of expectedConcepts) {
    const id = idMap.get(concept);
    if (id !== undefined) {
      ids.add(id);
    }
  }
  return Array.from(ids);
}

/**
 * Execute a single query against SessionSearch (FTS5) and return hit IDs.
 */
function executeSearch(sessionSearch: SessionSearch, query: string, project: string): number[] {
  try {
    const results = sessionSearch.searchObservations(query, {
      project,
      limit: 20,
    });
    return results.map(r => r.id);
  } catch {
    return [];
  }
}

/**
 * Run the full benchmark suite.
 *
 * @param sessionSearch - Instantiated SessionSearch to benchmark
 * @param project       - Project filter used during seeding
 * @param idMap         - Map from concept-keys → observation IDs (from seedBenchmarkData)
 */
export async function runBenchmark(
  sessionSearch: SessionSearch,
  project: string,
  idMap: SeedResult
): Promise<BenchmarkSummary> {
  const K = 5;
  const queryList = queries as BenchmarkQuery[];
  const results: QueryResult[] = [];

  for (const q of queryList) {
    const start = performance.now();
    const hits = executeSearch(sessionSearch, q.query, project);
    const latencyMs = performance.now() - start;

    const expected = resolveExpectedIds(q.expected_concepts, idMap);
    const recallAt5 = calculateRecallAtK(hits, expected, K);
    const ndcg = calculateNDCG(hits, expected, K);

    results.push({
      queryId: q.id,
      query: q.query,
      type: q.type,
      recallAt5,
      ndcg,
      latencyMs,
      hitsFound: hits.length,
      expectedCount: expected.length,
    });
  }

  // Aggregate
  const avgRecallAt5 = results.reduce((s, r) => s + r.recallAt5, 0) / results.length;
  const avgNdcg = results.reduce((s, r) => s + r.ndcg, 0) / results.length;
  const avgLatencyMs = results.reduce((s, r) => s + r.latencyMs, 0) / results.length;

  // By-type breakdown
  const byType: Record<string, ByTypeSummary> = {};
  for (const r of results) {
    if (!byType[r.type]) {
      byType[r.type] = { avgRecallAt5: 0, avgNdcg: 0, count: 0 };
    }
    byType[r.type].avgRecallAt5 += r.recallAt5;
    byType[r.type].avgNdcg += r.ndcg;
    byType[r.type].count += 1;
  }
  for (const typeKey of Object.keys(byType)) {
    const entry = byType[typeKey];
    entry.avgRecallAt5 /= entry.count;
    entry.avgNdcg /= entry.count;
  }

  return {
    totalQueries: results.length,
    avgRecallAt5,
    avgNdcg,
    avgLatencyMs,
    byType,
    timestamp: new Date().toISOString(),
    results,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point (bun tests/benchmark/search-benchmark.ts)
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const BENCHMARK_PROJECT = 'benchmark-project';

  console.log('=== Agent Recall Search Quality Benchmark ===\n');

  // Use a temporary file so SessionStore and SessionSearch share the same DB.
  // (':memory:' creates a separate, isolated database for each connection.)
  const os = await import('os');
  const path = await import('path');
  const fs = await import('fs');
  const tmpDir = os.tmpdir();
  const tmpDb = path.join(tmpDir, `agent-recall-benchmark-${Date.now()}.db`);

  const store = new SessionStore(tmpDb);
  const sessionSearch = new SessionSearch(tmpDb);

  console.log('Seeding benchmark data...');
  const idMap = seedBenchmarkData(store, BENCHMARK_PROJECT);
  console.log(`  Seeded ${idMap.size} concept mappings\n`);

  // Run benchmark
  console.log('Running benchmark queries...');
  const summary = await runBenchmark(sessionSearch, BENCHMARK_PROJECT, idMap);

  // Print results
  console.log('\n--- Per-Query Results ---');
  console.log(
    ['QueryID'.padEnd(16), 'Type'.padEnd(12), 'R@5'.padEnd(8), 'NDCG'.padEnd(8), 'LatMs'.padEnd(10), 'Hits/Exp'].join('')
  );
  console.log('-'.repeat(70));
  for (const r of summary.results) {
    console.log(
      [
        r.queryId.padEnd(16),
        r.type.padEnd(12),
        r.recallAt5.toFixed(3).padEnd(8),
        r.ndcg.toFixed(3).padEnd(8),
        r.latencyMs.toFixed(1).padEnd(10),
        `${r.hitsFound}/${r.expectedCount}`,
      ].join('')
    );
  }

  console.log('\n--- By-Type Summary ---');
  for (const [type, stats] of Object.entries(summary.byType)) {
    console.log(
      `  ${type.padEnd(12)} R@5=${stats.avgRecallAt5.toFixed(3)}  NDCG=${stats.avgNdcg.toFixed(3)}  (n=${stats.count})`
    );
  }

  console.log('\n--- Overall ---');
  console.log(`  Queries:       ${summary.totalQueries}`);
  console.log(`  Avg R@5:       ${summary.avgRecallAt5.toFixed(3)}`);
  console.log(`  Avg NDCG:      ${summary.avgNdcg.toFixed(3)}`);
  console.log(`  Avg Latency:   ${summary.avgLatencyMs.toFixed(1)} ms`);
  console.log(`  Timestamp:     ${summary.timestamp}`);

  store.close();

  // Clean up temp DB
  try { fs.unlinkSync(tmpDb); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpDb + '-wal'); } catch { /* ignore */ }
  try { fs.unlinkSync(tmpDb + '-shm'); } catch { /* ignore */ }
}
