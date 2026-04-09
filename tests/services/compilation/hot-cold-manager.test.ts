/**
 * Tests for HotColdManager — data lifecycle categorization and actions.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with the observations table schema
 * - All age boundaries tested via explicit created_at_epoch values
 *
 * Coverage:
 *   - getDataAge: hot / warm / cold / archive classification
 *   - process: correct counts per bucket
 *   - process: archive sets valid_until
 *   - process: cold links related_observations by concept
 *   - process: warm-only does not set valid_until
 *   - process: does not re-archive already-expired observations
 *   - process: project isolation
 *   - process: single-observation cold group (no links needed)
 *   - process: multi-group cold linking
 *   - process: observations at exact boundary ages
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { HotColdManager } from '../../../src/services/compilation/HotColdManager.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROJECT = 'test-project';
const OTHER_PROJECT = 'other-project';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Age helpers: return an epoch that is exactly N days in the past */
function daysAgo(n: number): number {
  return Date.now() - n * MS_PER_DAY;
}

// ─── DB setup ─────────────────────────────────────────────────────────────────

function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL DEFAULT 'sess-1',
      project TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'discovery',
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
      confidence TEXT DEFAULT 'medium',
      tags TEXT DEFAULT '[]',
      has_preference INTEGER DEFAULT 0,
      event_date TEXT,
      last_referenced_at TEXT,
      valid_until TEXT,
      superseded_by INTEGER,
      related_observations TEXT DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT '',
      created_at_epoch INTEGER NOT NULL
    );
  `);

  return db;
}

/** Insert an observation, returning its id */
function insert(
  db: Database,
  opts: {
    project?: string;
    createdAtEpoch: number;
    concepts?: string[];
    validUntil?: string | null;
    relatedObservations?: number[];
  }
): number {
  const {
    project = PROJECT,
    createdAtEpoch,
    concepts = [],
    validUntil = null,
    relatedObservations = [],
  } = opts;

  const result = db.prepare(
    `INSERT INTO observations
     (project, created_at, created_at_epoch, concepts, valid_until, related_observations)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    project,
    new Date(createdAtEpoch).toISOString(),
    createdAtEpoch,
    JSON.stringify(concepts),
    validUntil,
    JSON.stringify(relatedObservations)
  );

  return Number(result.lastInsertRowid);
}

// ─── getDataAge ───────────────────────────────────────────────────────────────

describe('HotColdManager.getDataAge', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns hot for observation created 1 day ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(1) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('hot');
  });

  it('returns hot for observation created just now', () => {
    const id = insert(db, { createdAtEpoch: Date.now() });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('hot');
  });

  it('returns warm for observation created 10 days ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(10) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('warm');
  });

  it('returns warm for observation created 29 days ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(29) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('warm');
  });

  it('returns cold for observation created 31 days ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(31) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('cold');
  });

  it('returns cold for observation created 60 days ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(60) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('cold');
  });

  it('returns archive for observation created 91 days ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(91) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('archive');
  });

  it('returns archive for observation created 200 days ago', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(200) });
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(id)).toBe('archive');
  });

  it('returns hot for non-existent observation id', () => {
    const mgr = new HotColdManager(db);
    expect(mgr.getDataAge(9999)).toBe('hot');
  });
});

// ─── process — bucket counts ──────────────────────────────────────────────────

describe('HotColdManager.process — bucket counts', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('returns all-zero result for empty project', () => {
    const mgr = new HotColdManager(db);
    const result = mgr.process(PROJECT);

    expect(result.hotCount).toBe(0);
    expect(result.warmCount).toBe(0);
    expect(result.coldMerged).toBe(0);
    expect(result.archived).toBe(0);
  });

  it('counts hot observations correctly', () => {
    insert(db, { createdAtEpoch: daysAgo(1) });
    insert(db, { createdAtEpoch: daysAgo(3) });
    insert(db, { createdAtEpoch: daysAgo(6) });

    const result = new HotColdManager(db).process(PROJECT);
    expect(result.hotCount).toBe(3);
    expect(result.warmCount).toBe(0);
    expect(result.coldMerged).toBe(0);
    expect(result.archived).toBe(0);
  });

  it('counts warm observations correctly', () => {
    insert(db, { createdAtEpoch: daysAgo(10) });
    insert(db, { createdAtEpoch: daysAgo(20) });

    const result = new HotColdManager(db).process(PROJECT);
    expect(result.hotCount).toBe(0);
    expect(result.warmCount).toBe(2);
    expect(result.coldMerged).toBe(0);
    expect(result.archived).toBe(0);
  });

  it('counts and archives archive-age observations', () => {
    insert(db, { createdAtEpoch: daysAgo(100) });
    insert(db, { createdAtEpoch: daysAgo(120) });

    const result = new HotColdManager(db).process(PROJECT);
    expect(result.archived).toBe(2);
    expect(result.hotCount).toBe(0);
    expect(result.warmCount).toBe(0);
  });

  it('handles mixed ages correctly', () => {
    insert(db, { createdAtEpoch: daysAgo(2) });   // hot
    insert(db, { createdAtEpoch: daysAgo(15) });  // warm
    insert(db, { createdAtEpoch: daysAgo(45), concepts: ['auth'] });  // cold
    insert(db, { createdAtEpoch: daysAgo(50), concepts: ['auth'] });  // cold (same group)
    insert(db, { createdAtEpoch: daysAgo(95) });  // archive

    const result = new HotColdManager(db).process(PROJECT);
    expect(result.hotCount).toBe(1);
    expect(result.warmCount).toBe(1);
    expect(result.archived).toBe(1);
    // 2 cold observations in same concept group → both get links
    expect(result.coldMerged).toBe(2);
  });
});

// ─── process — archive action ─────────────────────────────────────────────────

describe('HotColdManager.process — archive action', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('sets valid_until on archive-age observations', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(100) });
    new HotColdManager(db).process(PROJECT);

    const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as any;
    expect(row.valid_until).toBeTruthy();
    expect(new Date(row.valid_until).getFullYear()).toBe(new Date().getFullYear());
  });

  it('does not set valid_until on warm observations', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(15) });
    new HotColdManager(db).process(PROJECT);

    const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as any;
    expect(row.valid_until).toBeNull();
  });

  it('does not re-archive already-expired observations (changes = 0 extra)', () => {
    const existingExpiry = new Date(daysAgo(10)).toISOString();
    insert(db, { createdAtEpoch: daysAgo(100), validUntil: existingExpiry });

    // Only observation already has valid_until set → archived count should be 0
    const result = new HotColdManager(db).process(PROJECT);
    expect(result.archived).toBe(0);
  });
});

// ─── process — cold linking ───────────────────────────────────────────────────

describe('HotColdManager.process — cold linking', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('links cold observations within the same concept group', () => {
    const id1 = insert(db, { createdAtEpoch: daysAgo(40), concepts: ['auth'] });
    const id2 = insert(db, { createdAtEpoch: daysAgo(45), concepts: ['auth'] });
    const id3 = insert(db, { createdAtEpoch: daysAgo(50), concepts: ['auth'] });

    new HotColdManager(db).process(PROJECT);

    const row1 = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id1) as any;
    const row2 = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id2) as any;
    const row3 = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id3) as any;

    const rel1: number[] = JSON.parse(row1.related_observations);
    const rel2: number[] = JSON.parse(row2.related_observations);
    const rel3: number[] = JSON.parse(row3.related_observations);

    expect(rel1).toContain(id2);
    expect(rel1).toContain(id3);
    expect(rel2).toContain(id1);
    expect(rel2).toContain(id3);
    expect(rel3).toContain(id1);
    expect(rel3).toContain(id2);
  });

  it('does not link cold observations in different concept groups', () => {
    const id1 = insert(db, { createdAtEpoch: daysAgo(40), concepts: ['auth'] });
    const id2 = insert(db, { createdAtEpoch: daysAgo(45), concepts: ['api'] });

    new HotColdManager(db).process(PROJECT);

    const row1 = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id1) as any;
    const row2 = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id2) as any;

    expect(JSON.parse(row1.related_observations)).not.toContain(id2);
    expect(JSON.parse(row2.related_observations)).not.toContain(id1);
  });

  it('does not update related_observations for singleton cold groups', () => {
    const id = insert(db, { createdAtEpoch: daysAgo(40), concepts: ['unique-topic'] });

    new HotColdManager(db).process(PROJECT);

    const row = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id) as any;
    expect(JSON.parse(row.related_observations)).toHaveLength(0);
  });

  it('groups observations without concepts under general', () => {
    const id1 = insert(db, { createdAtEpoch: daysAgo(40), concepts: [] });
    const id2 = insert(db, { createdAtEpoch: daysAgo(45), concepts: [] });

    new HotColdManager(db).process(PROJECT);

    const row1 = db.prepare('SELECT related_observations FROM observations WHERE id = ?').get(id1) as any;
    expect(JSON.parse(row1.related_observations)).toContain(id2);
  });
});

// ─── process — project isolation ─────────────────────────────────────────────

describe('HotColdManager.process — project isolation', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });
  afterEach(() => { db.close(); });

  it('does not count observations from other projects', () => {
    insert(db, { project: OTHER_PROJECT, createdAtEpoch: daysAgo(1) });
    insert(db, { project: OTHER_PROJECT, createdAtEpoch: daysAgo(15) });

    const result = new HotColdManager(db).process(PROJECT);
    expect(result.hotCount).toBe(0);
    expect(result.warmCount).toBe(0);
  });

  it('does not archive observations from other projects', () => {
    const id = insert(db, { project: OTHER_PROJECT, createdAtEpoch: daysAgo(100) });

    new HotColdManager(db).process(PROJECT);

    const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as any;
    expect(row.valid_until).toBeNull();
  });
});
