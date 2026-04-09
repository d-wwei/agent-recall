# Phase 1: Foundation + Baseline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish search benchmark baseline, concurrency safety, memory system ownership, and low-cost search improvements for Agent Recall.

**Architecture:** Phase 1 adds 5 new columns to observations, a write buffer table, a sync_state table, advisory file locks, fusion ranking for search, auto memory synchronization, and a behavioral protocol injection. All changes are backward-compatible; existing functionality is preserved.

**Tech Stack:** TypeScript (strict), SQLite (better-sqlite3), ChromaDB (via MCP), Bun test, esbuild

**Spec:** `docs/superpowers/specs/2026-04-09-agent-recall-optimization-exec.md`
**Design:** `design-references/optimization-plan.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/services/worker/search/FusionRanker.ts` | Adaptive fusion ranking: query classification, weight calculation, multi-dimensional scoring |
| `src/services/worker/search/TemporalParser.ts` | (Phase 2 — created empty with interface only for now) |
| `src/services/context/sections/RecallProtocolRenderer.ts` | L0 behavioral directives injection |
| `src/services/sync/AutoMemorySync.ts` | Scan + sync `~/.claude/memory/*.md` to Agent Recall |
| `src/services/migration/AssistantMigrator.ts` | One-time `.assistant/` → Agent Recall migration |
| `src/services/concurrency/LockManager.ts` | Advisory file locks for background tasks |
| `src/services/concurrency/WriteBuffer.ts` | Session-scoped observation buffer with flush |
| `tests/benchmark/search-benchmark.ts` | Benchmark runner (R@5, NDCG) |
| `tests/benchmark/fixtures/benchmark-queries.json` | Query → expected-hit pairs |
| `tests/benchmark/fixtures/seed-data.ts` | Test data seeder for benchmark |
| `tests/services/fusion-ranker.test.ts` | FusionRanker unit tests |
| `tests/services/recall-protocol.test.ts` | RecallProtocol renderer tests |
| `tests/services/lock-manager.test.ts` | LockManager unit tests |
| `tests/services/write-buffer.test.ts` | WriteBuffer unit tests |
| `tests/services/auto-memory-sync.test.ts` | AutoMemorySync unit tests |
| `tests/services/assistant-migrator.test.ts` | AssistantMigrator unit tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/services/sqlite/migrations/runner.ts` | Add migrations 29-31 (observations fields, observation_buffer, sync_state) |
| `src/services/sqlite/Database.ts` | Add `PRAGMA busy_timeout = 5000` |
| `src/services/sqlite/SessionStore.ts` | Update `storeObservation` to write new fields; add `updateLastReferenced` method |
| `src/services/context/ContextBuilder.ts` | Add RecallProtocolRenderer to section assembly |
| `src/services/sync/ChromaSync.ts` | Expand metadata on `syncObservation` |
| `src/services/worker/SearchManager.ts` | Integrate FusionRanker for merged results |
| `src/sdk/prompts.ts` | Update AI extraction prompt to output confidence/tags/has_preference/event_date |
| `src/sdk/parser.ts` | Extend ParsedObservation interface with new fields |
| `src/services/worker-service.ts` | Register incremental-save endpoint; initialize AutoMemorySync |
| `src/services/worker/http/routes/SearchRoutes.ts` | Wire FusionRanker into search handler |

---

## Batch 1: Foundation (parallel, no dependencies)

---

### Task 1: Retrieval Benchmark Infrastructure

**Files:**
- Create: `tests/benchmark/search-benchmark.ts`
- Create: `tests/benchmark/fixtures/benchmark-queries.json`
- Create: `tests/benchmark/fixtures/seed-data.ts`

- [ ] **Step 1: Create benchmark query fixtures**

```json
// tests/benchmark/fixtures/benchmark-queries.json
{
  "queries": [
    {
      "id": "exact-01",
      "query": "SessionStore.ts",
      "type": "exact",
      "expected_observation_ids": [],
      "expected_concepts": ["session-store", "database"],
      "description": "Exact file name lookup"
    },
    {
      "id": "semantic-01",
      "query": "how does authentication work",
      "type": "semantic",
      "expected_observation_ids": [],
      "expected_concepts": ["auth", "authentication"],
      "description": "Semantic concept query"
    },
    {
      "id": "temporal-01",
      "query": "changes from last week",
      "type": "temporal",
      "expected_observation_ids": [],
      "expected_concepts": [],
      "description": "Time-anchored query"
    },
    {
      "id": "preference-01",
      "query": "what coding style do I prefer",
      "type": "preference",
      "expected_observation_ids": [],
      "expected_concepts": ["style", "preference"],
      "description": "User preference recall"
    },
    {
      "id": "assistant-01",
      "query": "what did you suggest for the database schema",
      "type": "assistant",
      "expected_observation_ids": [],
      "expected_concepts": ["database", "schema"],
      "description": "Assistant recall query"
    }
  ]
}
```

Note: `expected_observation_ids` will be populated by the seed script after seeding test data. Start with 20 queries covering all 5 types (exact/semantic/temporal/preference/assistant), expand to 50-100 as the system matures.

- [ ] **Step 2: Create seed data generator**

```typescript
// tests/benchmark/fixtures/seed-data.ts
import { SessionStore } from '../../../src/services/sqlite/SessionStore.js';

export interface SeedResult {
  observationIds: Map<string, number>; // concept-key → observation ID
}

export function seedBenchmarkData(store: SessionStore, project: string): SeedResult {
  const ids = new Map<string, number>();
  const sessionId = `benchmark-session-${Date.now()}`;

  // Create a session first
  store.createSession({
    contentSessionId: `cs-${sessionId}`,
    memorySessionId: sessionId,
    project,
    userPrompt: 'Benchmark seed session',
    startedAtEpoch: Date.now(),
  });

  const observations = [
    {
      type: 'decision',
      title: 'Chose JWT for authentication',
      subtitle: 'Auth system design',
      facts: ['JWT chosen over session cookies', 'RS256 algorithm selected'],
      narrative: 'Decided to use JWT tokens with RS256 for the authentication system. This allows stateless auth across microservices.',
      concepts: ['auth', 'authentication', 'jwt', 'security'],
      files_read: ['src/auth/middleware.ts'],
      files_modified: ['src/auth/jwt-provider.ts'],
      key: 'auth-decision',
    },
    {
      type: 'discovery',
      title: 'Database connection pooling issue',
      subtitle: 'Performance investigation',
      facts: ['Connection pool exhausted under load', 'Max connections was set to 5'],
      narrative: 'Found that the database connection pool was set too low. Under concurrent requests, connections were exhausted causing timeouts.',
      concepts: ['database', 'performance', 'connection-pool'],
      files_read: ['src/db/config.ts', 'src/db/pool.ts'],
      files_modified: ['src/db/config.ts'],
      key: 'db-pool-discovery',
    },
    {
      type: 'feature',
      title: 'Added user preferences API',
      subtitle: 'User settings',
      facts: ['REST endpoint /api/preferences', 'Supports GET and PATCH'],
      narrative: 'Implemented the user preferences API. Users can get and update their coding style, theme, and notification preferences.',
      concepts: ['api', 'preferences', 'user-settings', 'style'],
      files_read: [],
      files_modified: ['src/routes/preferences.ts', 'src/models/user.ts'],
      key: 'preferences-feature',
    },
    {
      type: 'bugfix',
      title: 'Fixed race condition in session cleanup',
      subtitle: 'Concurrency bug',
      facts: ['Concurrent session ends could delete active data', 'Added mutex lock'],
      narrative: 'Fixed a race condition where two sessions ending simultaneously could corrupt the cleanup routine. Added a mutex to serialize cleanup operations.',
      concepts: ['concurrency', 'race-condition', 'session', 'cleanup'],
      files_read: ['src/services/session-manager.ts'],
      files_modified: ['src/services/session-manager.ts'],
      key: 'race-condition-fix',
    },
  ];

  for (const obs of observations) {
    const result = store.storeObservation(
      sessionId,
      project,
      {
        type: obs.type,
        title: obs.title,
        subtitle: obs.subtitle,
        facts: obs.facts,
        narrative: obs.narrative,
        concepts: obs.concepts,
        files_read: obs.files_read,
        files_modified: obs.files_modified,
      },
      1,
      100,
    );
    ids.set(obs.key, result.id);
  }

  return { observationIds: ids };
}
```

- [ ] **Step 3: Create benchmark runner**

```typescript
// tests/benchmark/search-benchmark.ts
import { SearchManager } from '../../src/services/worker/SearchManager.js';
import benchmarkQueries from './fixtures/benchmark-queries.json';

export interface BenchmarkResult {
  queryId: string;
  query: string;
  type: string;
  hits: number[];       // observation IDs returned
  expected: number[];   // expected observation IDs
  recallAt5: number;    // R@5: fraction of expected found in top 5
  ndcg: number;         // NDCG score
  latencyMs: number;
}

export interface BenchmarkSummary {
  totalQueries: number;
  avgRecallAt5: number;
  avgNdcg: number;
  avgLatencyMs: number;
  byType: Record<string, { avgRecallAt5: number; avgNdcg: number; count: number }>;
  timestamp: string;
}

function calculateRecallAtK(hits: number[], expected: number[], k: number): number {
  if (expected.length === 0) return 1.0;
  const topK = hits.slice(0, k);
  const found = expected.filter(id => topK.includes(id)).length;
  return found / expected.length;
}

function calculateNDCG(hits: number[], expected: number[], k: number): number {
  if (expected.length === 0) return 1.0;
  const expectedSet = new Set(expected);

  let dcg = 0;
  for (let i = 0; i < Math.min(hits.length, k); i++) {
    if (expectedSet.has(hits[i])) {
      dcg += 1 / Math.log2(i + 2); // i+2 because log2(1) = 0
    }
  }

  let idcg = 0;
  for (let i = 0; i < Math.min(expected.length, k); i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  return idcg === 0 ? 0 : dcg / idcg;
}

export async function runBenchmark(
  searchManager: SearchManager,
  project: string,
  observationIdMap: Map<string, number>,
): Promise<BenchmarkSummary> {
  const results: BenchmarkResult[] = [];

  for (const q of benchmarkQueries.queries) {
    // Resolve expected IDs from seed map
    const expectedIds = q.expected_observation_ids.length > 0
      ? q.expected_observation_ids
      : q.expected_concepts.flatMap(c => {
          // Match by concept against seeded data
          const matchingKey = [...observationIdMap.keys()].find(k =>
            k.toLowerCase().includes(c.toLowerCase())
          );
          return matchingKey ? [observationIdMap.get(matchingKey)!] : [];
        });

    const start = performance.now();
    const searchResult = await searchManager.search({
      q: q.query,
      project,
      limit: 10,
      format: 'json',
    });
    const latencyMs = performance.now() - start;

    const hitIds = (searchResult.observations || []).map((o: any) => o.id);

    results.push({
      queryId: q.id,
      query: q.query,
      type: q.type,
      hits: hitIds,
      expected: expectedIds,
      recallAt5: calculateRecallAtK(hitIds, expectedIds, 5),
      ndcg: calculateNDCG(hitIds, expectedIds, 5),
      latencyMs,
    });
  }

  // Aggregate
  const byType: Record<string, { avgRecallAt5: number; avgNdcg: number; count: number }> = {};
  for (const r of results) {
    if (!byType[r.type]) byType[r.type] = { avgRecallAt5: 0, avgNdcg: 0, count: 0 };
    byType[r.type].avgRecallAt5 += r.recallAt5;
    byType[r.type].avgNdcg += r.ndcg;
    byType[r.type].count += 1;
  }
  for (const type of Object.keys(byType)) {
    byType[type].avgRecallAt5 /= byType[type].count;
    byType[type].avgNdcg /= byType[type].count;
  }

  return {
    totalQueries: results.length,
    avgRecallAt5: results.reduce((s, r) => s + r.recallAt5, 0) / results.length,
    avgNdcg: results.reduce((s, r) => s + r.ndcg, 0) / results.length,
    avgLatencyMs: results.reduce((s, r) => s + r.latencyMs, 0) / results.length,
    byType,
    timestamp: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Add benchmark npm script**

Add to `package.json` scripts:
```json
"benchmark": "bun tests/benchmark/search-benchmark.ts"
```

- [ ] **Step 5: Run benchmark to establish baseline**

Run: `npm run benchmark`
Save output to `tests/benchmark/results/baseline.json`

- [ ] **Step 6: Commit**

```bash
git add tests/benchmark/ package.json
git commit -m "feat(benchmark): add search quality benchmark infrastructure (6.1)

R@5 and NDCG metrics across 5 query types.
Seed data generator for reproducible benchmarks."
```

---

### Task 2: SQLite Concurrency — busy_timeout + WAL verification

**Files:**
- Modify: `src/services/sqlite/Database.ts`
- Create: `tests/services/concurrency/database-concurrency.test.ts`

- [ ] **Step 1: Write failing test for busy_timeout**

```typescript
// tests/services/concurrency/database-concurrency.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Database concurrency', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-test-'));
    dbPath = join(dir, 'test.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('WAL mode is enabled', () => {
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    const mode = db.pragma('journal_mode');
    expect(mode[0].journal_mode).toBe('wal');
    db.close();
  });

  test('busy_timeout is set to 5000ms', () => {
    const db = new Database(dbPath);
    db.pragma('busy_timeout = 5000');
    const timeout = db.pragma('busy_timeout');
    expect(timeout[0].busy_timeout).toBe(5000);
    db.close();
  });

  test('concurrent readers do not block each other under WAL', () => {
    const db1 = new Database(dbPath);
    db1.pragma('journal_mode = WAL');
    db1.exec('CREATE TABLE test (id INTEGER PRIMARY KEY, val TEXT)');
    db1.exec("INSERT INTO test VALUES (1, 'hello')");

    const db2 = new Database(dbPath);
    db2.pragma('journal_mode = WAL');

    // Both can read simultaneously
    const r1 = db1.prepare('SELECT * FROM test').all();
    const r2 = db2.prepare('SELECT * FROM test').all();
    expect(r1).toHaveLength(1);
    expect(r2).toHaveLength(1);

    db1.close();
    db2.close();
  });
});
```

- [ ] **Step 2: Run test to verify it passes** (WAL already enabled)

Run: `bun test tests/services/concurrency/database-concurrency.test.ts`
Expected: PASS (WAL is already set in Database.ts)

- [ ] **Step 3: Add busy_timeout to Database.ts**

In `src/services/sqlite/Database.ts`, find the PRAGMA block (around line 163-168) and add after `PRAGMA journal_mode = WAL;`:

```typescript
db.pragma('busy_timeout = 5000');
```

- [ ] **Step 4: Commit**

```bash
git add src/services/sqlite/Database.ts tests/services/concurrency/
git commit -m "feat(db): add busy_timeout for write contention safety (0.5)"
```

---

### Task 3: Advisory File Lock Manager

**Files:**
- Create: `src/services/concurrency/LockManager.ts`
- Create: `tests/services/lock-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/lock-manager.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { LockManager } from '../../src/services/concurrency/LockManager.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('LockManager', () => {
  let dir: string;
  let lockManager: LockManager;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-lock-'));
    lockManager = new LockManager(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('acquire creates lock file with PID', () => {
    const acquired = lockManager.acquire('compilation');
    expect(acquired).toBe(true);
    expect(existsSync(join(dir, 'compilation.lock'))).toBe(true);
  });

  test('acquire fails if already locked by live process', () => {
    const acquired1 = lockManager.acquire('compilation');
    expect(acquired1).toBe(true);

    const acquired2 = lockManager.acquire('compilation');
    expect(acquired2).toBe(false);
  });

  test('release removes lock file', () => {
    lockManager.acquire('compilation');
    lockManager.release('compilation');
    expect(existsSync(join(dir, 'compilation.lock'))).toBe(false);
  });

  test('acquire succeeds if lock held by dead PID', () => {
    // Write a lock file with a PID that definitely does not exist
    const { writeFileSync } = require('fs');
    writeFileSync(join(dir, 'compilation.lock'), JSON.stringify({
      pid: 999999999,
      acquiredAt: new Date().toISOString(),
    }));

    const acquired = lockManager.acquire('compilation');
    expect(acquired).toBe(true);
  });

  test('isLocked returns correct state', () => {
    expect(lockManager.isLocked('compilation')).toBe(false);
    lockManager.acquire('compilation');
    expect(lockManager.isLocked('compilation')).toBe(true);
    lockManager.release('compilation');
    expect(lockManager.isLocked('compilation')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/lock-manager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement LockManager**

```typescript
// src/services/concurrency/LockManager.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

interface LockInfo {
  pid: number;
  acquiredAt: string;
}

export class LockManager {
  private locksDir: string;

  constructor(locksDir: string) {
    this.locksDir = locksDir;
    if (!existsSync(locksDir)) {
      mkdirSync(locksDir, { recursive: true });
    }
  }

  acquire(taskName: string): boolean {
    const lockPath = this.lockPath(taskName);

    if (existsSync(lockPath)) {
      try {
        const existing: LockInfo = JSON.parse(readFileSync(lockPath, 'utf-8'));
        if (this.isProcessAlive(existing.pid)) {
          return false; // Lock held by live process
        }
        // Stale lock — remove and re-acquire
        unlinkSync(lockPath);
      } catch {
        // Corrupt lock file — remove
        unlinkSync(lockPath);
      }
    }

    const info: LockInfo = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    };
    writeFileSync(lockPath, JSON.stringify(info));
    return true;
  }

  release(taskName: string): void {
    const lockPath = this.lockPath(taskName);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  }

  isLocked(taskName: string): boolean {
    const lockPath = this.lockPath(taskName);
    if (!existsSync(lockPath)) return false;

    try {
      const info: LockInfo = JSON.parse(readFileSync(lockPath, 'utf-8'));
      return this.isProcessAlive(info.pid);
    } catch {
      return false;
    }
  }

  private lockPath(taskName: string): string {
    return join(this.locksDir, `${taskName}.lock`);
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0); // Signal 0 = existence check
      return true;
    } catch {
      return false;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/lock-manager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/concurrency/LockManager.ts tests/services/lock-manager.test.ts
git commit -m "feat(concurrency): add advisory file lock manager (0.5)"
```

---

### Task 4: Observation Write Buffer

**Files:**
- Create: `src/services/concurrency/WriteBuffer.ts`
- Modify: `src/services/sqlite/migrations/runner.ts`
- Create: `tests/services/write-buffer.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/write-buffer.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import Database from 'better-sqlite3';
import { WriteBuffer } from '../../src/services/concurrency/WriteBuffer.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('WriteBuffer', () => {
  let dir: string;
  let db: Database.Database;
  let buffer: WriteBuffer;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-buffer-'));
    db = new Database(join(dir, 'test.db'));
    db.exec(`
      CREATE TABLE observation_buffer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        content_hash TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
    `);
    buffer = new WriteBuffer(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('write adds to buffer, not main table', () => {
    buffer.write('session-1', { type: 'decision', title: 'Test', project: 'test-proj' });

    const buffered = db.prepare('SELECT * FROM observation_buffer').all();
    const main = db.prepare('SELECT * FROM observations').all();

    expect(buffered).toHaveLength(1);
    expect(main).toHaveLength(0);
  });

  test('flush moves all session entries to main table', () => {
    buffer.write('session-1', {
      memory_session_id: 'session-1',
      project: 'test-proj',
      type: 'decision',
      title: 'Test Decision',
      subtitle: null,
      facts: '[]',
      narrative: 'A test narrative',
      concepts: '[]',
      files_read: '[]',
      files_modified: '[]',
      prompt_number: 1,
      discovery_tokens: 50,
      content_hash: 'abc123',
      created_at: new Date().toISOString(),
      created_at_epoch: Date.now(),
    });

    const flushed = buffer.flush('session-1');
    expect(flushed).toBe(1);

    const buffered = db.prepare('SELECT * FROM observation_buffer WHERE session_id = ?').all('session-1');
    const main = db.prepare('SELECT * FROM observations').all();

    expect(buffered).toHaveLength(0);
    expect(main).toHaveLength(1);
  });

  test('flush only affects specified session', () => {
    buffer.write('session-1', { type: 'decision', title: 'S1' });
    buffer.write('session-2', { type: 'feature', title: 'S2' });

    buffer.flush('session-1');

    const remaining = db.prepare('SELECT * FROM observation_buffer').all();
    expect(remaining).toHaveLength(1);
    expect(JSON.parse((remaining[0] as any).payload).title).toBe('S2');
  });

  test('getBufferedCount returns correct count', () => {
    expect(buffer.getBufferedCount('session-1')).toBe(0);
    buffer.write('session-1', { type: 'decision', title: 'T1' });
    buffer.write('session-1', { type: 'feature', title: 'T2' });
    expect(buffer.getBufferedCount('session-1')).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/write-buffer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement WriteBuffer**

```typescript
// src/services/concurrency/WriteBuffer.ts
import type Database from 'better-sqlite3';

export class WriteBuffer {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  write(sessionId: string, payload: Record<string, any>): void {
    this.db.prepare(
      'INSERT INTO observation_buffer (session_id, payload) VALUES (?, ?)'
    ).run(sessionId, JSON.stringify(payload));
  }

  flush(sessionId: string): number {
    const rows = this.db.prepare(
      'SELECT payload FROM observation_buffer WHERE session_id = ?'
    ).all(sessionId) as { payload: string }[];

    if (rows.length === 0) return 0;

    const insertObs = this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteBuffer = this.db.prepare(
      'DELETE FROM observation_buffer WHERE session_id = ?'
    );

    const transaction = this.db.transaction(() => {
      for (const row of rows) {
        const p = JSON.parse(row.payload);
        if (p.memory_session_id) {
          insertObs.run(
            p.memory_session_id, p.project, p.type, p.title, p.subtitle,
            p.facts, p.narrative, p.concepts, p.files_read, p.files_modified,
            p.prompt_number, p.discovery_tokens, p.content_hash,
            p.created_at, p.created_at_epoch
          );
        }
      }
      deleteBuffer.run(sessionId);
    });

    transaction();
    return rows.length;
  }

  getBufferedCount(sessionId: string): number {
    const result = this.db.prepare(
      'SELECT COUNT(*) as count FROM observation_buffer WHERE session_id = ?'
    ).get(sessionId) as { count: number };
    return result.count;
  }

  clearStale(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = this.db.prepare(
      'DELETE FROM observation_buffer WHERE created_at < ?'
    ).run(cutoff);
    return result.changes;
  }
}
```

- [ ] **Step 4: Add migration 29 — observation_buffer table**

In `src/services/sqlite/migrations/runner.ts`, add to `runAllMigrations()`:

```typescript
this.createObservationBufferTable(); // migration 29
```

Add the method:

```typescript
private createObservationBufferTable(): void {
  const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(29);
  if (applied) return;

  this.db.exec(`
    CREATE TABLE IF NOT EXISTS observation_buffer (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_observation_buffer_session ON observation_buffer(session_id);
  `);

  this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(29, new Date().toISOString());
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/services/write-buffer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/concurrency/WriteBuffer.ts src/services/sqlite/migrations/runner.ts tests/services/write-buffer.test.ts
git commit -m "feat(concurrency): add session-scoped observation write buffer (0.5)

Observations written to buffer during session, flushed to main table
on SessionEnd. Prevents write contention across concurrent sessions."
```

---

### Task 5: RECALL_PROTOCOL Renderer

**Files:**
- Create: `src/services/context/sections/RecallProtocolRenderer.ts`
- Modify: `src/services/context/ContextBuilder.ts`
- Create: `tests/services/recall-protocol.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// tests/services/recall-protocol.test.ts
import { describe, test, expect } from 'bun:test';
import { renderRecallProtocol } from '../../src/services/context/sections/RecallProtocolRenderer.js';

describe('RecallProtocolRenderer', () => {
  test('renders protocol directives as markdown', () => {
    const result = renderRecallProtocol(false);
    expect(result).toBeInstanceOf(Array);
    expect(result.length).toBeGreaterThan(0);

    const text = result.join('\n');
    expect(text).toContain('Memory Protocol');
    expect(text).toContain('search memory');
    expect(text).toContain('contradictions');
    expect(text).toContain('preferences');
  });

  test('renders with color support', () => {
    const result = renderRecallProtocol(true);
    const text = result.join('\n');
    expect(text).toContain('Memory Protocol');
  });

  test('output is under 300 tokens (~240 target)', () => {
    const result = renderRecallProtocol(false);
    const text = result.join('\n');
    // Rough token estimate: 1 token ~= 4 chars for English
    const estimatedTokens = Math.ceil(text.length / 4);
    expect(estimatedTokens).toBeLessThan(300);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/recall-protocol.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement RecallProtocolRenderer**

```typescript
// src/services/context/sections/RecallProtocolRenderer.ts

const PROTOCOL_LINES = [
  '## Memory Protocol',
  '1. Before answering about past facts, search memory to verify — do not guess',
  '2. When you discover information contradicting stored memory, flag it and request an update',
  '3. User preferences, decisions, and corrections are worth recording',
];

export function renderRecallProtocol(useColors: boolean): string[] {
  if (useColors) {
    return [
      '\x1b[1;36m## Memory Protocol\x1b[0m',
      '1. Before answering about past facts, search memory to verify — do not guess',
      '2. When you discover information contradicting stored memory, flag it and request an update',
      '3. User preferences, decisions, and corrections are worth recording',
    ];
  }
  return [...PROTOCOL_LINES];
}
```

- [ ] **Step 4: Integrate into ContextBuilder**

In `src/services/context/ContextBuilder.ts`, import and add after persona rendering:

```typescript
import { renderRecallProtocol } from './sections/RecallProtocolRenderer.js';
```

In the `buildContextOutput` function, insert after the persona section (after line ~112):

```typescript
// L0: Recall Protocol (always injected)
sections.push(...renderRecallProtocol(useColors));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/services/recall-protocol.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/context/sections/RecallProtocolRenderer.ts src/services/context/ContextBuilder.ts tests/services/recall-protocol.test.ts
git commit -m "feat(context): add RECALL_PROTOCOL behavioral directives (4.1)

Injected as L0 section on every SessionStart. Three rules:
verify before answering, flag contradictions, record preferences."
```

---

### Task 6: Observations Table — New Fields (Migration 30)

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts`
- Modify: `src/services/sqlite/SessionStore.ts`
- Modify: `src/sdk/parser.ts`

- [ ] **Step 1: Add migration 30 — observations new columns**

In `src/services/sqlite/migrations/runner.ts`, add to `runAllMigrations()`:

```typescript
this.addObservationPhase1Fields(); // migration 30
```

Add the method:

```typescript
private addObservationPhase1Fields(): void {
  const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(30);
  if (applied) return;

  const tableInfo = this.db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
  const existingColumns = new Set(tableInfo.map(c => c.name));

  const newColumns = [
    { name: 'confidence', sql: "ALTER TABLE observations ADD COLUMN confidence TEXT DEFAULT 'medium'" },
    { name: 'tags', sql: "ALTER TABLE observations ADD COLUMN tags TEXT DEFAULT '[]'" },
    { name: 'has_preference', sql: 'ALTER TABLE observations ADD COLUMN has_preference BOOLEAN DEFAULT 0' },
    { name: 'event_date', sql: 'ALTER TABLE observations ADD COLUMN event_date TEXT' },
    { name: 'last_referenced_at', sql: 'ALTER TABLE observations ADD COLUMN last_referenced_at TEXT' },
  ];

  for (const col of newColumns) {
    if (!existingColumns.has(col.name)) {
      this.db.exec(col.sql);
    }
  }

  this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(30, new Date().toISOString());
}
```

- [ ] **Step 2: Extend ParsedObservation interface**

In `src/sdk/parser.ts`, update the interface:

```typescript
export interface ParsedObservation {
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string[];
  narrative: string | null;
  concepts: string[];
  files_read: string[];
  files_modified: string[];
  // Phase 1 additions (1.3a)
  confidence?: 'high' | 'medium' | 'low';
  tags?: string[];
  has_preference?: boolean;
  event_date?: string | null;
}
```

- [ ] **Step 3: Update SessionStore.storeObservation to write new fields**

In `src/services/sqlite/SessionStore.ts`, update the INSERT statement in `storeObservation` to include the new columns:

```typescript
// In storeObservation method — update the INSERT statement
const stmt = this.db.prepare(`
  INSERT INTO observations
  (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
   files_read, files_modified, prompt_number, discovery_tokens, content_hash,
   confidence, tags, has_preference, event_date,
   created_at, created_at_epoch)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
```

Pass the new fields from the observation object (default to `'medium'`, `'[]'`, `0`, `null` if not provided).

- [ ] **Step 4: Add updateLastReferenced method to SessionStore**

```typescript
// In SessionStore class
updateLastReferenced(observationIds: number[]): void {
  if (observationIds.length === 0) return;
  const now = new Date().toISOString();
  const placeholders = observationIds.map(() => '?').join(',');
  this.db.prepare(
    `UPDATE observations SET last_referenced_at = ? WHERE id IN (${placeholders})`
  ).run(now, ...observationIds);
}
```

- [ ] **Step 5: Run full test suite**

Run: `bun test`
Expected: All existing tests pass (new columns have defaults, so existing inserts still work)

- [ ] **Step 6: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts src/services/sqlite/SessionStore.ts src/sdk/parser.ts
git commit -m "feat(schema): add confidence/tags/has_preference/event_date/last_referenced_at to observations (1.3a)

Migration 30: five new columns with safe defaults.
SessionStore writes new fields, updateLastReferenced for search hits."
```

---

### Task 7: AI Extraction Prompt Update

**Files:**
- Modify: `src/sdk/prompts.ts`

- [ ] **Step 1: Update extraction prompt to output new fields**

In `src/sdk/prompts.ts`, find the XML template for observations (in `buildInitPrompt` or the mode prompt templates). Add fields to the observation XML schema:

```xml
<observation>
  <type>decision|bugfix|feature|refactor|discovery|change</type>
  <title>Short descriptive title</title>
  <subtitle>Context or category</subtitle>
  <facts>
    <fact>Key fact 1</fact>
    <fact>Key fact 2</fact>
  </facts>
  <narrative>Detailed description of what happened and why it matters</narrative>
  <concepts>
    <concept>concept1</concept>
  </concepts>
  <files_read>
    <file>path/to/file.ts</file>
  </files_read>
  <files_modified>
    <file>path/to/modified.ts</file>
  </files_modified>
  <!-- Phase 1 additions -->
  <confidence>high|medium|low</confidence>
  <tags>
    <tag>relevant-tag</tag>
  </tags>
  <has_preference>true|false</has_preference>
  <event_date>YYYY-MM-DD or null</event_date>
</observation>
```

Add guidance text to the prompt:
```
Confidence levels:
- high: directly observed from tool output (file read, test result, command output)
- medium: inferred from context (likely correct but not directly confirmed)
- low: speculative or ambiguous

Set has_preference to true if the user expressed a preference ("I prefer X", "always use X", "don't do Y").

event_date: if the observation refers to a specific past or future date, extract it as YYYY-MM-DD. Otherwise null.
```

- [ ] **Step 2: Update parser to extract new fields**

In `src/sdk/parser.ts`, update `parseObservations` to extract the new XML tags:

```typescript
// Inside the parsing logic for each observation block:
const confidence = extractTag(block, 'confidence') || 'medium';
const tagsRaw = extractAllTags(block, 'tag');
const hasPreference = extractTag(block, 'has_preference') === 'true';
const eventDate = extractTag(block, 'event_date') || null;

return {
  ...existingFields,
  confidence: confidence as 'high' | 'medium' | 'low',
  tags: tagsRaw,
  has_preference: hasPreference,
  event_date: eventDate === 'null' ? null : eventDate,
};
```

- [ ] **Step 3: Run test suite**

Run: `bun test`
Expected: PASS (parser changes are backward-compatible — missing tags default gracefully)

- [ ] **Step 4: Commit**

```bash
git add src/sdk/prompts.ts src/sdk/parser.ts
git commit -m "feat(extraction): AI now outputs confidence/tags/has_preference/event_date (1.3a)

Updated XML schema and parser to extract Phase 1 observation fields."
```

---

## Batch 2: Search + Sync Improvements (depends on Batch 1)

---

### Task 8: ChromaDB Metadata Enrichment

**Files:**
- Modify: `src/services/sync/ChromaSync.ts`

- [ ] **Step 1: Update syncObservation metadata**

In `src/services/sync/ChromaSync.ts`, find the `baseMetadata` construction in `syncObservation` (around line 131-153). Expand it:

```typescript
const baseMetadata: Record<string, string | number> = {
  sqlite_id: observationId,
  doc_type: 'observation',
  memory_session_id: memorySessionId,
  project: project,
  created_at_epoch: createdAtEpoch,
  type: obs.type || 'discovery',
  title: obs.title || 'Untitled',
  // Phase 1 additions (1.4)
  confidence: obs.confidence || 'medium',
  observation_type: obs.type || 'discovery',
  topic: obs.concepts?.[0] || 'general', // Primary concept as topic
};

// Add optional string fields only if present
if (obs.subtitle) baseMetadata.subtitle = obs.subtitle;
if (obs.concepts?.length) baseMetadata.concepts = obs.concepts.join(',');
if (obs.files_read?.length) baseMetadata.files_read = obs.files_read.join(',');
if (obs.files_modified?.length) baseMetadata.files_modified = obs.files_modified.join(',');
if (obs.tags?.length) baseMetadata.tags = obs.tags.join(',');
```

- [ ] **Step 2: Run test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/sync/ChromaSync.ts
git commit -m "feat(chroma): enrich metadata with confidence/topic/tags (1.4)

Enables metadata pre-filtering in ChromaDB queries for higher precision."
```

---

### Task 9: Fusion Ranker

**Files:**
- Create: `src/services/worker/search/FusionRanker.ts`
- Create: `tests/services/fusion-ranker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/fusion-ranker.test.ts
import { describe, test, expect } from 'bun:test';
import { FusionRanker, type FusionCandidate } from '../../src/services/worker/search/FusionRanker.js';

describe('FusionRanker', () => {
  const ranker = new FusionRanker();

  describe('query type detection', () => {
    test('detects exact match queries', () => {
      expect(ranker.classifyQuery('SessionStore.ts')).toBe('exact');
      expect(ranker.classifyQuery('"connection pool"')).toBe('exact');
      expect(ranker.classifyQuery('ERR_CONNECTION_REFUSED')).toBe('exact');
    });

    test('detects semantic queries', () => {
      expect(ranker.classifyQuery('how does authentication work')).toBe('semantic');
      expect(ranker.classifyQuery('something related to database')).toBe('semantic');
      expect(ranker.classifyQuery('关于认证的内容')).toBe('semantic');
    });

    test('defaults to balanced for ambiguous queries', () => {
      expect(ranker.classifyQuery('auth middleware')).toBe('balanced');
    });
  });

  describe('weight calculation', () => {
    test('exact queries favor FTS5', () => {
      const weights = ranker.getWeights('exact');
      expect(weights.fts5).toBeGreaterThan(weights.chroma);
    });

    test('semantic queries favor ChromaDB', () => {
      const weights = ranker.getWeights('semantic');
      expect(weights.chroma).toBeGreaterThan(weights.fts5);
    });
  });

  describe('fusion scoring', () => {
    test('ranks higher-scoring candidates first', () => {
      const candidates: FusionCandidate[] = [
        { id: 1, chromaScore: 0.5, ftsScore: 0.3, type: 'decision', lastReferencedAt: null, createdAtEpoch: Date.now() },
        { id: 2, chromaScore: 0.9, ftsScore: 0.8, type: 'decision', lastReferencedAt: null, createdAtEpoch: Date.now() },
        { id: 3, chromaScore: 0.1, ftsScore: 0.1, type: 'change', lastReferencedAt: null, createdAtEpoch: Date.now() },
      ];

      const ranked = ranker.rank(candidates, 'balanced');
      expect(ranked[0].id).toBe(2);
      expect(ranked[ranked.length - 1].id).toBe(3);
    });

    test('applies type weighting (decisions > changes)', () => {
      const candidates: FusionCandidate[] = [
        { id: 1, chromaScore: 0.7, ftsScore: 0.7, type: 'change', lastReferencedAt: null, createdAtEpoch: Date.now() },
        { id: 2, chromaScore: 0.7, ftsScore: 0.7, type: 'decision', lastReferencedAt: null, createdAtEpoch: Date.now() },
      ];

      const ranked = ranker.rank(candidates, 'balanced');
      expect(ranked[0].id).toBe(2); // decision ranked higher
    });

    test('applies staleness decay for old unreferenced items', () => {
      const now = Date.now();
      const sixMonthsAgo = now - 180 * 24 * 60 * 60 * 1000;

      const candidates: FusionCandidate[] = [
        { id: 1, chromaScore: 0.8, ftsScore: 0.8, type: 'decision', lastReferencedAt: null, createdAtEpoch: sixMonthsAgo },
        { id: 2, chromaScore: 0.7, ftsScore: 0.7, type: 'decision', lastReferencedAt: new Date().toISOString(), createdAtEpoch: now },
      ];

      const ranked = ranker.rank(candidates, 'balanced');
      expect(ranked[0].id).toBe(2); // Recent item ranked higher despite lower raw scores
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/fusion-ranker.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement FusionRanker**

```typescript
// src/services/worker/search/FusionRanker.ts

export interface FusionCandidate {
  id: number;
  chromaScore: number;   // 0-1 similarity (1 = perfect match)
  ftsScore: number;      // 0-1 normalized BM25 rank
  type: string;          // observation type
  lastReferencedAt: string | null;
  createdAtEpoch: number;
}

export interface RankedResult extends FusionCandidate {
  finalScore: number;
}

interface Weights {
  chroma: number;
  fts5: number;
}

type QueryType = 'exact' | 'semantic' | 'balanced';

const TYPE_WEIGHTS: Record<string, number> = {
  decision: 1.0,
  discovery: 0.8,
  bugfix: 0.7,
  feature: 0.6,
  change: 0.5,
  refactor: 0.4,
};

const EXACT_PATTERNS = [
  /\.\w+$/,           // file extensions (.ts, .py)
  /^["'].*["']$/,     // quoted strings
  /^[A-Z_]{3,}$/,     // SCREAMING_CASE constants/errors
  /\w+\.\w+/,         // dotted names (Class.method, file.ext)
  /^[\w-]+\.[\w]+$/,  // filenames
];

const SEMANTIC_PATTERNS = [
  /how\s+(does|do|to|did)/i,
  /what\s+(is|are|was|were)/i,
  /why\s+(does|do|did|is)/i,
  /related\s+to/i,
  /similar\s+to/i,
  /about\s+\w+/i,
  /关于|相关|类似|如何|为什么/,
];

export class FusionRanker {
  classifyQuery(query: string): QueryType {
    if (EXACT_PATTERNS.some(p => p.test(query))) return 'exact';
    if (SEMANTIC_PATTERNS.some(p => p.test(query))) return 'semantic';
    return 'balanced';
  }

  getWeights(queryType: QueryType): Weights {
    switch (queryType) {
      case 'exact':    return { chroma: 0.3, fts5: 0.7 };
      case 'semantic': return { chroma: 0.8, fts5: 0.2 };
      case 'balanced': return { chroma: 0.55, fts5: 0.45 };
    }
  }

  rank(candidates: FusionCandidate[], queryType: QueryType): RankedResult[] {
    const weights = this.getWeights(queryType);
    const now = Date.now();

    const scored = candidates.map(c => {
      const baseScore = weights.chroma * c.chromaScore + weights.fts5 * c.ftsScore;
      const typeWeight = TYPE_WEIGHTS[c.type] || 0.5;

      // Staleness decay based on last_referenced_at or created_at
      const referenceTime = c.lastReferencedAt
        ? new Date(c.lastReferencedAt).getTime()
        : c.createdAtEpoch;
      const daysSince = (now - referenceTime) / (1000 * 60 * 60 * 24);
      const staleness = Math.min(1.0, daysSince / 180);
      const decayFactor = 1 - staleness * 0.3; // Max 30% decay

      const finalScore = baseScore * typeWeight * decayFactor;

      return { ...c, finalScore };
    });

    return scored.sort((a, b) => b.finalScore - a.finalScore);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/fusion-ranker.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/search/FusionRanker.ts tests/services/fusion-ranker.test.ts
git commit -m "feat(search): add adaptive fusion ranker with type weighting and staleness decay (2.1)

Query classification (exact/semantic/balanced), dynamic weights,
multi-dimensional scoring with type priority and time decay."
```

---

### Task 10: Integrate FusionRanker into SearchManager

**Files:**
- Modify: `src/services/worker/SearchManager.ts`

- [ ] **Step 1: Import and instantiate FusionRanker**

At the top of `SearchManager.ts`:

```typescript
import { FusionRanker, type FusionCandidate } from './search/FusionRanker.js';
```

Add to class constructor:

```typescript
private fusionRanker: FusionRanker = new FusionRanker();
```

- [ ] **Step 2: Add fusion merge logic to search method**

In the `search` method, find PATH 2 (Chroma semantic search) and PATH 3 (FTS5 fallback). After both paths have collected their results, add fusion logic before the final return:

```typescript
// After collecting chromaResults and ftsResults
if (chromaResults.length > 0 && ftsResults.length > 0) {
  const queryType = this.fusionRanker.classifyQuery(query);

  // Build candidate map (dedup by ID)
  const candidateMap = new Map<number, FusionCandidate>();

  // Normalize Chroma scores (distance → similarity: 1 - distance)
  const maxChromaDist = Math.max(...chromaResults.map(r => r.distance || 1));
  for (const cr of chromaResults) {
    const similarity = 1 - (cr.distance || 0) / (maxChromaDist || 1);
    candidateMap.set(cr.id, {
      id: cr.id,
      chromaScore: similarity,
      ftsScore: 0,
      type: cr.type || 'discovery',
      lastReferencedAt: cr.last_referenced_at || null,
      createdAtEpoch: cr.created_at_epoch || 0,
    });
  }

  // Normalize FTS5 scores
  const maxFtsRank = Math.max(...ftsResults.map(r => r.rank || 1));
  for (const fr of ftsResults) {
    const normalizedRank = (fr.rank || 0) / (maxFtsRank || 1);
    const existing = candidateMap.get(fr.id);
    if (existing) {
      existing.ftsScore = normalizedRank;
    } else {
      candidateMap.set(fr.id, {
        id: fr.id,
        chromaScore: 0,
        ftsScore: normalizedRank,
        type: fr.type || 'discovery',
        lastReferencedAt: fr.last_referenced_at || null,
        createdAtEpoch: fr.created_at_epoch || 0,
      });
    }
  }

  const ranked = this.fusionRanker.rank([...candidateMap.values()], queryType);
  const rankedIds = ranked.map(r => r.id);

  // Update last_referenced_at for top hits
  if (this.sessionStore && rankedIds.length > 0) {
    this.sessionStore.updateLastReferenced(rankedIds.slice(0, 10));
  }

  // Reorder results by fusion score
  // ... (reorder allResults to match rankedIds ordering)
}
```

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 4: Run benchmark to measure improvement**

Run: `npm run benchmark`
Compare R@5 and NDCG against baseline. Log results to `tests/benchmark/results/after-fusion.json`.

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/SearchManager.ts
git commit -m "feat(search): integrate fusion ranking into SearchManager (2.1)

FTS5 + ChromaDB results now merged via adaptive fusion scoring.
Benchmark: [insert R@5 improvement here]"
```

---

### Task 11: Non-Blocking Periodic Save

**Files:**
- Modify: `src/services/worker-service.ts`
- Modify: `src/services/worker/http/routes/SearchRoutes.ts` (or new route)

- [ ] **Step 1: Add /api/incremental-save endpoint**

In `src/services/worker-service.ts`, register a new route:

```typescript
// In route setup section
app.post('/api/incremental-save', async (req, res) => {
  const { contentSessionId, project } = req.body;
  if (!contentSessionId || !project) {
    return res.status(400).json({ error: 'contentSessionId and project required' });
  }

  // Fire and forget — respond immediately
  res.json({ status: 'accepted' });

  // Process in background
  try {
    await this.sdkAgent.processIncrementalSave(contentSessionId, project);
  } catch (err) {
    logger.error('Incremental save failed', err);
  }
});
```

- [ ] **Step 2: Add prompt counter tracking for periodic trigger**

The PostToolUse hook already sends each tool result. Add a counter in the hook handler:

In the hook handling section of worker-service, track prompt count per session. Every 10 prompts, also send an incremental-save request:

```typescript
// In the observation hook handler
const promptCount = this.sessionManager.getPromptCount(contentSessionId);
if (promptCount > 0 && promptCount % 10 === 0) {
  // Non-blocking: don't await
  fetch(`http://localhost:${this.port}/api/incremental-save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentSessionId, project }),
  }).catch(() => {}); // Silently ignore failures
}
```

- [ ] **Step 3: Run test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/services/worker-service.ts
git commit -m "feat(save): add non-blocking periodic save every 10 tool calls (5.1)

POST /api/incremental-save fires in background. Long sessions
no longer risk losing observations on unexpected exit."
```

---

## Batch 3: Memory System Ownership (depends on Batch 1-2)

---

### Task 12: sync_state Table (Migration 31)

**Files:**
- Modify: `src/services/sqlite/migrations/runner.ts`

- [ ] **Step 1: Add migration 31 — sync_state table**

In `src/services/sqlite/migrations/runner.ts`, add to `runAllMigrations()`:

```typescript
this.createSyncStateTable(); // migration 31
```

Add the method:

```typescript
private createSyncStateTable(): void {
  const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(31);
  if (applied) return;

  this.db.exec(`
    CREATE TABLE IF NOT EXISTS sync_state (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      source_type TEXT NOT NULL,
      last_sync_at TEXT NOT NULL
    );
  `);

  this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(31, new Date().toISOString());
}
```

- [ ] **Step 2: Run test suite**

Run: `bun test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/services/sqlite/migrations/runner.ts
git commit -m "feat(schema): add sync_state table for auto memory tracking (0.1)

Migration 31: tracks content hashes of synced auto memory files."
```

---

### Task 13: Auto Memory Sync Service

**Files:**
- Create: `src/services/sync/AutoMemorySync.ts`
- Create: `tests/services/auto-memory-sync.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/auto-memory-sync.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { AutoMemorySync } from '../../src/services/sync/AutoMemorySync.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

describe('AutoMemorySync', () => {
  let dir: string;
  let memoryDir: string;
  let db: Database.Database;
  let sync: AutoMemorySync;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-sync-'));
    memoryDir = join(dir, 'memory');
    mkdirSync(memoryDir, { recursive: true });

    db = new Database(join(dir, 'test.db'));
    db.exec(`
      CREATE TABLE sync_state (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        last_sync_at TEXT NOT NULL
      );
      CREATE TABLE agent_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        profile_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(scope, profile_type)
      );
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT DEFAULT '[]',
        narrative TEXT,
        concepts TEXT DEFAULT '[]',
        files_read TEXT DEFAULT '[]',
        files_modified TEXT DEFAULT '[]',
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        content_hash TEXT,
        confidence TEXT DEFAULT 'high',
        tags TEXT DEFAULT '[]',
        has_preference BOOLEAN DEFAULT 1,
        event_date TEXT,
        last_referenced_at TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
    `);

    sync = new AutoMemorySync(db, memoryDir);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('syncs user-type memory file to agent_profiles', () => {
    writeFileSync(join(memoryDir, 'user_role.md'), `---
name: user role
description: User is a PM
type: user
---

Name: Eli
Role: Product Manager
`);

    const result = sync.syncIncremental();
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const profile = db.prepare("SELECT * FROM agent_profiles WHERE scope = 'global' AND profile_type = 'user'").get() as any;
    expect(profile).toBeTruthy();
    expect(profile.content_json).toContain('Eli');
  });

  test('syncs feedback-type memory file to observations', () => {
    writeFileSync(join(memoryDir, 'feedback_testing.md'), `---
name: testing feedback
description: Don't mock the database
type: feedback
---

Don't mock the database in integration tests.
**Why:** Prior incident with mock/prod divergence.
`);

    const result = sync.syncIncremental();
    expect(result.imported).toBe(1);

    const obs = db.prepare("SELECT * FROM observations WHERE type = 'feedback'").all();
    expect(obs).toHaveLength(1);
  });

  test('skips project and reference types', () => {
    writeFileSync(join(memoryDir, 'project_context.md'), `---
name: project context
description: Some project info
type: project
---

Project details here.
`);

    const result = sync.syncIncremental();
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
  });

  test('skips already-synced unchanged files', () => {
    writeFileSync(join(memoryDir, 'user_role.md'), `---
name: user role
description: User is a PM
type: user
---

Name: Eli
`);

    sync.syncIncremental();
    const result2 = sync.syncIncremental();
    expect(result2.imported).toBe(0); // No change, skip
  });

  test('re-syncs when file content changes', () => {
    const filePath = join(memoryDir, 'user_role.md');
    writeFileSync(filePath, `---
name: user role
description: User info
type: user
---

Name: Eli
Role: PM
`);

    sync.syncIncremental();

    writeFileSync(filePath, `---
name: user role
description: User info
type: user
---

Name: Eli
Role: Senior PM
Location: Canada
`);

    const result = sync.syncIncremental();
    expect(result.imported).toBe(1); // Changed, re-sync
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/auto-memory-sync.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AutoMemorySync**

```typescript
// src/services/sync/AutoMemorySync.ts
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

interface MemoryFrontmatter {
  name: string;
  description: string;
  type: 'user' | 'feedback' | 'project' | 'reference';
}

interface SyncResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export class AutoMemorySync {
  private db: Database.Database;
  private memoryDir: string;

  constructor(db: Database.Database, memoryDir: string) {
    this.db = db;
    this.memoryDir = memoryDir;
  }

  syncIncremental(): SyncResult {
    const result: SyncResult = { imported: 0, skipped: 0, errors: [] };

    if (!existsSync(this.memoryDir)) return result;

    const files = readdirSync(this.memoryDir).filter(f => f.endsWith('.md'));

    for (const file of files) {
      try {
        const filePath = join(this.memoryDir, file);
        const content = readFileSync(filePath, 'utf-8');
        const contentHash = createHash('sha256').update(content).digest('hex');

        // Check if already synced with same hash
        const existing = this.db.prepare(
          'SELECT content_hash FROM sync_state WHERE file_path = ?'
        ).get(filePath) as { content_hash: string } | undefined;

        if (existing?.content_hash === contentHash) {
          result.skipped++;
          continue;
        }

        // Parse frontmatter
        const frontmatter = this.parseFrontmatter(content);
        if (!frontmatter) {
          result.skipped++;
          continue;
        }

        // Only sync user and feedback types
        if (frontmatter.type === 'project' || frontmatter.type === 'reference') {
          result.skipped++;
          continue;
        }

        const body = this.extractBody(content);

        if (frontmatter.type === 'user') {
          this.syncUserProfile(body);
        } else if (frontmatter.type === 'feedback') {
          this.syncFeedback(body, frontmatter.name);
        }

        // Update sync state
        this.db.prepare(`
          INSERT OR REPLACE INTO sync_state (file_path, content_hash, source_type, last_sync_at)
          VALUES (?, ?, ?, ?)
        `).run(filePath, contentHash, frontmatter.type, new Date().toISOString());

        result.imported++;
      } catch (err) {
        result.errors.push(`${file}: ${(err as Error).message}`);
      }
    }

    return result;
  }

  fullImport(): SyncResult {
    // Clear existing sync state and re-import everything
    this.db.prepare('DELETE FROM sync_state').run();
    return this.syncIncremental();
  }

  private syncUserProfile(body: string): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_profiles (scope, profile_type, content_json, updated_at)
      VALUES ('global', 'user', ?, ?)
    `).run(JSON.stringify({ source: 'auto_memory', content: body }), new Date().toISOString());
  }

  private syncFeedback(body: string, name: string): void {
    const sessionId = `auto-memory-sync-${Date.now()}`;
    const now = new Date();

    this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash,
       confidence, tags, has_preference, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId, '_global', 'feedback', name, 'From auto memory',
      '[]', body, '["auto-memory"]',
      '[]', '[]', 0, 0,
      createHash('sha256').update(body).digest('hex'),
      'high', '["auto-memory-sync"]', body.toLowerCase().includes('prefer') ? 1 : 0,
      now.toISOString(), now.getTime()
    );
  }

  private parseFrontmatter(content: string): MemoryFrontmatter | null {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return null;

    const lines = match[1].split('\n');
    const fm: Record<string, string> = {};
    for (const line of lines) {
      const [key, ...rest] = line.split(':');
      if (key && rest.length > 0) {
        fm[key.trim()] = rest.join(':').trim();
      }
    }

    if (!fm.type || !fm.name) return null;
    return fm as unknown as MemoryFrontmatter;
  }

  private extractBody(content: string): string {
    const match = content.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
    return match ? match[1].trim() : content.trim();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/auto-memory-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Wire into SessionStart**

In `src/services/worker-service.ts`, in the context hook handler (where SessionStart triggers), add:

```typescript
import { AutoMemorySync } from '../sync/AutoMemorySync.js';

// In context generation, after DB is ready:
const autoMemoryDir = join(homedir(), '.claude', 'memory');
const autoSync = new AutoMemorySync(this.db, autoMemoryDir);
const syncResult = autoSync.syncIncremental();
if (syncResult.imported > 0) {
  logger.info(`Auto memory sync: imported ${syncResult.imported} entries`);
}
```

- [ ] **Step 6: Commit**

```bash
git add src/services/sync/AutoMemorySync.ts tests/services/auto-memory-sync.test.ts src/services/worker-service.ts
git commit -m "feat(sync): auto memory incremental sync on SessionStart (0.1)

Scans ~/.claude/memory/*.md, syncs user→agent_profiles and
feedback→observations. Content hash dedup prevents re-import."
```

---

### Task 14: .assistant/ Migration Tool

**Files:**
- Create: `src/services/migration/AssistantMigrator.ts`
- Create: `tests/services/assistant-migrator.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/assistant-migrator.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { AssistantMigrator } from '../../src/services/migration/AssistantMigrator.js';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

describe('AssistantMigrator', () => {
  let dir: string;
  let assistantDir: string;
  let db: Database.Database;
  let migrator: AssistantMigrator;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ar-migrate-'));
    assistantDir = join(dir, '.assistant');
    mkdirSync(assistantDir, { recursive: true });

    db = new Database(join(dir, 'test.db'));
    db.exec(`
      CREATE TABLE agent_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        profile_type TEXT NOT NULL,
        content_json TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(scope, profile_type)
      );
      CREATE TABLE observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        type TEXT NOT NULL, title TEXT, subtitle TEXT,
        facts TEXT DEFAULT '[]', narrative TEXT,
        concepts TEXT DEFAULT '[]', files_read TEXT DEFAULT '[]',
        files_modified TEXT DEFAULT '[]', prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0, content_hash TEXT,
        confidence TEXT DEFAULT 'medium', tags TEXT DEFAULT '[]',
        has_preference BOOLEAN DEFAULT 0, event_date TEXT,
        last_referenced_at TEXT,
        created_at TEXT NOT NULL, created_at_epoch INTEGER NOT NULL
      );
      CREATE TABLE session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT, project TEXT,
        request TEXT, investigated TEXT, learned TEXT,
        completed TEXT, next_steps TEXT, notes TEXT,
        files_read TEXT, files_edited TEXT,
        prompt_number INTEGER, discovery_tokens INTEGER DEFAULT 0,
        created_at TEXT, created_at_epoch INTEGER
      );
    `);

    migrator = new AssistantMigrator(db, dir);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('detects .assistant/ directory', () => {
    expect(migrator.detect()).toBe(true);
  });

  test('returns false when no .assistant/', () => {
    rmSync(assistantDir, { recursive: true });
    expect(migrator.detect()).toBe(false);
  });

  test('migrates USER.md to agent_profiles', () => {
    writeFileSync(join(assistantDir, 'USER.md'), '# User\nName: Eli\nRole: PM');

    const result = migrator.migrate('test-project');
    expect(result.profiles).toBe(1);

    const profile = db.prepare("SELECT * FROM agent_profiles WHERE profile_type = 'user'").get() as any;
    expect(profile.content_json).toContain('Eli');
  });

  test('migrates STYLE.md to agent_profiles', () => {
    writeFileSync(join(assistantDir, 'STYLE.md'), '# Style\nConcise and direct');

    const result = migrator.migrate('test-project');
    expect(result.profiles).toBeGreaterThanOrEqual(1);
  });

  test('migrates MEMORY.md entries to observations', () => {
    writeFileSync(join(assistantDir, 'MEMORY.md'), `# Memory

## Preference: Always use TypeScript strict mode
Confirmed on 2026-03-15.

## Decision: Chose PostgreSQL over MySQL
Performance benchmarks favored PostgreSQL for our workload.
`);

    const result = migrator.migrate('test-project');
    expect(result.observations).toBeGreaterThanOrEqual(1);
  });

  test('renames .assistant/ to .assistant.migrated/', () => {
    writeFileSync(join(assistantDir, 'USER.md'), 'Name: Eli');

    migrator.migrate('test-project');

    expect(existsSync(assistantDir)).toBe(false);
    expect(existsSync(join(dir, '.assistant.migrated'))).toBe(true);
  });

  test('skips if already migrated', () => {
    writeFileSync(join(assistantDir, 'USER.md'), 'Name: Eli');
    migrator.migrate('test-project');

    // Second call should detect no .assistant/
    expect(migrator.detect()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/assistant-migrator.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AssistantMigrator**

```typescript
// src/services/migration/AssistantMigrator.ts
import { existsSync, readFileSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import type Database from 'better-sqlite3';

interface MigrationResult {
  profiles: number;
  observations: number;
  summaries: number;
  errors: string[];
}

const PROFILE_MAPPING: Record<string, string> = {
  'USER.md': 'user',
  'STYLE.md': 'style',
  'WORKFLOW.md': 'workflow',
};

export class AssistantMigrator {
  private db: Database.Database;
  private projectDir: string;

  constructor(db: Database.Database, projectDir: string) {
    this.db = db;
    this.projectDir = projectDir;
  }

  detect(): boolean {
    return existsSync(join(this.projectDir, '.assistant'));
  }

  migrate(project: string): MigrationResult {
    const result: MigrationResult = { profiles: 0, observations: 0, summaries: 0, errors: [] };
    const assistantDir = join(this.projectDir, '.assistant');

    if (!this.detect()) return result;

    // 1. Migrate profile files
    for (const [filename, profileType] of Object.entries(PROFILE_MAPPING)) {
      try {
        const filePath = join(assistantDir, filename);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8').trim();
          if (content.length > 0) {
            this.db.prepare(`
              INSERT OR REPLACE INTO agent_profiles (scope, profile_type, content_json, updated_at)
              VALUES (?, ?, ?, ?)
            `).run(project, profileType, JSON.stringify({ source: 'assistant_migration', content }), new Date().toISOString());
            result.profiles++;
          }
        }
      } catch (err) {
        result.errors.push(`${filename}: ${(err as Error).message}`);
      }
    }

    // 2. Migrate MEMORY.md entries to observations
    try {
      const memoryPath = join(assistantDir, 'MEMORY.md');
      if (existsSync(memoryPath)) {
        const content = readFileSync(memoryPath, 'utf-8');
        const entries = this.splitMemoryEntries(content);
        for (const entry of entries) {
          this.writeObservation(project, entry.title, entry.body);
          result.observations++;
        }
      }
    } catch (err) {
      result.errors.push(`MEMORY.md: ${(err as Error).message}`);
    }

    // 3. Migrate memory/projects/*.md
    try {
      const projectsDir = join(assistantDir, 'memory', 'projects');
      if (existsSync(projectsDir)) {
        const files = readdirSync(projectsDir).filter(f => f.endsWith('.md'));
        for (const file of files) {
          const content = readFileSync(join(projectsDir, file), 'utf-8').trim();
          if (content.length > 0) {
            this.writeObservation(project, `Project: ${file.replace('.md', '')}`, content);
            result.observations++;
          }
        }
      }
    } catch (err) {
      result.errors.push(`memory/projects: ${(err as Error).message}`);
    }

    // 4. Migrate last-session.md to session_summaries
    try {
      const lastSessionPath = join(assistantDir, 'runtime', 'last-session.md');
      if (existsSync(lastSessionPath)) {
        const content = readFileSync(lastSessionPath, 'utf-8').trim();
        if (content.length > 0) {
          const now = new Date();
          this.db.prepare(`
            INSERT INTO session_summaries
            (memory_session_id, project, request, completed, next_steps, created_at, created_at_epoch)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(
            `migrated-${now.getTime()}`, project,
            'Migrated from .assistant/', content, '',
            now.toISOString(), now.getTime()
          );
          result.summaries++;
        }
      }
    } catch (err) {
      result.errors.push(`last-session.md: ${(err as Error).message}`);
    }

    // 5. Archive .assistant/
    const archivedPath = join(this.projectDir, '.assistant.migrated');
    if (!existsSync(archivedPath)) {
      renameSync(assistantDir, archivedPath);
    }

    return result;
  }

  private splitMemoryEntries(content: string): { title: string; body: string }[] {
    const entries: { title: string; body: string }[] = [];
    const sections = content.split(/^## /m).filter(s => s.trim().length > 0);

    for (const section of sections) {
      const lines = section.split('\n');
      const title = lines[0].trim().replace(/^#+\s*/, '');
      const body = lines.slice(1).join('\n').trim();
      if (title && body) {
        entries.push({ title, body });
      }
    }

    return entries;
  }

  private writeObservation(project: string, title: string, body: string): void {
    const now = new Date();
    const hash = createHash('sha256').update(body).digest('hex');

    this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash,
       confidence, tags, has_preference,
       created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `migration-${now.getTime()}`, project, 'discovery',
      title, 'Migrated from .assistant/',
      '[]', body, '["assistant-migration"]',
      '[]', '[]', 0, 0, hash,
      'medium', '["migrated"]',
      body.toLowerCase().includes('prefer') ? 1 : 0,
      now.toISOString(), now.getTime()
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/services/assistant-migrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/migration/AssistantMigrator.ts tests/services/assistant-migrator.test.ts
git commit -m "feat(migration): add .assistant/ one-click migration tool (0.3)

Migrates USER/STYLE/WORKFLOW→agent_profiles, MEMORY→observations,
last-session→session_summaries. Archives original as .assistant.migrated/"
```

---

### Task 15: Wire Migrations + Integration Test

**Files:**
- Modify: `src/services/worker-service.ts`

- [ ] **Step 1: Initialize AutoMemorySync and AssistantMigrator in worker**

In `src/services/worker-service.ts`, in the background initialization section, add:

```typescript
import { AutoMemorySync } from '../sync/AutoMemorySync.js';
import { AssistantMigrator } from '../migration/AssistantMigrator.js';
import { LockManager } from '../concurrency/LockManager.js';
import { homedir } from 'os';
import { join } from 'path';

// In background init, after DB ready:
const dataDir = this.settingsManager.get('CLAUDE_MEM_DATA_DIR') || join(homedir(), '.agent-recall');
this.lockManager = new LockManager(join(dataDir, 'locks'));

// Auto memory sync runs on every context generation
// AssistantMigrator runs on first bootstrap detection
```

- [ ] **Step 2: Run full test suite**

Run: `bun test`
Expected: ALL PASS

- [ ] **Step 3: Run benchmark one final time**

Run: `npm run benchmark`
Save to `tests/benchmark/results/phase1-complete.json`

- [ ] **Step 4: Final Phase 1 commit**

```bash
git add src/services/worker-service.ts
git commit -m "feat(phase1): wire all Phase 1 services into worker (integration)

LockManager, AutoMemorySync, AssistantMigrator initialized.
Phase 1 foundation complete: benchmark baseline, concurrency safety,
fusion ranking, RECALL_PROTOCOL, auto memory sync, .assistant migration."
```

---

## Phase 1 Summary

| Item | Task(s) | Status |
|------|---------|--------|
| 6.1 Benchmark | Task 1 | |
| 0.5 Concurrency (WAL+buffer+lock) | Tasks 2-4 | |
| 4.1 RECALL_PROTOCOL | Task 5 | |
| 1.3a Observations fields | Tasks 6-7 | |
| 1.4 ChromaDB metadata | Task 8 | |
| 2.1 Fusion ranking | Tasks 9-10 | |
| 5.1 Periodic save | Task 11 | |
| 0.1 Auto memory sync | Tasks 12-13 | |
| 0.3 .assistant/ migration | Task 14 | |
| 0.4 Auto memory import | Task 13 (fullImport method) | |
| Integration wiring | Task 15 | |
