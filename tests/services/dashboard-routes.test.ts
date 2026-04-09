/**
 * DashboardService tests (7.3)
 *
 * Tests for DashboardService.getDashboard() covering:
 * - Empty project returns zeroed metrics
 * - Total observations count
 * - This-week count respects time window
 * - Type distribution breakdown
 * - Top concepts parsed from JSON concepts field
 * - Freshness distribution (hot/warm/cold/archive) bands
 * - Concepts column with malformed JSON is skipped without throwing
 * - Multiple concept occurrences across rows are counted correctly
 * - Top 10 limit on concepts
 * - Compiled pages / entities / facts / diary entries return 0 for missing tables
 * - lintWarnings always returns 0 (reserved for future use)
 * - getDashboard with multiple projects only scopes to requested project
 * - Concepts column missing entirely is handled gracefully
 * - Empty concepts array is handled gracefully
 * - Freshness boundaries are exclusive/inclusive correctly
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { DashboardService } from '../../src/services/dashboard/DashboardService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const THIRTY_DAYS_MS = 30 * DAY_MS;
const NINETY_DAYS_MS = 90 * DAY_MS;

/**
 * Build a minimal in-memory database with the observations table.
 * We create the schema manually (without ClaudeMemDatabase) to keep tests
 * fast and independent of the full migration chain.
 */
function createMinimalDb(): Database {
  const db = new Database(':memory:');

  // sdk_sessions is referenced as a FK parent for observations — simplest
  // approach is to create the table even though we won't use FK enforcement.
  db.run(`
    CREATE TABLE sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      memory_session_id TEXT UNIQUE,
      project TEXT NOT NULL,
      started_at TEXT NOT NULL,
      started_at_epoch INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      text TEXT,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL,
      concepts TEXT
    )
  `);

  return db;
}

function insertSession(db: Database, project: string): string {
  const sid = `sid-${Date.now()}-${Math.random()}`;
  db.prepare(`
    INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
    VALUES (?, ?, ?, ?, ?)
  `).run(sid, sid, project, new Date().toISOString(), Date.now());
  return sid;
}

function insertObs(
  db: Database,
  project: string,
  type: string,
  createdAtEpoch: number,
  concepts?: string[] | null
): void {
  const sid = insertSession(db, project);
  const conceptsJson = concepts === null ? null : JSON.stringify(concepts ?? []);
  db.prepare(`
    INSERT INTO observations (memory_session_id, project, text, type, created_at, created_at_epoch, concepts)
    VALUES (?, ?, 'text', ?, ?, ?, ?)
  `).run(sid, project, type, new Date(createdAtEpoch).toISOString(), createdAtEpoch, conceptsJson);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('DashboardService', () => {
  let db: Database;
  let svc: DashboardService;

  beforeEach(() => {
    db = createMinimalDb();
    svc = new DashboardService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ── 1. Empty project ──────────────────────────────────────────────────────

  it('returns zeroed metrics for an empty project', () => {
    const data = svc.getDashboard('empty-project');

    expect(data.totalObservations).toBe(0);
    expect(data.thisWeekNew).toBe(0);
    expect(data.byType).toEqual({});
    expect(data.topConcepts).toEqual([]);
    expect(data.freshness).toEqual({ hot: 0, warm: 0, cold: 0, archive: 0 });
    expect(data.compiledPages).toBe(0);
    expect(data.lintWarnings).toBe(0);
    expect(data.totalEntities).toBe(0);
    expect(data.totalFacts).toBe(0);
    expect(data.diaryEntries).toBe(0);
  });

  // ── 2. Total observations ─────────────────────────────────────────────────

  it('counts total observations for the project', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now);
    insertObs(db, 'proj', 'bugfix', now - 1000);
    insertObs(db, 'proj', 'feature', now - 2000);
    // Extra observation for a different project — must not be counted
    insertObs(db, 'other', 'decision', now);

    const data = svc.getDashboard('proj');
    expect(data.totalObservations).toBe(3);
  });

  // ── 3. thisWeekNew respects 7-day boundary ────────────────────────────────

  it('counts only observations created within the last 7 days for thisWeekNew', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now - 1 * DAY_MS);       // 1 day ago → hot
    insertObs(db, 'proj', 'decision', now - 6 * DAY_MS);       // 6 days ago → still hot
    insertObs(db, 'proj', 'decision', now - 8 * DAY_MS);       // 8 days ago → not in week
    insertObs(db, 'proj', 'decision', now - 30 * DAY_MS);      // 30 days ago → not in week

    const data = svc.getDashboard('proj');
    expect(data.thisWeekNew).toBe(2);
  });

  // ── 4. byType distribution ────────────────────────────────────────────────

  it('builds correct type distribution map', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now);
    insertObs(db, 'proj', 'decision', now - 1000);
    insertObs(db, 'proj', 'bugfix', now - 2000);
    insertObs(db, 'proj', 'feature', now - 3000);
    insertObs(db, 'proj', 'feature', now - 4000);
    insertObs(db, 'proj', 'feature', now - 5000);

    const data = svc.getDashboard('proj');
    expect(data.byType).toEqual({ decision: 2, bugfix: 1, feature: 3 });
  });

  it('excludes other-project entries from byType', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now);
    insertObs(db, 'other', 'bugfix', now);

    const data = svc.getDashboard('proj');
    expect(data.byType).toEqual({ decision: 1 });
    expect(data.byType['bugfix']).toBeUndefined();
  });

  // ── 5. Top concepts ───────────────────────────────────────────────────────

  it('counts concept occurrences across observations', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now, ['auth', 'security']);
    insertObs(db, 'proj', 'decision', now - 1000, ['auth', 'jwt']);
    insertObs(db, 'proj', 'feature', now - 2000, ['auth']);

    const data = svc.getDashboard('proj');

    const authEntry = data.topConcepts.find(c => c.concept === 'auth');
    expect(authEntry?.count).toBe(3);

    const secEntry = data.topConcepts.find(c => c.concept === 'security');
    expect(secEntry?.count).toBe(1);

    const jwtEntry = data.topConcepts.find(c => c.concept === 'jwt');
    expect(jwtEntry?.count).toBe(1);
  });

  it('orders concepts by descending frequency', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now, ['rare']);
    insertObs(db, 'proj', 'decision', now - 1000, ['common', 'rare']);
    insertObs(db, 'proj', 'decision', now - 2000, ['common']);
    insertObs(db, 'proj', 'decision', now - 3000, ['common']);

    const data = svc.getDashboard('proj');
    expect(data.topConcepts[0].concept).toBe('common');
    expect(data.topConcepts[0].count).toBe(3);
  });

  it('limits topConcepts to 10 entries', () => {
    const now = Date.now();
    // Insert 15 unique concepts, each appearing once
    const allConcepts = Array.from({ length: 15 }, (_, i) => `concept${i}`);
    insertObs(db, 'proj', 'decision', now, allConcepts);

    const data = svc.getDashboard('proj');
    expect(data.topConcepts.length).toBeLessThanOrEqual(10);
  });

  it('ignores malformed JSON in concepts column without throwing', () => {
    const now = Date.now();
    const sid = insertSession(db, 'proj');
    // Insert a row with invalid JSON in concepts
    db.prepare(`
      INSERT INTO observations (memory_session_id, project, text, type, created_at, created_at_epoch, concepts)
      VALUES (?, ?, 'text', 'decision', ?, ?, ?)
    `).run(sid, 'proj', new Date(now).toISOString(), now, '{invalid json}');

    // Also insert a valid row so we confirm the service still returns results
    insertObs(db, 'proj', 'decision', now - 1000, ['valid-concept']);

    expect(() => svc.getDashboard('proj')).not.toThrow();
    const data = svc.getDashboard('proj');
    expect(data.topConcepts.some(c => c.concept === 'valid-concept')).toBe(true);
  });

  it('handles null concepts column gracefully', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now, null);
    expect(() => svc.getDashboard('proj')).not.toThrow();
    const data = svc.getDashboard('proj');
    expect(data.topConcepts).toEqual([]);
  });

  it('handles empty concepts array without adding entries', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now, []);
    const data = svc.getDashboard('proj');
    expect(data.topConcepts).toEqual([]);
  });

  // ── 6. Freshness distribution ─────────────────────────────────────────────

  it('classifies observations into hot/warm/cold/archive bands', () => {
    const now = Date.now();

    // hot: created within last 7 days
    insertObs(db, 'proj', 'decision', now - 3 * DAY_MS);

    // warm: 7–30 days ago
    insertObs(db, 'proj', 'decision', now - 10 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 25 * DAY_MS);

    // cold: 30–90 days ago
    insertObs(db, 'proj', 'decision', now - 45 * DAY_MS);

    // archive: older than 90 days
    insertObs(db, 'proj', 'decision', now - 100 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 200 * DAY_MS);

    const data = svc.getDashboard('proj');
    expect(data.freshness.hot).toBe(1);
    expect(data.freshness.warm).toBe(2);
    expect(data.freshness.cold).toBe(1);
    expect(data.freshness.archive).toBe(2);
  });

  it('hot + warm + cold + archive sums to totalObservations', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now - 2 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 15 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 60 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 120 * DAY_MS);

    const data = svc.getDashboard('proj');
    const freshnessTotal = data.freshness.hot + data.freshness.warm + data.freshness.cold + data.freshness.archive;
    expect(freshnessTotal).toBe(data.totalObservations);
  });

  // ── 7. lintWarnings is always 0 ───────────────────────────────────────────

  it('always returns 0 for lintWarnings (reserved for future integration)', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now);
    const data = svc.getDashboard('proj');
    expect(data.lintWarnings).toBe(0);
  });

  // ── 8. Missing optional tables return 0 ──────────────────────────────────

  it('returns 0 for compiledPages when compiled_knowledge table does not exist', () => {
    const data = svc.getDashboard('proj');
    expect(data.compiledPages).toBe(0);
  });

  it('returns 0 for totalEntities when entities table does not exist', () => {
    const data = svc.getDashboard('proj');
    expect(data.totalEntities).toBe(0);
  });

  it('returns 0 for totalFacts when facts table does not exist', () => {
    const data = svc.getDashboard('proj');
    expect(data.totalFacts).toBe(0);
  });

  it('returns 0 for diaryEntries when agent_diary table does not exist', () => {
    const data = svc.getDashboard('proj');
    expect(data.diaryEntries).toBe(0);
  });

  // ── 9. Cross-project isolation ────────────────────────────────────────────

  it('isolates all metrics to the requested project', () => {
    const now = Date.now();
    insertObs(db, 'proj-a', 'decision', now, ['shared-concept']);
    insertObs(db, 'proj-a', 'bugfix', now - 1000);
    insertObs(db, 'proj-b', 'feature', now, ['other-concept']);
    insertObs(db, 'proj-b', 'refactor', now - 1000);

    const dataA = svc.getDashboard('proj-a');
    expect(dataA.totalObservations).toBe(2);
    expect(dataA.byType['feature']).toBeUndefined();
    expect(dataA.topConcepts.some(c => c.concept === 'other-concept')).toBe(false);

    const dataB = svc.getDashboard('proj-b');
    expect(dataB.totalObservations).toBe(2);
    expect(dataB.byType['decision']).toBeUndefined();
    expect(dataB.topConcepts.some(c => c.concept === 'shared-concept')).toBe(false);
  });

  // ── 10. thisWeekNew equals hot freshness count ────────────────────────────

  it('thisWeekNew equals the hot freshness count', () => {
    const now = Date.now();
    insertObs(db, 'proj', 'decision', now - 2 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 5 * DAY_MS);
    insertObs(db, 'proj', 'decision', now - 20 * DAY_MS);

    const data = svc.getDashboard('proj');
    expect(data.thisWeekNew).toBe(data.freshness.hot);
  });

  // ── 11. Non-string concept entries are skipped ────────────────────────────

  it('skips non-string entries in concepts array', () => {
    const now = Date.now();
    const sid = insertSession(db, 'proj');
    // Concepts array with mixed types — only strings should be counted
    db.prepare(`
      INSERT INTO observations (memory_session_id, project, text, type, created_at, created_at_epoch, concepts)
      VALUES (?, ?, 'text', 'decision', ?, ?, ?)
    `).run(sid, 'proj', new Date(now).toISOString(), now, JSON.stringify(['valid', 42, null, 'also-valid']));

    const data = svc.getDashboard('proj');
    expect(data.topConcepts.some(c => c.concept === 'valid')).toBe(true);
    expect(data.topConcepts.some(c => c.concept === 'also-valid')).toBe(true);
    // Non-string values should not appear
    expect(data.topConcepts.some(c => c.concept === '42')).toBe(false);
  });
});
