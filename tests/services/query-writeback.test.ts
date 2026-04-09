/**
 * Tests for QueryWriteback — query result writeback with anti-feedback-loop protections.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite database
 * - Tests full write path and all anti-feedback-loop properties
 *
 * Coverage:
 *  1. write() creates observation with type='synthesis'
 *  2. write() sets valid_until ~90 days in future
 *  3. write() sets confidence='medium'
 *  4. SYNTHESIS_WEIGHT constant is 0.7
 *  5. TTL_DAYS constant is 90
 *  6. content_hash is set and non-empty
 *  7. content_hash is SHA-256 of synthesis text
 *  8. tags include 'synthesis'
 *  9. concepts include 'synthesis'
 * 10. WritebackResult has a numeric observationId
 * 11. WritebackResult has written=true
 * 12. title is truncated to 100 chars from query prefix
 * 13. Multiple writes create distinct observations
 * 14. TYPE_WEIGHTS in FusionRanker includes synthesis at <= 0.7
 * 15. GatherStage excludes synthesis rows from compilation
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import { QueryWriteback } from '../../src/services/worker/search/QueryWriteback.js';
import { FusionRanker } from '../../src/services/worker/search/FusionRanker.js';
import { GatherStage } from '../../src/services/compilation/stages/GatherStage.js';
import type { CompilationContext } from '../../src/services/compilation/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal in-memory SQLite DB with observations table. */
function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
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
      valid_until TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    );
  `);

  return db;
}

/** Read back the observation row by ID. */
function readObs(db: Database, id: number): Record<string, any> {
  return db.prepare('SELECT * FROM observations WHERE id = ?').get(id) as Record<string, any>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('QueryWriteback.write — type and identity', () => {
  let db: Database;
  let wb: QueryWriteback;

  beforeEach(() => {
    db = createTestDb();
    wb = new QueryWriteback(db);
  });

  it('creates an observation with type=synthesis', () => {
    const result = wb.write('my-project', 'search query', 'the answer');
    const row = readObs(db, result.observationId!);
    expect(row.type).toBe('synthesis');
  });

  it('sets project correctly', () => {
    const result = wb.write('test-project', 'q', 'synth');
    const row = readObs(db, result.observationId!);
    expect(row.project).toBe('test-project');
  });

  it('stores synthesis text in narrative', () => {
    const synthesis = 'Detailed synthesis of query results.';
    const result = wb.write('proj', 'q', synthesis);
    const row = readObs(db, result.observationId!);
    expect(row.narrative).toBe(synthesis);
  });

  it('sets title as "Synthesis: <query first 100 chars>"', () => {
    const query = 'how does authentication work';
    const result = wb.write('proj', query, 'synth');
    const row = readObs(db, result.observationId!);
    expect(row.title).toBe(`Synthesis: ${query}`);
  });

  it('truncates query in title to 100 chars', () => {
    const longQuery = 'x'.repeat(150);
    const result = wb.write('proj', longQuery, 'synth');
    const row = readObs(db, result.observationId!);
    expect(row.title).toBe(`Synthesis: ${'x'.repeat(100)}`);
  });
});

describe('QueryWriteback.write — anti-feedback-loop: TTL', () => {
  let db: Database;
  let wb: QueryWriteback;

  beforeEach(() => {
    db = createTestDb();
    wb = new QueryWriteback(db);
  });

  it('sets valid_until approximately 90 days in the future', () => {
    const before = Date.now();
    const result = wb.write('proj', 'q', 'synth');
    const after = Date.now();
    const row = readObs(db, result.observationId!);

    const validUntilMs = new Date(row.valid_until).getTime();
    const expectedLow = before + QueryWriteback.TTL_DAYS * 24 * 60 * 60 * 1000;
    const expectedHigh = after + QueryWriteback.TTL_DAYS * 24 * 60 * 60 * 1000;

    expect(validUntilMs).toBeGreaterThanOrEqual(expectedLow);
    expect(validUntilMs).toBeLessThanOrEqual(expectedHigh);
  });

  it('TTL_DAYS constant is 90', () => {
    expect(QueryWriteback.TTL_DAYS).toBe(90);
  });
});

describe('QueryWriteback.write — anti-feedback-loop: confidence and weight', () => {
  let db: Database;
  let wb: QueryWriteback;

  beforeEach(() => {
    db = createTestDb();
    wb = new QueryWriteback(db);
  });

  it('sets confidence=medium', () => {
    const result = wb.write('proj', 'q', 'synth');
    const row = readObs(db, result.observationId!);
    expect(row.confidence).toBe('medium');
  });

  it('SYNTHESIS_WEIGHT constant is 0.7', () => {
    expect(QueryWriteback.SYNTHESIS_WEIGHT).toBe(0.7);
  });
});

describe('QueryWriteback.write — anti-feedback-loop: content hash', () => {
  let db: Database;
  let wb: QueryWriteback;

  beforeEach(() => {
    db = createTestDb();
    wb = new QueryWriteback(db);
  });

  it('sets a non-empty content_hash', () => {
    const result = wb.write('proj', 'q', 'some synthesis text');
    const row = readObs(db, result.observationId!);
    expect(typeof row.content_hash).toBe('string');
    expect(row.content_hash.length).toBeGreaterThan(0);
  });

  it('content_hash is SHA-256 hex of the synthesis text', () => {
    const synthesis = 'specific synthesis content';
    const result = wb.write('proj', 'q', synthesis);
    const row = readObs(db, result.observationId!);

    const expected = createHash('sha256').update(synthesis).digest('hex');
    expect(row.content_hash).toBe(expected);
  });

  it('different synthesis texts produce different content_hashes', () => {
    const r1 = wb.write('proj', 'q', 'synthesis A');
    const r2 = wb.write('proj', 'q', 'synthesis B');
    const row1 = readObs(db, r1.observationId!);
    const row2 = readObs(db, r2.observationId!);
    expect(row1.content_hash).not.toBe(row2.content_hash);
  });
});

describe('QueryWriteback.write — anti-feedback-loop: tags and concepts', () => {
  let db: Database;
  let wb: QueryWriteback;

  beforeEach(() => {
    db = createTestDb();
    wb = new QueryWriteback(db);
  });

  it('tags include "synthesis"', () => {
    const result = wb.write('proj', 'q', 'synth');
    const row = readObs(db, result.observationId!);
    const tags = JSON.parse(row.tags);
    expect(tags).toContain('synthesis');
  });

  it('concepts include "synthesis"', () => {
    const result = wb.write('proj', 'q', 'synth');
    const row = readObs(db, result.observationId!);
    const concepts = JSON.parse(row.concepts);
    expect(concepts).toContain('synthesis');
  });
});

describe('QueryWriteback.write — WritebackResult shape', () => {
  let db: Database;
  let wb: QueryWriteback;

  beforeEach(() => {
    db = createTestDb();
    wb = new QueryWriteback(db);
  });

  it('WritebackResult.written is true', () => {
    const result = wb.write('proj', 'q', 'synth');
    expect(result.written).toBe(true);
  });

  it('WritebackResult.observationId is a positive number', () => {
    const result = wb.write('proj', 'q', 'synth');
    expect(typeof result.observationId).toBe('number');
    expect(result.observationId).toBeGreaterThan(0);
  });

  it('multiple writes produce distinct observationIds', () => {
    const r1 = wb.write('proj', 'q1', 'synth 1');
    const r2 = wb.write('proj', 'q2', 'synth 2');
    expect(r1.observationId).not.toBe(r2.observationId);
  });
});

// ─── FusionRanker integration ──────────────────────────────────────────────────

describe('FusionRanker — synthesis type weight', () => {
  const ranker = new FusionRanker();

  it('synthesis type receives a weight <= 0.7 (anti-feedback-loop)', () => {
    const now = Date.now();
    const synthCandidate = {
      id: 1,
      chromaScore: 1.0,
      ftsScore: 1.0,
      type: 'synthesis',
      lastReferencedAt: null,
      createdAtEpoch: now - 1000,
    };
    const decisionCandidate = {
      id: 2,
      chromaScore: 1.0,
      ftsScore: 1.0,
      type: 'decision',
      lastReferencedAt: null,
      createdAtEpoch: now - 1000,
    };

    const results = ranker.rank([synthCandidate, decisionCandidate], 'balanced');
    // decision (weight 1.0) should rank above synthesis
    expect(results[0].id).toBe(2);
    expect(results[1].id).toBe(1);
  });

  it('synthesis finalScore is lower than discovery with identical raw scores', () => {
    const now = Date.now();
    const synth = {
      id: 1,
      chromaScore: 0.8,
      ftsScore: 0.8,
      type: 'synthesis',
      lastReferencedAt: null,
      createdAtEpoch: now - 1000,
    };
    const discovery = {
      id: 2,
      chromaScore: 0.8,
      ftsScore: 0.8,
      type: 'discovery',
      lastReferencedAt: null,
      createdAtEpoch: now - 1000,
    };

    const [first, second] = ranker.rank([synth, discovery], 'balanced');
    expect(first.id).toBe(2);  // discovery wins
    expect(second.finalScore).toBeLessThan(first.finalScore);
  });
});

// ─── GatherStage integration ───────────────────────────────────────────────────

describe('GatherStage — excludes synthesis observations', () => {
  function createGatherDb(): Database {
    const db = new Database(':memory:');
    db.exec(`
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
        concepts TEXT DEFAULT '[]',
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        discovery_tokens INTEGER DEFAULT 0,
        content_hash TEXT,
        confidence TEXT DEFAULT 'medium',
        tags TEXT DEFAULT '[]',
        has_preference INTEGER DEFAULT 0,
        valid_until TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL
      );
    `);
    return db;
  }

  it('synthesis observations are NOT included in compilation gather', () => {
    const db = createGatherDb();
    const now = Date.now();

    // Insert a normal observation and a synthesis observation
    db.prepare(`
      INSERT INTO observations (memory_session_id, project, type, title, narrative, concepts, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess-1', 'proj', 'change', 'Normal change', 'Did something', '["feature"]', new Date(now).toISOString(), now);

    db.prepare(`
      INSERT INTO observations (memory_session_id, project, type, title, narrative, concepts, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('sess-2', 'proj', 'synthesis', 'Synthesis: query', 'synthesized content', '["synthesis"]', new Date(now).toISOString(), now);

    const ctx: CompilationContext = {
      db,
      project: 'proj',
      lastCompilationEpoch: now - 1000,
    };

    const stage = new GatherStage();
    const groups = stage.execute(ctx);

    // Flatten all observations from all groups
    const allObs = groups.flatMap(g => g.observations);
    const types = allObs.map(o => o.type);

    expect(types).not.toContain('synthesis');
    expect(types).toContain('change');
  });

  it('only synthesis rows are excluded; other types pass through', () => {
    const db = createGatherDb();
    const now = Date.now();

    const insert = db.prepare(`
      INSERT INTO observations (memory_session_id, project, type, title, narrative, concepts, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run('s1', 'proj', 'decision', 'Decision', 'arch decision', '["arch"]', new Date(now).toISOString(), now);
    insert.run('s2', 'proj', 'bugfix',   'Bug fix',   'fixed bug',     '["bug"]',  new Date(now).toISOString(), now);
    insert.run('s3', 'proj', 'synthesis', 'Synth', 'synth result', '["synthesis"]', new Date(now).toISOString(), now);

    const ctx: CompilationContext = {
      db,
      project: 'proj',
      lastCompilationEpoch: now - 1000,
    };

    const groups = new GatherStage().execute(ctx);
    const allObs = groups.flatMap(g => g.observations);
    const types = allObs.map(o => o.type);

    expect(types).toContain('decision');
    expect(types).toContain('bugfix');
    expect(types).not.toContain('synthesis');
    expect(allObs).toHaveLength(2);
  });
});
