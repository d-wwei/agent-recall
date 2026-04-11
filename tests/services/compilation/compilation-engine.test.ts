/**
 * Tests for CompilationEngine — full 4-stage pipeline integration tests.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with all required tables
 * - Uses real LockManager (in-memory, no side effects)
 * - Uses real PrivacyGuard (pure logic, no I/O)
 * - GateKeeper time-travel via TestableGateKeeper subclass
 *
 * Value: Verifies the Orient -> Gather -> Consolidate -> Prune pipeline
 *        produces correct compiled_knowledge entries from raw observations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { CompilationEngine } from '../../../src/services/compilation/CompilationEngine.js';
import { GateKeeper } from '../../../src/services/compilation/GateKeeper.js';
import { LockManager } from '../../../src/services/concurrency/LockManager.js';
import { OrientStage } from '../../../src/services/compilation/stages/OrientStage.js';
import { GatherStage } from '../../../src/services/compilation/stages/GatherStage.js';
import { ConsolidateStage } from '../../../src/services/compilation/stages/ConsolidateStage.js';
import { PruneStage } from '../../../src/services/compilation/stages/PruneStage.js';
import type { CompilationContext, TopicGroup, ObservationRow } from '../../../src/services/compilation/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT = 'test-project';
const FAR_PAST = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago

/**
 * Create an in-memory SQLite DB with all the tables needed for the
 * compilation pipeline: schema_versions, sdk_sessions, observations,
 * compiled_knowledge.
 */
function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE schema_versions (
      id INTEGER PRIMARY KEY,
      version INTEGER UNIQUE NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      memory_session_id TEXT UNIQUE,
      project TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT '',
      started_at_epoch INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      text TEXT,
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
      confidence TEXT DEFAULT 'medium',
      tags TEXT DEFAULT '[]',
      has_preference INTEGER DEFAULT 0,
      event_date TEXT,
      last_referenced_at TEXT,
      valid_until TEXT,
      superseded_by INTEGER,
      related_observations TEXT DEFAULT '[]',
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );

    CREATE TABLE compiled_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      source_observation_ids TEXT DEFAULT '[]',
      confidence TEXT DEFAULT 'high',
      protected INTEGER DEFAULT 0,
      privacy_scope TEXT DEFAULT 'global',
      version INTEGER DEFAULT 1,
      compiled_at TEXT,
      valid_until TEXT,
      superseded_by INTEGER,
      evidence_timeline TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_ck_project ON compiled_knowledge(project);
    CREATE INDEX idx_ck_topic ON compiled_knowledge(project, topic);
  `);

  return db;
}

/** Insert N sessions for the given project (needed for GateKeeper session gate). */
function insertSessions(
  db: Database,
  project: string,
  count: number,
  epochMs: number = Date.now()
): void {
  const stmt = db.prepare(
    `INSERT INTO sdk_sessions (content_session_id, project, started_at_epoch)
     VALUES (?, ?, ?)`
  );
  for (let i = 0; i < count; i++) {
    stmt.run(`sess-${i}-${Date.now()}-${Math.random()}`, project, epochMs);
  }
}

/** Insert an observation with explicit fields. */
function insertObservation(
  db: Database,
  opts: {
    project?: string;
    type?: string;
    title?: string;
    subtitle?: string | null;
    narrative?: string | null;
    facts?: string[];
    concepts?: string[];
    createdAtEpoch?: number;
    sessionId?: string;
  }
): number {
  const {
    project: proj = PROJECT,
    type = 'discovery',
    title = 'Test observation',
    subtitle = null,
    narrative = null,
    facts = [],
    concepts = [],
    createdAtEpoch = Date.now(),
    sessionId = 'mem-sess-1',
  } = opts;

  const result = db.prepare(
    `INSERT INTO observations
     (memory_session_id, project, type, title, subtitle, narrative, facts, concepts,
      created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sessionId, proj, type, title, subtitle, narrative,
    JSON.stringify(facts), JSON.stringify(concepts),
    new Date(createdAtEpoch).toISOString(), createdAtEpoch
  );

  return Number(result.lastInsertRowid);
}

/**
 * Subclass that exposes GateKeeper timestamps for time-travel in tests.
 */
class TestableGateKeeper extends GateKeeper {
  setLastCompilationTime(ms: number): void {
    (this as unknown as { lastCompilationTime: number }).lastCompilationTime = ms;
  }
  setLastScanTime(ms: number): void {
    (this as unknown as { lastScanTime: number }).lastScanTime = ms;
  }
}

/**
 * Create an engine with GateKeeper bypassed (all gates pass).
 * The engine's GateKeeper is replaced with a testable version with
 * timestamps set far in the past, and enough sessions are inserted.
 */
function createTestEngine(db: Database): CompilationEngine {
  const lockManager = new LockManager();
  const engine = new CompilationEngine(db, lockManager, {});

  // Access internal gatekeeper and time-travel it
  const gk = engine._gateKeeper as TestableGateKeeper;
  Object.setPrototypeOf(gk, TestableGateKeeper.prototype);
  gk.setLastCompilationTime(FAR_PAST);
  gk.setLastScanTime(FAR_PAST);

  // Insert enough sessions to pass session gate
  insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

  return engine;
}

// ─── Stage Unit Tests ─────────────────────────────────────────────────────────

describe('OrientStage', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns empty map for project with no compiled knowledge', () => {
    const stage = new OrientStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });
    expect(result.size).toBe(0);
  });

  it('returns existing active entries keyed by topic', () => {
    db.prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, compiled_at)
       VALUES (?, ?, ?, ?)`
    ).run(PROJECT, 'auth', 'Auth knowledge', new Date().toISOString());

    db.prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, compiled_at)
       VALUES (?, ?, ?, ?)`
    ).run(PROJECT, 'api', 'API knowledge', new Date().toISOString());

    const stage = new OrientStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result.size).toBe(2);
    expect(result.has('auth')).toBe(true);
    expect(result.has('api')).toBe(true);
    expect(result.get('auth')!.content).toBe('Auth knowledge');
  });

  it('excludes entries with valid_until set (expired)', () => {
    db.prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, compiled_at, valid_until)
       VALUES (?, ?, ?, ?, ?)`
    ).run(PROJECT, 'expired-topic', 'Old knowledge', new Date().toISOString(), new Date().toISOString());

    const stage = new OrientStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result.size).toBe(0);
  });

  it('handles missing compiled_knowledge table gracefully', () => {
    const emptyDb = new Database(':memory:');
    const stage = new OrientStage();
    const result = stage.execute({ project: PROJECT, db: emptyDb, lastCompilationEpoch: 0 });

    expect(result.size).toBe(0);
    emptyDb.close();
  });
});

describe('GatherStage', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns empty array for project with no observations', () => {
    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });
    expect(result).toHaveLength(0);
  });

  it('groups observations by first concept', () => {
    insertObservation(db, { concepts: ['auth', 'security'], title: 'Auth obs 1' });
    insertObservation(db, { concepts: ['auth'], title: 'Auth obs 2' });
    insertObservation(db, { concepts: ['api'], title: 'API obs' });

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result).toHaveLength(2);
    const authGroup = result.find(g => g.topic === 'auth');
    const apiGroup = result.find(g => g.topic === 'api');
    expect(authGroup!.observations).toHaveLength(2);
    expect(apiGroup!.observations).toHaveLength(1);
  });

  it('uses "general" topic for observations without concepts', () => {
    insertObservation(db, { concepts: [], title: 'No concept obs' });

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].topic).toBe('general');
  });

  it('filters private observations', () => {
    insertObservation(db, { concepts: ['auth'], title: 'Public obs' });
    insertObservation(db, { concepts: ['auth'], narrative: 'Contains <private> data' });

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(1);
    expect(result[0].observations[0].title).toBe('Public obs');
  });

  it('only includes observations after lastCompilationEpoch', () => {
    const cutoff = Date.now() - 1000;
    insertObservation(db, { concepts: ['auth'], title: 'Old', createdAtEpoch: cutoff - 500 });
    insertObservation(db, { concepts: ['auth'], title: 'New', createdAtEpoch: cutoff + 500 });

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: cutoff });

    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(1);
    expect(result[0].observations[0].title).toBe('New');
  });

  it('only includes observations for the specified project', () => {
    insertObservation(db, { project: PROJECT, concepts: ['auth'], title: 'Our project' });
    insertObservation(db, { project: 'other-project', concepts: ['auth'], title: 'Other project' });

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(1);
    expect(result[0].observations[0].title).toBe('Our project');
  });

  it('skips observations already compiled into knowledge pages (incremental cache)', () => {
    const id1 = insertObservation(db, { concepts: ['auth'], title: 'Already compiled' });
    const id2 = insertObservation(db, { concepts: ['auth'], title: 'New observation' });

    // Simulate id1 already compiled into a knowledge page
    db.prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, compiled_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(PROJECT, 'auth', 'Old content', JSON.stringify([id1]), new Date().toISOString());

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(1);
    expect(result[0].observations[0].title).toBe('New observation');
  });

  it('includes all observations when no compiled_knowledge exists', () => {
    insertObservation(db, { concepts: ['auth'], title: 'Obs 1' });
    insertObservation(db, { concepts: ['auth'], title: 'Obs 2' });

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(2);
  });

  it('does not skip observations from expired knowledge pages (valid_until set)', () => {
    const id1 = insertObservation(db, { concepts: ['auth'], title: 'In expired page' });

    // Simulate id1 in an expired knowledge page
    db.prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, compiled_at, valid_until)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(PROJECT, 'auth', 'Expired', JSON.stringify([id1]), new Date().toISOString(), new Date().toISOString());

    const stage = new GatherStage();
    const result = stage.execute({ project: PROJECT, db, lastCompilationEpoch: 0 });

    // Should NOT be filtered — the page expired so the observation needs recompilation
    expect(result).toHaveLength(1);
    expect(result[0].observations).toHaveLength(1);
    expect(result[0].observations[0].title).toBe('In expired page');
  });
});

describe('ConsolidateStage', () => {
  it('creates new pages from observation groups with structured sections', async () => {
    const groups: TopicGroup[] = [{
      topic: 'auth',
      observations: [
        { id: 1, type: 'discovery', title: 'Found auth pattern', subtitle: null, narrative: 'Uses JWT', facts: '["JWT-based auth"]', concepts: '["auth"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const ctx: CompilationContext = { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 };
    const pages = await stage.execute(groups, new Map(), ctx);

    expect(pages).toHaveLength(1);
    expect(pages[0].topic).toBe('auth');
    expect(pages[0].content).toContain('## auth');
    expect(pages[0].content).toContain('### Facts');
    expect(pages[0].content).toContain('Found auth pattern');
    expect(pages[0].content).toContain('JWT-based auth');
    expect(pages[0].sourceObservationIds).toEqual([1]);
    expect(pages[0].classification).toBe('fact');
  });

  it('merges existing structured content when knowledge page exists', async () => {
    const existingKnowledge = new Map([
      ['auth', {
        id: 1, project: PROJECT, topic: 'auth',
        content: '## auth\n\n### Facts\n- Existing auth fact\n\n### Status\n- Auth enabled',
        source_observation_ids: '[10]', confidence: 'high', protected: 0,
        privacy_scope: 'global', version: 1, compiled_at: null,
        valid_until: null, superseded_by: null, created_at: '',
      }],
    ]);

    const groups: TopicGroup[] = [{
      topic: 'auth',
      observations: [
        { id: 20, type: 'discovery', title: 'New auth finding', subtitle: null, narrative: null, facts: '[]', concepts: '["auth"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const ctx: CompilationContext = { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 };
    const pages = await stage.execute(groups, existingKnowledge, ctx);

    expect(pages).toHaveLength(1);
    expect(pages[0].content).toContain('Existing auth fact');
    expect(pages[0].content).toContain('Auth enabled');
    expect(pages[0].content).toContain('New auth finding');
    expect(pages[0].sourceObservationIds).toContain(10);
    expect(pages[0].sourceObservationIds).toContain(20);
  });

  it('classifies decision/change as status and puts them in Status section', async () => {
    const groups: TopicGroup[] = [{
      topic: 'arch',
      observations: [
        { id: 1, type: 'decision', title: 'Decided on microservices', subtitle: null, narrative: null, facts: '[]', concepts: '["arch"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 });

    expect(pages[0].classification).toBe('status');
    expect(pages[0].content).toContain('### Status');
    expect(pages[0].content).toContain('Decided on microservices');
  });

  it('classifies bugfix/refactor as event and puts them in Timeline section', async () => {
    const groups: TopicGroup[] = [{
      topic: 'fixes',
      observations: [
        { id: 1, type: 'bugfix', title: 'Fixed memory leak', subtitle: null, narrative: null, facts: '[]', concepts: '["fixes"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 });

    expect(pages[0].classification).toBe('event');
    expect(pages[0].content).toContain('### Timeline');
    expect(pages[0].content).toContain('[bugfix] Fixed memory leak');
  });

  it('sets confidence=medium when observation types are mixed', async () => {
    const groups: TopicGroup[] = [{
      topic: 'mixed',
      observations: [
        { id: 1, type: 'decision', title: 'Decision', subtitle: null, narrative: null, facts: '[]', concepts: '["mixed"]', project: PROJECT, created_at_epoch: Date.now() },
        { id: 2, type: 'bugfix', title: 'Bugfix', subtitle: null, narrative: null, facts: '[]', concepts: '["mixed"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 });

    expect(pages[0].confidence).toBe('medium');
    // Mixed types should produce both Status and Timeline sections
    expect(pages[0].content).toContain('### Status');
    expect(pages[0].content).toContain('### Timeline');
  });

  it('deduplicates facts across observations in Facts section', async () => {
    const groups: TopicGroup[] = [{
      topic: 'api',
      observations: [
        { id: 1, type: 'discovery', title: 'Obs 1', subtitle: null, narrative: null, facts: '["REST API","Uses auth"]', concepts: '["api"]', project: PROJECT, created_at_epoch: Date.now() },
        { id: 2, type: 'discovery', title: 'Obs 2', subtitle: null, narrative: null, facts: '["REST API","Has rate limiting"]', concepts: '["api"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 });

    expect(pages[0].content).toContain('### Facts');
    const factsSection = pages[0].content.split('### Facts')[1] || '';
    // Should contain: Obs 1, REST API, Uses auth, Obs 2, Has rate limiting (5 unique, REST API deduped)
    expect(factsSection).toContain('REST API');
    expect(factsSection).toContain('Uses auth');
    expect(factsSection).toContain('Has rate limiting');
    // Count unique fact lines — REST API appears once despite being in both observations
    const factLines = factsSection.split('\n').filter(l => l.startsWith('- '));
    const restApiCount = factLines.filter(l => l.includes('REST API')).length;
    expect(restApiCount).toBe(1); // deduplication works
  });

  it('builds evidence_timeline from source observations', async () => {
    const now = Date.now();
    const groups: TopicGroup[] = [{
      topic: 'auth',
      observations: [
        { id: 10, type: 'discovery', title: 'Found JWT', subtitle: null, narrative: 'Uses RS256 algorithm for signing', facts: '[]', concepts: '["auth"]', project: PROJECT, created_at_epoch: now - 5000 },
        { id: 20, type: 'bugfix', title: 'Fixed token refresh', subtitle: null, narrative: null, facts: '[]', concepts: '["auth"]', project: PROJECT, created_at_epoch: now },
      ],
    }];

    const stage = new ConsolidateStage();
    const ctx: CompilationContext = { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 };
    const pages = await stage.execute(groups, new Map(), ctx);

    expect(pages[0].evidenceTimeline).toHaveLength(2);
    expect(pages[0].evidenceTimeline[0].observationId).toBe(10);
    expect(pages[0].evidenceTimeline[0].type).toBe('discovery');
    expect(pages[0].evidenceTimeline[0].title).toBe('Found JWT');
    expect(pages[0].evidenceTimeline[0].summary).toBe('Uses RS256 algorithm for signing');
    expect(pages[0].evidenceTimeline[1].observationId).toBe(20);
    expect(pages[0].evidenceTimeline[1].summary).toBe('');
  });

  it('truncates evidence_timeline summary to 100 chars', async () => {
    const longNarrative = 'A'.repeat(200);
    const groups: TopicGroup[] = [{
      topic: 'test',
      observations: [
        { id: 1, type: 'discovery', title: 'Test', subtitle: null, narrative: longNarrative, facts: '[]', concepts: '["test"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 });
    expect(pages[0].evidenceTimeline[0].summary.length).toBe(100);
  });

  it('produces all three sections when observations span types', async () => {
    const groups: TopicGroup[] = [{
      topic: 'project',
      observations: [
        { id: 1, type: 'change', title: 'Switched to Bun', subtitle: null, narrative: null, facts: '[]', concepts: '["project"]', project: PROJECT, created_at_epoch: Date.now() },
        { id: 2, type: 'discovery', title: 'Found perf issue', subtitle: null, narrative: null, facts: '["Memory usage high"]', concepts: '["project"]', project: PROJECT, created_at_epoch: Date.now() },
        { id: 3, type: 'bugfix', title: 'Fixed OOM crash', subtitle: null, narrative: null, facts: '[]', concepts: '["project"]', project: PROJECT, created_at_epoch: Date.now() },
      ],
    }];

    const stage = new ConsolidateStage();
    const pages = await stage.execute(groups, new Map(), { project: PROJECT, db: null as unknown as Database, lastCompilationEpoch: 0 });

    expect(pages[0].content).toContain('### Status');
    expect(pages[0].content).toContain('### Facts');
    expect(pages[0].content).toContain('### Timeline');
    expect(pages[0].content).toContain('Switched to Bun');
    expect(pages[0].content).toContain('Found perf issue');
    expect(pages[0].content).toContain('Memory usage high');
    expect(pages[0].content).toContain('[bugfix] Fixed OOM crash');
  });
});

describe('PruneStage', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('inserts new compiled_knowledge for new topics', () => {
    const stage = new PruneStage();
    const ctx: CompilationContext = { project: PROJECT, db, lastCompilationEpoch: 0 };

    const result = stage.execute(
      [{ topic: 'auth', content: '## auth\nContent', sourceObservationIds: [1, 2], confidence: 'high', classification: 'fact' }],
      new Map(),
      ctx
    );

    expect(result.pagesCreated).toBe(1);
    expect(result.pagesUpdated).toBe(0);

    const rows = db.prepare('SELECT * FROM compiled_knowledge WHERE project = ?').all(PROJECT) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].topic).toBe('auth');
    expect(rows[0].content).toBe('## auth\nContent');
    expect(JSON.parse(rows[0].source_observation_ids)).toEqual([1, 2]);
  });

  it('updates existing compiled_knowledge and increments version', () => {
    // Insert existing entry with version 1
    db.prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, version, compiled_at)
       VALUES (?, ?, ?, 1, ?)`
    ).run(PROJECT, 'auth', 'Old content', new Date().toISOString());

    const existing = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;

    const existingMap = new Map([['auth', existing]]);

    const stage = new PruneStage();
    const ctx: CompilationContext = { project: PROJECT, db, lastCompilationEpoch: 0 };

    const result = stage.execute(
      [{ topic: 'auth', content: '## auth\nNew content', sourceObservationIds: [3], confidence: 'high', classification: 'fact' }],
      existingMap,
      ctx
    );

    expect(result.pagesUpdated).toBe(1);
    expect(result.pagesCreated).toBe(0);

    const updated = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;

    expect(updated.version).toBe(2);
    expect(updated.content).toBe('## auth\nNew content');
  });

  it('updates last_referenced_at on source observations', () => {
    const obsId = insertObservation(db, { concepts: ['auth'], title: 'Test obs' });

    const stage = new PruneStage();
    const ctx: CompilationContext = { project: PROJECT, db, lastCompilationEpoch: 0 };

    stage.execute(
      [{ topic: 'auth', content: 'Content', sourceObservationIds: [obsId], confidence: 'high', classification: 'fact' }],
      new Map(),
      ctx
    );

    const obs = db.prepare('SELECT last_referenced_at FROM observations WHERE id = ?').get(obsId) as any;
    expect(obs.last_referenced_at).toBeTruthy();
  });

  it('marks older observations as superseded for status pages', () => {
    const id1 = insertObservation(db, { type: 'decision', concepts: ['arch'], title: 'Old decision' });
    const id2 = insertObservation(db, { type: 'decision', concepts: ['arch'], title: 'New decision' });

    const stage = new PruneStage();
    const ctx: CompilationContext = { project: PROJECT, db, lastCompilationEpoch: 0 };

    stage.execute(
      [{ topic: 'arch', content: 'Content', sourceObservationIds: [id1, id2], confidence: 'high', classification: 'status' }],
      new Map(),
      ctx
    );

    const older = db.prepare('SELECT superseded_by FROM observations WHERE id = ?').get(id1) as any;
    const newer = db.prepare('SELECT superseded_by FROM observations WHERE id = ?').get(id2) as any;

    expect(older.superseded_by).toBe(id2);
    expect(newer.superseded_by).toBeNull();
  });

  it('returns correct observationsProcessed count', () => {
    const stage = new PruneStage();
    const ctx: CompilationContext = { project: PROJECT, db, lastCompilationEpoch: 0 };

    const result = stage.execute(
      [
        { topic: 'a', content: 'A', sourceObservationIds: [1, 2], confidence: 'high', classification: 'fact' },
        { topic: 'b', content: 'B', sourceObservationIds: [3], confidence: 'high', classification: 'fact' },
      ],
      new Map(),
      ctx
    );

    expect(result.observationsProcessed).toBe(3);
  });
});

// ─── Full Pipeline Tests ──────────────────────────────────────────────────────

describe('CompilationEngine (full pipeline)', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns null when GateKeeper blocks (too few sessions)', async () => {
    const lockManager = new LockManager();
    const engine = new CompilationEngine(db, lockManager, {});

    // No sessions inserted — session gate will block
    const result = await engine.tryCompile(PROJECT);

    expect(result).toBeNull();
    lockManager.releaseAll();
  });

  it('produces zero pages for empty project', async () => {
    const engine = createTestEngine(db);
    // No observations inserted

    const result = await engine.tryCompile(PROJECT);

    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(0);
    expect(result!.pagesUpdated).toBe(0);
    expect(result!.observationsProcessed).toBe(0);
    expect(result!.errors).toHaveLength(0);
  });

  it('creates pages grouped by topic from observations', async () => {
    const engine = createTestEngine(db);

    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'JWT auth pattern',
      facts: ['Uses RS256'],
    });
    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'OAuth2 integration',
      facts: ['Google provider'],
    });
    insertObservation(db, {
      concepts: ['api'],
      type: 'feature',
      title: 'REST API v2',
      facts: ['OpenAPI 3.0'],
    });

    const result = await engine.tryCompile(PROJECT);

    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(2);
    expect(result!.errors).toHaveLength(0);

    const pages = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? ORDER BY topic'
    ).all(PROJECT) as any[];

    expect(pages).toHaveLength(2);

    const apiPage = pages.find((p: any) => p.topic === 'api');
    const authPage = pages.find((p: any) => p.topic === 'auth');

    expect(apiPage).toBeTruthy();
    expect(authPage).toBeTruthy();
    expect(authPage.content).toContain('JWT auth pattern');
    expect(authPage.content).toContain('OAuth2 integration');
    expect(apiPage.content).toContain('REST API v2');
  });

  it('updates pages on second compilation (version incremented)', async () => {
    const engine = createTestEngine(db);

    // First compilation
    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'First finding',
    });

    const result1 = await engine.tryCompile(PROJECT);
    expect(result1).not.toBeNull();
    expect(result1!.pagesCreated).toBe(1);

    const page1 = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;
    expect(page1.version).toBe(1);

    // Reset gate for second compilation
    const gk = engine._gateKeeper as TestableGateKeeper;
    Object.setPrototypeOf(gk, TestableGateKeeper.prototype);
    gk.setLastCompilationTime(FAR_PAST);
    gk.setLastScanTime(FAR_PAST);

    // Second compilation with new observation
    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'Second finding',
    });

    const result2 = await engine.tryCompile(PROJECT);
    expect(result2).not.toBeNull();
    expect(result2!.pagesUpdated).toBe(1);
    expect(result2!.pagesCreated).toBe(0);

    const page2 = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;
    expect(page2.version).toBe(2);
    expect(page2.content).toContain('Second finding');
  });

  it('filters private observations from compilation', async () => {
    const engine = createTestEngine(db);

    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'Public finding',
    });
    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'Secret finding',
      narrative: 'This is <private> data',
    });

    const result = await engine.tryCompile(PROJECT);

    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(1);

    const page = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;

    expect(page.content).toContain('Public finding');
    expect(page.content).not.toContain('Secret finding');
    expect(page.content).not.toContain('<private>');
  });

  it('returns correct counts in CompilationResult', async () => {
    const engine = createTestEngine(db);

    insertObservation(db, { concepts: ['auth'], type: 'discovery', title: 'Auth 1' });
    insertObservation(db, { concepts: ['auth'], type: 'discovery', title: 'Auth 2' });
    insertObservation(db, { concepts: ['api'], type: 'feature', title: 'API 1' });
    insertObservation(db, { concepts: ['db'], type: 'bugfix', title: 'DB fix' });

    const result = await engine.tryCompile(PROJECT);

    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(3); // auth, api, db
    expect(result!.pagesUpdated).toBe(0);
    expect(result!.observationsProcessed).toBe(4);
    expect(result!.errors).toHaveLength(0);
  });

  it('handles observations without concepts under "general" topic', async () => {
    const engine = createTestEngine(db);

    insertObservation(db, {
      concepts: [],
      type: 'discovery',
      title: 'General observation',
    });

    const result = await engine.tryCompile(PROJECT);

    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(1);

    const page = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'general') as any;

    expect(page).toBeTruthy();
    expect(page.content).toContain('General observation');
  });

  it('persists evidence_timeline in compiled_knowledge', async () => {
    const engine = createTestEngine(db);

    insertObservation(db, {
      concepts: ['auth'],
      type: 'discovery',
      title: 'JWT pattern',
      narrative: 'Uses RS256',
    });
    insertObservation(db, {
      concepts: ['auth'],
      type: 'bugfix',
      title: 'Fixed token refresh',
    });

    const result = await engine.tryCompile(PROJECT);
    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(1);

    const page = db.prepare(
      'SELECT evidence_timeline FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;

    const timeline = JSON.parse(page.evidence_timeline);
    expect(timeline).toHaveLength(2);
    expect(timeline[0].type).toBe('discovery');
    expect(timeline[0].title).toBe('JWT pattern');
    expect(timeline[1].type).toBe('bugfix');
    expect(timeline[1].title).toBe('Fixed token refresh');
  });

  it('does not compile observations from other projects', async () => {
    const engine = createTestEngine(db);

    insertObservation(db, {
      project: PROJECT,
      concepts: ['auth'],
      type: 'discovery',
      title: 'Our observation',
    });
    insertObservation(db, {
      project: 'other-project',
      concepts: ['auth'],
      type: 'discovery',
      title: 'Their observation',
    });

    const result = await engine.tryCompile(PROJECT);

    expect(result).not.toBeNull();
    expect(result!.pagesCreated).toBe(1);

    const page = db.prepare(
      'SELECT * FROM compiled_knowledge WHERE project = ? AND topic = ?'
    ).get(PROJECT, 'auth') as any;

    expect(page.content).toContain('Our observation');
    expect(page.content).not.toContain('Their observation');
  });
});
