/**
 * Tests for CompactionVerifier — pre-compact quality check.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with observations + session_summaries tables
 *
 * Coverage:
 *   - shouldSkipVerification: skip when < 3 observations
 *   - shouldSkipVerification: do not skip when >= 3 observations
 *   - verify: returns isComplete=true for 0 observations
 *   - verify: finds missing topics when summary is empty
 *   - verify: passes for summary that covers all topics
 *   - verify: reports partial coverage correctly
 *   - verify: deduplicates missing topics
 *   - verify: uses 'general' for observations without concepts
 *   - verify: case-insensitive topic matching
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { CompactionVerifier } from '../../../src/services/compaction/CompactionVerifier.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT = 'test-project';
const SESSION = 'mem-session-001';

// ─── DB setup ─────────────────────────────────────────────────────────────────

function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'discovery',
      title TEXT,
      concepts TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '',
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      request TEXT,
      investigated TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}

/** Insert an observation, returning its id */
function insertObservation(
  db: Database,
  opts: {
    sessionId?: string;
    project?: string;
    concepts?: string[];
    title?: string;
  } = {}
): number {
  const {
    sessionId = SESSION,
    project = PROJECT,
    concepts = [],
    title = 'Test obs',
  } = opts;

  const result = db.prepare(
    `INSERT INTO observations (memory_session_id, project, type, title, concepts, created_at_epoch)
     VALUES (?, ?, 'discovery', ?, ?, ?)`
  ).run(sessionId, project, title, JSON.stringify(concepts), Date.now());

  return Number(result.lastInsertRowid);
}

/** Insert a summary for a session */
function insertSummary(
  db: Database,
  opts: {
    sessionId?: string;
    project?: string;
    request?: string;
    learned?: string;
    completed?: string;
    investigated?: string;
    next_steps?: string;
    notes?: string;
  } = {}
): void {
  const {
    sessionId = SESSION,
    project = PROJECT,
    request = '',
    learned = '',
    completed = '',
    investigated = '',
    next_steps = '',
    notes = null,
  } = opts;

  db.prepare(
    `INSERT INTO session_summaries
     (memory_session_id, project, request, investigated, learned, completed, next_steps, notes, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(sessionId, project, request, investigated, learned, completed, next_steps, notes, Date.now());
}

// ─── shouldSkipVerification ───────────────────────────────────────────────────

describe('CompactionVerifier.shouldSkipVerification', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns true when session has 0 observations', () => {
    const verifier = new CompactionVerifier(db);
    expect(verifier.shouldSkipVerification(SESSION)).toBe(true);
  });

  it('returns true when session has 1 observation', () => {
    insertObservation(db);
    const verifier = new CompactionVerifier(db);
    expect(verifier.shouldSkipVerification(SESSION)).toBe(true);
  });

  it('returns true when session has 2 observations', () => {
    insertObservation(db);
    insertObservation(db);
    const verifier = new CompactionVerifier(db);
    expect(verifier.shouldSkipVerification(SESSION)).toBe(true);
  });

  it('returns false when session has exactly 3 observations', () => {
    insertObservation(db);
    insertObservation(db);
    insertObservation(db);
    const verifier = new CompactionVerifier(db);
    expect(verifier.shouldSkipVerification(SESSION)).toBe(false);
  });

  it('returns false when session has more than 3 observations', () => {
    for (let i = 0; i < 5; i++) insertObservation(db);
    const verifier = new CompactionVerifier(db);
    expect(verifier.shouldSkipVerification(SESSION)).toBe(false);
  });

  it('counts only observations for the given session (not other sessions)', () => {
    // Insert 5 observations for a different session
    for (let i = 0; i < 5; i++) {
      insertObservation(db, { sessionId: 'other-session' });
    }
    const verifier = new CompactionVerifier(db);
    // SESSION still has 0 observations
    expect(verifier.shouldSkipVerification(SESSION)).toBe(true);
  });
});

// ─── verify — empty / no summary ─────────────────────────────────────────────

describe('CompactionVerifier.verify — empty cases', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns isComplete=true and zero counts when session has no observations', () => {
    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(true);
    expect(result.missingTopics).toHaveLength(0);
    expect(result.observationsCovered).toBe(0);
    expect(result.observationsTotal).toBe(0);
  });

  it('reports all topics as missing when summary is absent', () => {
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['api'] });
    insertObservation(db, { concepts: ['db'] });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(false);
    expect(result.missingTopics).toContain('auth');
    expect(result.missingTopics).toContain('api');
    expect(result.missingTopics).toContain('db');
    expect(result.observationsTotal).toBe(3);
    expect(result.observationsCovered).toBe(0);
  });

  it('reports all topics as missing when summary fields are all empty', () => {
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['api'] });
    insertObservation(db, { concepts: ['db'] });
    insertSummary(db, { learned: '', completed: '', request: '' });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(false);
    expect(result.missingTopics).toHaveLength(3);
  });
});

// ─── verify — coverage checks ─────────────────────────────────────────────────

describe('CompactionVerifier.verify — coverage', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns isComplete=true when summary covers all topics', () => {
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['api'] });
    insertObservation(db, { concepts: ['database'] });
    insertSummary(db, {
      learned: 'Implemented auth system and api endpoints',
      completed: 'Updated the database schema',
    });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(true);
    expect(result.missingTopics).toHaveLength(0);
    expect(result.observationsCovered).toBe(3);
    expect(result.observationsTotal).toBe(3);
  });

  it('reports partial coverage correctly', () => {
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['api'] });
    insertObservation(db, { concepts: ['cache'] });
    insertSummary(db, {
      learned: 'Implemented auth system',
      completed: 'api is now stable',
    });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(false);
    expect(result.missingTopics).toContain('cache');
    expect(result.missingTopics).not.toContain('auth');
    expect(result.missingTopics).not.toContain('api');
    expect(result.observationsCovered).toBe(2);
    expect(result.observationsTotal).toBe(3);
  });

  it('deduplicates missing topics when multiple observations share a topic', () => {
    // 3 observations for 'auth', none in summary
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['auth'] });
    insertSummary(db, { learned: 'Only about api changes', completed: '' });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    // 'auth' appears once in missingTopics, not three times
    expect(result.missingTopics.filter(t => t === 'auth')).toHaveLength(1);
  });

  it('uses "general" topic for observations without concepts', () => {
    insertObservation(db, { concepts: [] });
    insertObservation(db, { concepts: [] });
    insertObservation(db, { concepts: [] });
    insertSummary(db, { learned: 'general overview done', completed: '' });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(true);
  });

  it('topic matching is case-insensitive', () => {
    insertObservation(db, { concepts: ['Authentication'] });
    insertObservation(db, { concepts: ['API'] });
    insertObservation(db, { concepts: ['Database'] });
    insertSummary(db, {
      learned: 'authentication was fixed, api is stable, database migrated',
    });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(true);
    expect(result.observationsCovered).toBe(3);
  });

  it('searches across all summary fields (not just learned)', () => {
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['ci'] });
    insertObservation(db, { concepts: ['deploy'] });
    insertSummary(db, {
      request: 'Fix auth issues',
      completed: 'ci pipeline updated',
      notes: 'deploy was skipped',
    });

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    expect(result.isComplete).toBe(true);
  });

  it('uses the most recent summary when multiple summaries exist', () => {
    insertObservation(db, { concepts: ['auth'] });
    insertObservation(db, { concepts: ['api'] });
    insertObservation(db, { concepts: ['db'] });

    // Older summary — covers everything
    db.prepare(
      `INSERT INTO session_summaries
       (memory_session_id, project, learned, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, ?)`
    ).run(SESSION, PROJECT, 'auth api db covered', '', Date.now() - 5000);

    // Newer summary — covers nothing
    db.prepare(
      `INSERT INTO session_summaries
       (memory_session_id, project, learned, created_at, created_at_epoch)
       VALUES (?, ?, ?, ?, ?)`
    ).run(SESSION, PROJECT, 'no relevant content', '', Date.now());

    const verifier = new CompactionVerifier(db);
    const result = verifier.verify(PROJECT, SESSION);

    // Newer summary wins — topics should be missing
    expect(result.isComplete).toBe(false);
  });
});
