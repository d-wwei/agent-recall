/**
 * Tests for KnowledgeLint — contradiction, staleness, orphan, and
 * low-confidence checks.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with Phase 1+2 observation columns
 * - KnowledgeLint operates purely on the DB — no external I/O
 *
 * Value: Ensures each lint check independently produces correct warnings /
 *        mutations and that actionsApplied reflects DB mutations accurately.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { KnowledgeLint } from '../../../src/services/compilation/KnowledgeLint.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT = 'test-project';

/**
 * Create an in-memory DB with the minimal schema required by KnowledgeLint:
 *   - observations table (Phase 1 + Phase 2 columns)
 *   - compiled_knowledge table (for the protected-skip test)
 */
function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL DEFAULT 'sess-1',
      project TEXT NOT NULL,
      text TEXT,
      type TEXT NOT NULL DEFAULT 'discovery',
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
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}

/** Insert an observation and return its auto-generated id. */
function insertObs(
  db: Database,
  opts: {
    project?: string;
    type?: string;
    createdAtEpoch?: number;
    lastReferencedAt?: string | null;
    filesModified?: string[];
    confidence?: string;
    validUntil?: string | null;
  }
): number {
  const {
    project = PROJECT,
    type = 'discovery',
    createdAtEpoch = Date.now(),
    lastReferencedAt = null,
    filesModified = null,
    confidence = 'medium',
    validUntil = null,
  } = opts;

  const result = db
    .prepare(
      `INSERT INTO observations
       (project, type, created_at_epoch, last_referenced_at, files_modified,
        confidence, valid_until, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      project,
      type,
      createdAtEpoch,
      lastReferencedAt,
      filesModified ? JSON.stringify(filesModified) : null,
      confidence,
      validUntil,
      new Date(createdAtEpoch).toISOString()
    );

  return Number(result.lastInsertRowid);
}

/** Insert a compiled_knowledge row and return its id. */
function insertCompiledPage(
  db: Database,
  opts: {
    project?: string;
    topic?: string;
    protected?: number;
    validUntil?: string | null;
  }
): number {
  const {
    project = PROJECT,
    topic = 'test-topic',
    protected: prot = 0,
    validUntil = null,
  } = opts;

  const result = db
    .prepare(
      `INSERT INTO compiled_knowledge (project, topic, content, protected, valid_until)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(project, topic, 'content', prot, validUntil);

  return Number(result.lastInsertRowid);
}

// Convenience time constants
const NOW = Date.now();
const DAYS_MS = 24 * 60 * 60 * 1000;
const FRESH = NOW - 1 * DAYS_MS;           // 1 day ago — not stale
const STALE = NOW - 35 * DAYS_MS;          // 35 days ago — stale (> 30 days)
const ORPHAN = NOW - 95 * DAYS_MS;         // 95 days ago — orphan (> 90 days)
const WITHIN_7_DAYS = NOW - 3 * DAYS_MS;   // 3 days ago

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KnowledgeLint', () => {
  let db: Database;
  let lint: KnowledgeLint;

  beforeEach(() => {
    db = createTestDb();
    lint = new KnowledgeLint(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. Clean project ───────────────────────────────────────────────────────

  describe('clean project', () => {
    it('returns zero warnings and zero actions when no observations exist', () => {
      const result = lint.run(PROJECT);

      expect(result.warnings).toHaveLength(0);
      expect(result.actionsApplied).toBe(0);
    });

    it('returns zero warnings for fresh high-confidence observations', () => {
      insertObs(db, { type: 'discovery', createdAtEpoch: FRESH, confidence: 'high' });
      insertObs(db, { type: 'discovery', createdAtEpoch: FRESH, confidence: 'medium' });

      const result = lint.run(PROJECT);

      expect(result.warnings).toHaveLength(0);
      expect(result.actionsApplied).toBe(0);
    });

    it('does not produce warnings for a different project', () => {
      // Insert stale obs for a different project
      insertObs(db, { project: 'other-project', type: 'discovery', createdAtEpoch: ORPHAN });

      const result = lint.run(PROJECT);

      expect(result.warnings).toHaveLength(0);
    });
  });

  // ── 2. Staleness marking ───────────────────────────────────────────────────

  describe('staleness marking', () => {
    it('sets valid_until on observations older than 30 days with null last_referenced_at', () => {
      const id = insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null });

      const result = lint.run(PROJECT);

      expect(result.actionsApplied).toBeGreaterThanOrEqual(1);

      const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as {
        valid_until: string | null;
      };
      expect(row.valid_until).not.toBeNull();
    });

    it('does not mark fresh observations as stale', () => {
      const id = insertObs(db, { createdAtEpoch: FRESH, lastReferencedAt: null });

      lint.run(PROJECT);

      const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as {
        valid_until: string | null;
      };
      expect(row.valid_until).toBeNull();
    });

    it('does not mark observations that have a recent last_referenced_at', () => {
      const recentRef = new Date(NOW - 5 * DAYS_MS).toISOString(); // 5 days ago
      const id = insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: recentRef });

      lint.run(PROJECT);

      const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as {
        valid_until: string | null;
      };
      expect(row.valid_until).toBeNull();
    });

    it('does not re-mark observations that already have valid_until set', () => {
      const existingExpiry = new Date(STALE + DAYS_MS).toISOString();
      const id = insertObs(db, {
        createdAtEpoch: STALE,
        lastReferencedAt: null,
        validUntil: existingExpiry,
      });

      const result = lint.run(PROJECT);

      // actionsApplied should not include already-expired rows
      const row = db.prepare('SELECT valid_until FROM observations WHERE id = ?').get(id) as {
        valid_until: string;
      };
      // The value stays unchanged (was already set)
      expect(row.valid_until).toBe(existingExpiry);
    });

    it('counts the number of stale observations marked as actionsApplied', () => {
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null });
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null });
      insertObs(db, { createdAtEpoch: FRESH, lastReferencedAt: null }); // not stale

      const result = lint.run(PROJECT);

      expect(result.actionsApplied).toBe(2);
    });
  });

  // ── 3. Orphan detection ────────────────────────────────────────────────────

  describe('orphan detection', () => {
    it('flags observations older than 90 days with null last_referenced_at', () => {
      const id = insertObs(db, { createdAtEpoch: ORPHAN, lastReferencedAt: null });

      const result = lint.run(PROJECT);

      const orphans = result.warnings.filter(w => w.type === 'orphan');
      expect(orphans.length).toBeGreaterThanOrEqual(1);
      expect(orphans.some(w => w.observationId === id)).toBe(true);
    });

    it('does not flag observations younger than 90 days', () => {
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null }); // 35 days — not an orphan

      const result = lint.run(PROJECT);

      const orphans = result.warnings.filter(w => w.type === 'orphan');
      expect(orphans).toHaveLength(0);
    });

    it('does not flag orphans that have been referenced', () => {
      const ref = new Date(NOW - 100 * DAYS_MS).toISOString(); // old reference, but not null
      insertObs(db, { createdAtEpoch: ORPHAN, lastReferencedAt: ref });

      const result = lint.run(PROJECT);

      const orphans = result.warnings.filter(w => w.type === 'orphan');
      expect(orphans).toHaveLength(0);
    });

    it('does not delete orphan observations — only warns', () => {
      const id = insertObs(db, { createdAtEpoch: ORPHAN, lastReferencedAt: null });

      lint.run(PROJECT);

      const row = db.prepare('SELECT id FROM observations WHERE id = ?').get(id);
      expect(row).not.toBeNull();
    });
  });

  // ── 4. Low-confidence audit ────────────────────────────────────────────────

  describe('low confidence audit', () => {
    it('flags observations with confidence = low', () => {
      const id = insertObs(db, { createdAtEpoch: FRESH, confidence: 'low' });

      const result = lint.run(PROJECT);

      const lc = result.warnings.filter(w => w.type === 'low_confidence');
      expect(lc.length).toBeGreaterThanOrEqual(1);
      expect(lc.some(w => w.observationId === id)).toBe(true);
    });

    it('does not flag medium or high confidence observations', () => {
      insertObs(db, { createdAtEpoch: FRESH, confidence: 'medium' });
      insertObs(db, { createdAtEpoch: FRESH, confidence: 'high' });

      const result = lint.run(PROJECT);

      const lc = result.warnings.filter(w => w.type === 'low_confidence');
      expect(lc).toHaveLength(0);
    });

    it('includes observationId in low_confidence warnings', () => {
      const id = insertObs(db, { createdAtEpoch: FRESH, confidence: 'low' });

      const result = lint.run(PROJECT);

      const lc = result.warnings.filter(w => w.type === 'low_confidence');
      expect(lc[0].observationId).toBe(id);
    });
  });

  // ── 5. Contradiction detection ─────────────────────────────────────────────

  describe('contradiction detection', () => {
    it('flags bugfix and feature on the same file within 7 days', () => {
      insertObs(db, {
        type: 'bugfix',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 1 * DAYS_MS,
      });
      insertObs(db, {
        type: 'feature',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 3 * DAYS_MS,
      });

      const result = lint.run(PROJECT);

      const contradictions = result.warnings.filter(w => w.type === 'contradiction');
      expect(contradictions.length).toBeGreaterThanOrEqual(1);
    });

    it('does not flag bugfix and feature on the same file more than 7 days apart', () => {
      insertObs(db, {
        type: 'bugfix',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 1 * DAYS_MS,
      });
      insertObs(db, {
        type: 'feature',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 10 * DAYS_MS, // 9 days apart
      });

      const result = lint.run(PROJECT);

      const contradictions = result.warnings.filter(w => w.type === 'contradiction');
      expect(contradictions).toHaveLength(0);
    });

    it('does not flag two bugfix observations on the same file (no contradiction)', () => {
      insertObs(db, {
        type: 'bugfix',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 1 * DAYS_MS,
      });
      insertObs(db, {
        type: 'bugfix',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 2 * DAYS_MS,
      });

      const result = lint.run(PROJECT);

      const contradictions = result.warnings.filter(w => w.type === 'contradiction');
      expect(contradictions).toHaveLength(0);
    });

    it('does not flag observations on different files', () => {
      insertObs(db, {
        type: 'bugfix',
        filesModified: ['src/auth.ts'],
        createdAtEpoch: NOW - 1 * DAYS_MS,
      });
      insertObs(db, {
        type: 'feature',
        filesModified: ['src/payments.ts'],
        createdAtEpoch: NOW - 2 * DAYS_MS,
      });

      const result = lint.run(PROJECT);

      const contradictions = result.warnings.filter(w => w.type === 'contradiction');
      expect(contradictions).toHaveLength(0);
    });

    it('includes the conflicting file in the contradiction description', () => {
      insertObs(db, {
        type: 'bugfix',
        filesModified: ['src/critical.ts'],
        createdAtEpoch: NOW - 1 * DAYS_MS,
      });
      insertObs(db, {
        type: 'feature',
        filesModified: ['src/critical.ts'],
        createdAtEpoch: NOW - 2 * DAYS_MS,
      });

      const result = lint.run(PROJECT);

      const contradictions = result.warnings.filter(w => w.type === 'contradiction');
      expect(contradictions[0].description).toContain('src/critical.ts');
    });
  });

  // ── 6. Protected compiled_knowledge pages ─────────────────────────────────

  describe('protected compiled_knowledge pages', () => {
    it('never modifies protected compiled_knowledge entries (valid_until stays null)', () => {
      // Insert a protected compiled page
      const pageId = insertCompiledPage(db, { protected: 1, validUntil: null });

      // The lint doesn't modify compiled_knowledge directly in these checks,
      // but we verify the page stays untouched after a full lint run.
      lint.run(PROJECT);

      const row = db
        .prepare('SELECT valid_until, protected FROM compiled_knowledge WHERE id = ?')
        .get(pageId) as { valid_until: string | null; protected: number };

      expect(row.protected).toBe(1);
      expect(row.valid_until).toBeNull();
    });

    it('does not flag protected compiled_knowledge in warnings', () => {
      insertCompiledPage(db, { protected: 1 });

      const result = lint.run(PROJECT);

      // Protected pages should not appear in warnings at all
      const pageWarnings = result.warnings.filter(w => w.compiledPageId !== undefined);
      expect(pageWarnings).toHaveLength(0);
    });
  });

  // ── 7. actionsApplied accuracy ─────────────────────────────────────────────

  describe('actionsApplied count accuracy', () => {
    it('returns 0 when nothing is stale', () => {
      insertObs(db, { createdAtEpoch: FRESH });

      const result = lint.run(PROJECT);

      expect(result.actionsApplied).toBe(0);
    });

    it('returns exact count matching rows updated by staleness pass', () => {
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null });
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null });
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null });

      const result = lint.run(PROJECT);

      expect(result.actionsApplied).toBe(3);
    });

    it('warnings-only checks do not increment actionsApplied', () => {
      // Orphan + low confidence — neither mutates rows
      insertObs(db, { createdAtEpoch: ORPHAN, lastReferencedAt: null, confidence: 'low' });

      const result = lint.run(PROJECT);

      // The orphan warning is there (age > 90 days) but actionsApplied should
      // only count staleness mutations.  Orphans are > 90d but also > 30d so
      // they ARE stale — expect 1 action for the staleness pass.
      const orphanWarnings = result.warnings.filter(w => w.type === 'orphan');
      const lcWarnings = result.warnings.filter(w => w.type === 'low_confidence');
      expect(orphanWarnings.length).toBeGreaterThanOrEqual(1);
      expect(lcWarnings.length).toBeGreaterThanOrEqual(1);
      // actionsApplied = 1 (stale mark on the same obs)
      expect(result.actionsApplied).toBe(1);
    });

    it('does not double-count already-expired observations', () => {
      const alreadyExpired = new Date(NOW - 60 * DAYS_MS).toISOString();
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null, validUntil: alreadyExpired });
      insertObs(db, { createdAtEpoch: STALE, lastReferencedAt: null }); // new stale obs

      const result = lint.run(PROJECT);

      expect(result.actionsApplied).toBe(1); // only the new one
    });
  });
});
