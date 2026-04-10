/**
 * End-to-end integration tests for the optimization pipeline.
 *
 * Verifies that the full pipeline works together — observation lifecycle,
 * knowledge compilation, context injection, temporal search, deduplication,
 * privacy filtering, knowledge graph, dashboard metrics, and markdown export.
 *
 * Each test is self-contained with its own in-memory DB instance.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../src/services/sqlite/migrations/runner.js';
import { storeObservation } from '../../src/services/sqlite/observations/store.js';
import { getObservationById } from '../../src/services/sqlite/observations/get.js';
import { createSDKSession, updateMemorySessionId } from '../../src/services/sqlite/Sessions.js';
import { FusionRanker } from '../../src/services/worker/search/FusionRanker.js';
import { CompilationEngine } from '../../src/services/compilation/CompilationEngine.js';
import { LockManager } from '../../src/services/concurrency/LockManager.js';
import { TokenBudgetManager } from '../../src/services/context/TokenBudgetManager.js';
import { TemporalParser } from '../../src/services/worker/search/TemporalParser.js';
import { DeduplicationService } from '../../src/services/worker/DeduplicationService.js';
import { PrivacyGuard } from '../../src/services/compilation/PrivacyGuard.js';
import { KnowledgeGraphService } from '../../src/services/knowledge-graph/KnowledgeGraphService.js';
import { DashboardService } from '../../src/services/dashboard/DashboardService.js';
import { MarkdownExporter } from '../../src/services/markdown-sync/MarkdownExporter.js';
import { logger } from '../../src/utils/logger.js';
import type { ObservationInput } from '../../src/services/sqlite/observations/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(':memory:');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  return db;
}

/**
 * Create a session + assign a memory_session_id so observations can be stored
 * (the FK requires memory_session_id to exist in sdk_sessions).
 */
function seedSession(db: Database, memorySessionId: string, project: string): number {
  const contentSessionId = `content-${memorySessionId}`;
  const dbId = createSDKSession(db, contentSessionId, project, 'test prompt');
  updateMemorySessionId(db, dbId, memorySessionId);
  return dbId;
}

function makeObservation(overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    type: 'discovery',
    title: 'Test Observation',
    subtitle: 'Subtitle',
    facts: ['fact-a', 'fact-b'],
    narrative: 'Test narrative content',
    concepts: ['concept-alpha', 'concept-beta'],
    files_read: ['/src/a.ts'],
    files_modified: ['/src/b.ts'],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Optimization Pipeline Integration', () => {
  beforeEach(() => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];
  });

  afterEach(() => {
    loggerSpies.forEach(spy => spy.mockRestore());
  });

  // ─── Test 1: Full observation lifecycle ────────────────────────────────────

  describe('Test 1: Full observation lifecycle', () => {
    let db: Database;

    beforeEach(() => { db = createTestDb(); });
    afterEach(() => { db.close(); });

    test('stores observations with Phase 1 fields and ranks them', () => {
      const project = 'lifecycle-proj';
      seedSession(db, 'ses-lc-1', project);

      // Store observations with various types
      const decisionObs = makeObservation({
        type: 'decision',
        title: 'Decided to use SQLite',
        narrative: 'We decided to use SQLite for persistence',
        concepts: ['database', 'architecture'],
      });

      const discoveryObs = makeObservation({
        type: 'discovery',
        title: 'Found performance bottleneck',
        narrative: 'Discovered a slow query in the search pipeline',
        concepts: ['performance', 'search'],
      });

      const bugfixObs = makeObservation({
        type: 'bugfix',
        title: 'Fixed null pointer in ranker',
        narrative: 'Fixed a null reference in the FusionRanker',
        concepts: ['bugfix', 'ranker'],
      });

      const r1 = storeObservation(db, 'ses-lc-1', project, decisionObs, 1, 0, Date.now() - 1000);
      const r2 = storeObservation(db, 'ses-lc-1', project, discoveryObs, 2, 0, Date.now() - 500);
      const r3 = storeObservation(db, 'ses-lc-1', project, bugfixObs, 3, 0, Date.now());

      // Verify observations are stored
      expect(r1.id).toBeGreaterThan(0);
      expect(r2.id).toBeGreaterThan(0);
      expect(r3.id).toBeGreaterThan(0);

      // Verify Phase 1 fields exist on the stored rows
      const obs1 = db.prepare('SELECT confidence, tags, has_preference FROM observations WHERE id = ?').get(r1.id) as any;
      expect(obs1).toBeTruthy();
      expect(obs1.confidence).toBe('medium'); // default
      expect(obs1.tags).toBe('[]');           // default
      expect(obs1.has_preference).toBe(0);    // default

      // Verify retrieval works
      const fetched = getObservationById(db, r1.id);
      expect(fetched).toBeTruthy();
      expect(fetched!.type).toBe('decision');

      // Now rank them using FusionRanker
      const ranker = new FusionRanker();
      const candidates = [
        { id: r1.id, chromaScore: 0.9, ftsScore: 0.8, type: 'decision', lastReferencedAt: null, createdAtEpoch: r1.createdAtEpoch },
        { id: r2.id, chromaScore: 0.7, ftsScore: 0.6, type: 'discovery', lastReferencedAt: null, createdAtEpoch: r2.createdAtEpoch },
        { id: r3.id, chromaScore: 0.5, ftsScore: 0.4, type: 'bugfix', lastReferencedAt: null, createdAtEpoch: r3.createdAtEpoch },
      ];

      const ranked = ranker.rank(candidates, 'balanced');
      expect(ranked.length).toBe(3);

      // Decisions have weight 1.0, discoveries 0.8, bugfixes 0.7
      // With balanced weights (chroma=0.55, fts5=0.45):
      // decision: (0.55*0.9 + 0.45*0.8) * 1.0 * decay
      // discovery: (0.55*0.7 + 0.45*0.6) * 0.8 * decay
      // bugfix: (0.55*0.5 + 0.45*0.4) * 0.7 * decay
      // Decision should be ranked first
      expect(ranked[0].id).toBe(r1.id);
      expect(ranked[0].finalScore).toBeGreaterThan(ranked[1].finalScore);
      expect(ranked[1].finalScore).toBeGreaterThan(ranked[2].finalScore);
    });

    test('staleness decay penalizes old observations', () => {
      const ranker = new FusionRanker();
      const now = Date.now();
      const MS_PER_DAY = 24 * 60 * 60 * 1000;

      const candidates = [
        { id: 1, chromaScore: 0.8, ftsScore: 0.8, type: 'decision', lastReferencedAt: null, createdAtEpoch: now },
        { id: 2, chromaScore: 0.8, ftsScore: 0.8, type: 'decision', lastReferencedAt: null, createdAtEpoch: now - 90 * MS_PER_DAY },
        { id: 3, chromaScore: 0.8, ftsScore: 0.8, type: 'decision', lastReferencedAt: null, createdAtEpoch: now - 180 * MS_PER_DAY },
      ];

      const ranked = ranker.rank(candidates, 'balanced');

      // Most recent should score highest due to less staleness decay
      expect(ranked[0].id).toBe(1);
      expect(ranked[1].id).toBe(2);
      expect(ranked[2].id).toBe(3);

      // 180-day-old observation gets max decay (1 - 0.3 = 0.7)
      // Fresh observation gets no decay (1.0)
      expect(ranked[0].finalScore).toBeGreaterThan(ranked[2].finalScore * 1.3);
    });
  });

  // ─── Test 2: Knowledge compilation pipeline ────────────────────────────────

  describe('Test 2: Knowledge compilation pipeline', () => {
    let db: Database;
    let lockManager: LockManager;

    beforeEach(() => {
      db = createTestDb();
      lockManager = new LockManager();
    });

    afterEach(() => {
      lockManager.releaseAll();
      db.close();
    });

    test('compiles observations into knowledge pages grouped by topic', async () => {
      const project = 'compile-proj';

      // Create enough sessions to pass the session gate (>= 5)
      for (let i = 0; i < 6; i++) {
        seedSession(db, `ses-compile-${i}`, project);
      }

      // Seed 12 observations across 3 topics
      const topics = ['authentication', 'database', 'search'];
      for (let i = 0; i < 12; i++) {
        const topic = topics[i % 3];
        const sessionId = `ses-compile-${i % 6}`;
        const obs = makeObservation({
          type: i % 2 === 0 ? 'discovery' : 'decision',
          title: `Observation ${i} about ${topic}`,
          narrative: `Detailed narrative about ${topic} item ${i}`,
          concepts: JSON.stringify([topic, 'general']) as any,
          facts: ['fact-1', `${topic}-fact-${i}`],
        });
        // Store with concepts as proper array
        const correctedObs = {
          ...obs,
          concepts: [topic, 'general'],
        };
        storeObservation(db, sessionId, project, correctedObs, i + 1, 0, Date.now() - (12 - i) * 1000);
      }

      // Create CompilationEngine with settings that don't block
      const settings: Record<string, string> = {};
      const engine = new CompilationEngine(db, lockManager, settings);

      // Run compilation
      const result = await engine.tryCompile(project);

      // Verify compilation produced results
      expect(result).toBeTruthy();
      expect(result!.pagesCreated).toBeGreaterThanOrEqual(3); // At least 3 topics
      expect(result!.observationsProcessed).toBeGreaterThan(0);
      expect(result!.errors.length).toBe(0);

      // Verify compiled_knowledge rows exist
      const pages = db.prepare(
        'SELECT * FROM compiled_knowledge WHERE project = ?'
      ).all(project) as any[];
      expect(pages.length).toBeGreaterThanOrEqual(3);

      // Verify source_observation_ids are set correctly
      for (const page of pages) {
        const ids = JSON.parse(page.source_observation_ids);
        expect(Array.isArray(ids)).toBe(true);
        expect(ids.length).toBeGreaterThan(0);
      }

      // Verify topics are correct
      const pageTitles = pages.map((p: any) => p.topic);
      for (const topic of topics) {
        expect(pageTitles).toContain(topic);
      }
    });

    test('GateKeeper blocks when not enough sessions exist', async () => {
      const project = 'gate-blocked-proj';
      // Only create 2 sessions (need >= 5)
      seedSession(db, 'ses-gb-1', project);
      seedSession(db, 'ses-gb-2', project);

      const settings: Record<string, string> = {};
      const engine = new CompilationEngine(db, lockManager, settings);

      const result = await engine.tryCompile(project);
      expect(result).toBeNull(); // GateKeeper should block
    });
  });

  // ─── Test 3: Context injection with L0-L3 budgets ─────────────────────────

  describe('Test 3: Context injection with L0-L3 budgets', () => {
    test('allocates budgets correctly across layers', () => {
      const manager = new TokenBudgetManager(3000);

      // Total should be exactly 3000
      const l0 = manager.getBudget('L0');
      const l1 = manager.getBudget('L1');
      const l2 = manager.getBudget('L2');
      const l3 = manager.getBudget('L3');
      expect(l0 + l1 + l2 + l3).toBe(3000);

      // L0 should be ~8% of 3000 = 240
      expect(l0).toBe(Math.floor(3000 * 0.08)); // 240
      expect(l0).toBeLessThanOrEqual(240);
    });

    test('L0 persona + RECALL_PROTOCOL fits within 8% budget', () => {
      const manager = new TokenBudgetManager(3000);
      const l0Budget = manager.getBudget('L0');

      // Simulate persona content (~100 tokens) + RECALL_PROTOCOL (~60 tokens)
      const personaText = 'Agent Recall is an AI assistant with persistent memory. It remembers past conversations and decisions.';
      const recallProtocol = 'RECALL_PROTOCOL: Search memories before answering. Reference prior context.';

      const personaTokens = TokenBudgetManager.estimateTokens(personaText);
      const protocolTokens = TokenBudgetManager.estimateTokens(recallProtocol);
      const totalL0 = personaTokens + protocolTokens;

      expect(manager.canFit('L0', totalL0)).toBe(true);
      expect(totalL0).toBeLessThan(l0Budget);
    });

    test('L2 observations are limited by token budget', () => {
      const manager = new TokenBudgetManager(3000);
      const l2Budget = manager.getBudget('L2');

      // Simulate adding observations until budget is exhausted
      const singleObservation = 'This is a medium-length observation about a code change that was made to improve performance in the search pipeline.';
      const tokensPerObs = TokenBudgetManager.estimateTokens(singleObservation);

      let count = 0;
      while (manager.canFit('L2', tokensPerObs)) {
        manager.consume('L2', tokensPerObs);
        count++;
      }

      // Should have fit some observations
      expect(count).toBeGreaterThan(0);

      // Should NOT fit another one
      expect(manager.canFit('L2', tokensPerObs)).toBe(false);
      expect(manager.remaining('L2')).toBeLessThan(tokensPerObs);
    });

    test('overflow simulation - observations trimmed when budget exceeded', () => {
      const manager = new TokenBudgetManager(3000);
      const l2Budget = manager.getBudget('L2');

      // Create a list of observations
      const observations = Array.from({ length: 100 }, (_, i) =>
        `Observation ${i}: detailed narrative about the work done on feature ${i} with various technical details and context.`
      );

      // Simulate the trimming logic
      const included: string[] = [];
      for (const obs of observations) {
        const tokens = TokenBudgetManager.estimateTokens(obs);
        if (manager.canFit('L2', tokens)) {
          manager.consume('L2', tokens);
          included.push(obs);
        }
      }

      // Not all observations should fit
      expect(included.length).toBeLessThan(observations.length);
      expect(included.length).toBeGreaterThan(0);

      // Remaining budget should be small
      expect(manager.remaining('L2')).toBeLessThan(TokenBudgetManager.estimateTokens(observations[0]));
    });

    test('budget clamps to min/max range', () => {
      const tooSmall = new TokenBudgetManager(500);
      expect(tooSmall.totalBudget).toBe(1500); // clamped to MIN_BUDGET

      const tooLarge = new TokenBudgetManager(50000);
      expect(tooLarge.totalBudget).toBe(8000); // clamped to MAX_BUDGET
    });
  });

  // ─── Test 4: Temporal search ───────────────────────────────────────────────

  describe('Test 4: Temporal search', () => {
    let db: Database;

    beforeEach(() => { db = createTestDb(); });
    afterEach(() => { db.close(); });

    test('parses "last week" and boosts recent observations', () => {
      const project = 'temporal-proj';
      seedSession(db, 'ses-temp-1', project);

      const now = new Date();
      const MS_PER_DAY = 24 * 60 * 60 * 1000;

      // Seed observations with different ages
      const ages = [
        { days: 1, title: 'Yesterday observation' },
        { days: 7, title: 'Week-old observation' },
        { days: 30, title: 'Month-old observation' },
      ];

      const storedObs: { id: number; epoch: number; title: string }[] = [];
      for (const { days, title } of ages) {
        const epoch = now.getTime() - days * MS_PER_DAY;
        const obs = makeObservation({ title, narrative: `Narrative for ${title}` });
        const result = storeObservation(db, 'ses-temp-1', project, obs, 1, 0, epoch);
        storedObs.push({ id: result.id, epoch, title });
      }

      // Parse temporal query
      const parser = new TemporalParser();
      const temporal = parser.parse('last week', now);

      expect(temporal).toBeTruthy();
      expect(temporal!.windowDays).toBe(7);

      // Calculate boosts for each observation
      const boosts = storedObs.map(obs => ({
        title: obs.title,
        boost: temporal!.calculateBoost(obs.epoch),
      }));

      // 1-day-old should get highest boost (within 7-day window)
      // 7-day-old should get near-zero boost (at edge of window)
      // 30-day-old should get zero boost (outside window)
      expect(boosts[0].boost).toBeGreaterThan(boosts[1].boost);
      expect(boosts[0].boost).toBeGreaterThan(0);
      expect(boosts[2].boost).toBe(0); // outside 7-day window
    });

    test('parses Chinese temporal expressions', () => {
      const parser = new TemporalParser();
      const now = new Date();

      const result = parser.parse('上周的工作', now);
      expect(result).toBeTruthy();
      expect(result!.windowDays).toBe(7);

      const yesterday = parser.parse('昨天做了什么', now);
      expect(yesterday).toBeTruthy();
      expect(yesterday!.windowDays).toBe(1);
    });

    test('returns null for non-temporal queries', () => {
      const parser = new TemporalParser();
      const result = parser.parse('how does the search pipeline work');
      expect(result).toBeNull();
    });
  });

  // ─── Test 5: Deduplication + Privacy ───────────────────────────────────────

  describe('Test 5: Deduplication + Privacy', () => {
    let db: Database;

    beforeEach(() => { db = createTestDb(); });
    afterEach(() => { db.close(); });

    test('detects duplicate observations via Jaccard similarity', () => {
      const project = 'dedup-proj';
      seedSession(db, 'ses-dedup-1', project);

      const sharedNarrative = 'Fixed a critical bug in the authentication module that caused session timeouts';

      // Store an initial observation with the target file in files_modified
      const obs1 = makeObservation({
        narrative: sharedNarrative,
        files_modified: ['/src/auth.ts'],
      });
      storeObservation(db, 'ses-dedup-1', project, obs1, 1, 0, Date.now());

      // Check a near-duplicate: same file, same session, nearly identical narrative
      const dedupService = new DeduplicationService(db);
      const result = dedupService.checkPostToolUse(
        'ses-dedup-1',
        '/src/auth.ts',
        'Write',
        sharedNarrative
      );

      // Should detect as duplicate (similarity = 1.0 for identical narrative)
      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe('merge');
      expect(result.similarity).toBeGreaterThan(0.9);
    });

    test('does NOT flag dissimilar observations as duplicates', () => {
      const project = 'dedup-proj-2';
      seedSession(db, 'ses-dedup-2', project);

      const obs1 = makeObservation({
        narrative: 'Implemented new search functionality with vector embeddings',
        files_modified: ['/src/search.ts'],
      });
      storeObservation(db, 'ses-dedup-2', project, obs1, 1, 0, Date.now());

      const dedupService = new DeduplicationService(db);
      const result = dedupService.checkPostToolUse(
        'ses-dedup-2',
        '/src/search.ts',
        'Write',
        'Refactored the database connection pooling logic for better performance'
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    test('PrivacyGuard filters out <private> tagged observations', () => {
      const guard = new PrivacyGuard();

      const observations = [
        { id: 1, narrative: 'Normal observation about code changes', title: 'Code Update' },
        { id: 2, narrative: 'Contains <private>API key: abc123</private> secret data', title: 'Config Change' },
        { id: 3, narrative: 'Another normal observation', title: 'Feature Work' },
        { id: 4, title: '<private>Personal note</private>', narrative: 'Some narrative' },
        { id: 5, narrative: 'Clean observation', facts: JSON.stringify(['<private>secret fact</private>', 'public fact']) },
      ];

      const filtered = guard.filterForCompilation(observations);

      // Only observations 1 and 3 should pass
      expect(filtered.length).toBe(2);
      expect(filtered.map((o: any) => o.id)).toEqual([1, 3]);
    });

    test('PrivacyGuard allows observations without private tags', () => {
      const guard = new PrivacyGuard();

      const observations = [
        { id: 1, narrative: 'Public data', title: 'Public Title', facts: '["public-fact"]' },
        { id: 2, narrative: 'More public data', title: 'Another Title' },
      ];

      const filtered = guard.filterForCompilation(observations);
      expect(filtered.length).toBe(2);
    });
  });

  // ─── Test 6: Knowledge graph entities + facts ──────────────────────────────

  describe('Test 6: Knowledge graph entities + facts', () => {
    let db: Database;
    let kg: KnowledgeGraphService;

    beforeEach(() => {
      db = createTestDb();
      kg = new KnowledgeGraphService(db);
    });

    afterEach(() => { db.close(); });

    test('creates entities and facts, queries by temporal validity', () => {
      // Create entities
      const projectId = kg.resolveEntityId('test-proj', 'service', 'Auth Service');
      const dbId = kg.resolveEntityId('test-proj', 'service', 'Database Service');
      const teamId = kg.resolveEntityId('test-proj', 'team', 'Backend Team');

      kg.upsertEntity(projectId, 'Auth Service', 'service', { language: 'TypeScript' });
      kg.upsertEntity(dbId, 'Database Service', 'service', { language: 'TypeScript' });
      kg.upsertEntity(teamId, 'Backend Team', 'team', { size: 5 });

      // Verify entities exist
      const authEntity = kg.getEntity(projectId);
      expect(authEntity).toBeTruthy();
      expect(authEntity!.name).toBe('Auth Service');
      expect(authEntity!.type).toBe('service');

      // Add facts with temporal bounds
      const now = new Date();
      const pastDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const futureDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();

      kg.addFact('f1', projectId, 'depends_on', dbId, 1.0);
      kg.addFact('f2', projectId, 'maintained_by', teamId, 0.9);

      // Add a temporally-bounded fact
      db.prepare(`UPDATE facts SET valid_from = ?, valid_to = ? WHERE id = ?`)
        .run(pastDate, futureDate, 'f1');

      // Add an expired fact
      const expiredDate = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString();
      kg.addFact('f3', projectId, 'uses', dbId, 0.5);
      db.prepare(`UPDATE facts SET valid_from = ?, valid_to = ? WHERE id = ?`)
        .run(expiredDate, pastDate, 'f3');

      // Query facts valid at current date
      const validFacts = kg.getFactsValidAt(projectId, now);

      // f1 should be valid (within valid_from..valid_to)
      // f2 should be valid (no temporal bounds — always valid)
      // f3 should be EXCLUDED (expired — valid_to is in the past)
      const factIds = validFacts.map(f => f.id);
      expect(factIds).toContain('f1');
      expect(factIds).toContain('f2');
      expect(factIds).not.toContain('f3');
    });

    test('entity resolution produces deterministic IDs', () => {
      const id1 = kg.resolveEntityId('proj', 'service', 'Auth Service');
      const id2 = kg.resolveEntityId('proj', 'service', 'Auth Service');
      const id3 = kg.resolveEntityId('proj', 'service', '  Auth  Service  ');

      expect(id1).toBe(id2);
      expect(id1).toBe(id3); // whitespace is collapsed

      // Global entity
      const globalId = kg.resolveEntityId('proj', 'service', 'Auth Service', true);
      expect(globalId).toMatch(/^_global:service:/);
      expect(globalId).not.toBe(id1);
    });

    test('retrieves facts by predicate', () => {
      const e1 = kg.resolveEntityId('proj', 'module', 'ModuleA');
      const e2 = kg.resolveEntityId('proj', 'module', 'ModuleB');
      const e3 = kg.resolveEntityId('proj', 'module', 'ModuleC');

      kg.upsertEntity(e1, 'ModuleA', 'module');
      kg.upsertEntity(e2, 'ModuleB', 'module');
      kg.upsertEntity(e3, 'ModuleC', 'module');

      kg.addFact('dep-1', e1, 'depends_on', e2);
      kg.addFact('dep-2', e1, 'depends_on', e3);
      kg.addFact('owns-1', e2, 'owns', e3);

      const depFacts = kg.getFactsByPredicate('depends_on');
      expect(depFacts.length).toBe(2);

      const ownsFacts = kg.getFactsByPredicate('owns');
      expect(ownsFacts.length).toBe(1);
    });
  });

  // ─── Test 7: Dashboard data accuracy ───────────────────────────────────────

  describe('Test 7: Dashboard data accuracy', () => {
    let db: Database;

    beforeEach(() => { db = createTestDb(); });
    afterEach(() => { db.close(); });

    test('reports accurate metrics for diverse observations', () => {
      const project = 'dash-proj';
      seedSession(db, 'ses-dash-1', project);

      const now = Date.now();
      const MS_PER_DAY = 24 * 60 * 60 * 1000;

      // Seed diverse observations with different types and ages
      const obsConfigs = [
        // Hot (< 7 days)
        { type: 'decision', concepts: ['auth', 'security'], age: 1 },
        { type: 'discovery', concepts: ['auth', 'performance'], age: 2 },
        { type: 'bugfix', concepts: ['search'], age: 3 },
        { type: 'feature', concepts: ['search', 'ui'], age: 5 },
        // Warm (7-30 days)
        { type: 'decision', concepts: ['database'], age: 10 },
        { type: 'discovery', concepts: ['database', 'auth'], age: 15 },
        { type: 'change', concepts: ['deployment'], age: 20 },
        // Cold (30-90 days)
        { type: 'refactor', concepts: ['search'], age: 45 },
        { type: 'bugfix', concepts: ['auth'], age: 60 },
        // Archive (> 90 days)
        { type: 'discovery', concepts: ['legacy'], age: 120 },
        { type: 'feature', concepts: ['legacy', 'migration'], age: 200 },
      ];

      for (let i = 0; i < obsConfigs.length; i++) {
        const cfg = obsConfigs[i];
        const epoch = now - cfg.age * MS_PER_DAY;
        const obs = makeObservation({
          type: cfg.type,
          title: `Obs ${i}`,
          narrative: `Narrative ${i}`,
          concepts: cfg.concepts,
        });
        storeObservation(db, 'ses-dash-1', project, obs, i + 1, 0, epoch);
      }

      // Also seed some knowledge graph data
      const kg = new KnowledgeGraphService(db);
      const entityId = kg.resolveEntityId(project, 'service', 'AuthService');
      kg.upsertEntity(entityId, 'AuthService', 'service');
      kg.addFact('f1', entityId, 'uses', entityId);

      // Add diary entries
      db.prepare(
        `INSERT INTO agent_diary (memory_session_id, project, entry, created_at) VALUES (?, ?, ?, ?)`
      ).run('ses-dash-1', project, 'Test diary entry', new Date().toISOString());

      // Get dashboard
      const dashboard = new DashboardService(db);
      const data = dashboard.getDashboard(project);

      // Total observations
      expect(data.totalObservations).toBe(11);

      // This week (< 7 days)
      expect(data.thisWeekNew).toBe(4);

      // By type
      expect(data.byType['decision']).toBe(2);
      expect(data.byType['discovery']).toBe(3);
      expect(data.byType['bugfix']).toBe(2);
      expect(data.byType['feature']).toBe(2);
      expect(data.byType['change']).toBe(1);
      expect(data.byType['refactor']).toBe(1);

      // Top concepts — 'auth' appears in 4 observations
      expect(data.topConcepts.length).toBeGreaterThan(0);
      const authConcept = data.topConcepts.find(c => c.concept === 'auth');
      expect(authConcept).toBeTruthy();
      expect(authConcept!.count).toBe(4);

      // Freshness distribution
      expect(data.freshness.hot).toBe(4);    // 1, 2, 3, 5 days old
      expect(data.freshness.warm).toBe(3);   // 10, 15, 20 days old
      expect(data.freshness.cold).toBe(2);   // 45, 60 days old
      expect(data.freshness.archive).toBe(2); // 120, 200 days old

      // Entity count (project-scoped entities start with "dash-proj:")
      expect(data.totalEntities).toBe(1);

      // Facts count
      expect(data.totalFacts).toBe(1);

      // Diary entries
      expect(data.diaryEntries).toBe(1);
    });

    test('returns zeros for empty project', () => {
      const dashboard = new DashboardService(db);
      const data = dashboard.getDashboard('nonexistent-project');

      expect(data.totalObservations).toBe(0);
      expect(data.thisWeekNew).toBe(0);
      expect(Object.keys(data.byType).length).toBe(0);
      expect(data.topConcepts.length).toBe(0);
      expect(data.freshness.hot).toBe(0);
      expect(data.freshness.warm).toBe(0);
      expect(data.freshness.cold).toBe(0);
      expect(data.freshness.archive).toBe(0);
    });
  });

  // ─── Test 8: Markdown export roundtrip ─────────────────────────────────────

  describe('Test 8: Markdown export roundtrip', () => {
    let db: Database;
    let tmpDir: string;

    beforeEach(() => {
      db = createTestDb();
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-recall-export-'));
    });

    afterEach(() => {
      db.close();
      // Clean up temp directory
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    test('exports profiles, knowledge, and diary as markdown files', () => {
      const project = 'export-proj';

      // Seed agent profiles (requires created_at and created_at_epoch)
      const nowIso = new Date().toISOString();
      const nowEpoch = Date.now();

      db.prepare(`
        INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(project, 'user', JSON.stringify({
        name: 'Test User',
        role: 'Developer',
        preferences: ['TypeScript', 'Bun'],
      }), nowIso, nowEpoch, nowIso);

      db.prepare(`
        INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(project, 'style', JSON.stringify({
        tone: 'concise',
        language: 'en',
      }), nowIso, nowEpoch, nowIso);

      // Seed compiled knowledge
      db.prepare(`
        INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, confidence, compiled_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(project, 'Authentication', 'Auth module uses JWT tokens with refresh flow.', '[1,2,3]', 'high', new Date().toISOString());

      db.prepare(`
        INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, confidence, compiled_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(project, 'Database Design', 'SQLite with WAL mode for concurrent reads.', '[4,5]', 'medium', new Date().toISOString());

      // Seed diary entries
      const today = new Date().toISOString();
      db.prepare(`
        INSERT INTO agent_diary (memory_session_id, project, entry, created_at)
        VALUES (?, ?, ?, ?)
      `).run('ses-1', project, 'Started working on the auth module refactor.', today);

      db.prepare(`
        INSERT INTO agent_diary (memory_session_id, project, entry, created_at)
        VALUES (?, ?, ?, ?)
      `).run('ses-1', project, 'Completed JWT refresh token implementation.', today);

      // Export
      const exporter = new MarkdownExporter(db, tmpDir);
      const fileCount = exporter.exportAll(project);

      // Verify file count: 2 profiles + 2 knowledge + 1 index + 1 diary date file = 6
      expect(fileCount).toBe(6);

      // Verify profile files
      const profileDir = path.join(tmpDir, 'profile');
      expect(fs.existsSync(path.join(profileDir, 'user.md'))).toBe(true);
      expect(fs.existsSync(path.join(profileDir, 'style.md'))).toBe(true);

      const userContent = fs.readFileSync(path.join(profileDir, 'user.md'), 'utf8');
      expect(userContent).toContain('User Profile');
      expect(userContent).toContain('Test User');
      expect(userContent).toContain('Developer');

      // Verify knowledge files
      const knowledgeDir = path.join(tmpDir, 'knowledge');
      expect(fs.existsSync(path.join(knowledgeDir, 'index.md'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, 'authentication.md'))).toBe(true);
      expect(fs.existsSync(path.join(knowledgeDir, 'database-design.md'))).toBe(true);

      const authContent = fs.readFileSync(path.join(knowledgeDir, 'authentication.md'), 'utf8');
      expect(authContent).toContain('Authentication');
      expect(authContent).toContain('JWT tokens');

      const indexContent = fs.readFileSync(path.join(knowledgeDir, 'index.md'), 'utf8');
      expect(indexContent).toContain('Knowledge Index');
      expect(indexContent).toContain('Authentication');
      expect(indexContent).toContain('Database Design');

      // Verify diary files
      const diaryDir = path.join(tmpDir, 'diary');
      const diaryFiles = fs.readdirSync(diaryDir);
      expect(diaryFiles.length).toBe(1); // Both entries on same date

      const diaryContent = fs.readFileSync(path.join(diaryDir, diaryFiles[0]), 'utf8');
      expect(diaryContent).toContain('auth module refactor');
      expect(diaryContent).toContain('JWT refresh token');
    });

    test('exports zero files for empty project', () => {
      const exporter = new MarkdownExporter(db, tmpDir);
      const fileCount = exporter.exportAll('nonexistent-project');
      expect(fileCount).toBe(0);
    });
  });
});
