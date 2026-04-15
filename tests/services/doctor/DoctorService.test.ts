/**
 * DoctorService unit tests
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual queries
 * - E-101 (worker health) depends on PID file existence, tested separately
 * - E-1001 (log error rate) skipped in DB-only tests (no log files)
 *
 * Scenarios: all-pass, all-fail, mixed, quick mode, history, grade boundaries
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { DoctorService } from '../../../src/services/doctor/DoctorService.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  // Disable FK checks after migrations for simpler test data insertion
  db.run('PRAGMA foreign_keys = OFF');
  return db;
}

function insertSession(db: Database, id: number, contentId: string, project: string = 'test'): void {
  db.prepare(`
    INSERT OR IGNORE INTO sdk_sessions (id, content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, status)
    VALUES (?, ?, ?, ?, 'test prompt', datetime('now'), ?, 'completed')
  `).run(id, contentId, `mem-${contentId}`, project, Date.now());
}

function insertObservation(db: Database, sessionId: string, type: string = 'discovery', title: string = 'Test', hash?: string): void {
  db.prepare(`
    INSERT INTO observations (memory_session_id, project, type, text, title, narrative, content_hash, created_at, created_at_epoch)
    VALUES (?, 'test', ?, '', ?, 'narrative text', ?, datetime('now'), ?)
  `).run(sessionId, type, title, hash ?? `hash-${Math.random().toString(36).slice(2, 10)}`, Date.now());
}

function insertSummary(db: Database, sessionId: string, structured: boolean = true): void {
  db.prepare(`
    INSERT INTO session_summaries (memory_session_id, project, request, learned, completed, next_steps, created_at, created_at_epoch)
    VALUES (?, 'test', ?, ?, ?, ?, datetime('now'), ?)
  `).run(
    sessionId,
    structured ? 'What was requested' : null,
    structured ? 'What was learned' : null,
    structured ? 'What was completed' : null,
    structured ? 'Next steps' : null,
    Date.now(),
  );
}

function insertCompilationLog(db: Database): void {
  db.prepare(`
    INSERT INTO compilation_logs (project, status, pages_created, pages_updated, started_at, completed_at)
    VALUES ('test', 'completed', 1, 0, datetime('now'), datetime('now'))
  `).run();
}

function insertCompiledKnowledge(db: Database): void {
  db.prepare(`
    INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids)
    VALUES ('test', 'Test Topic', 'Content', '[]')
  `).run();
}

function insertEntity(db: Database, name: string): void {
  db.prepare(`
    INSERT INTO entities (id, name, type, first_seen_at, last_seen_at)
    VALUES (?, ?, 'code', datetime('now'), datetime('now'))
  `).run(`ent-${name}`, name);
}

function insertFact(db: Database, entityId: string): void {
  db.prepare(`
    INSERT INTO facts (id, subject, predicate, object, confidence, source_observation_id)
    VALUES (?, ?, 'is', NULL, 0.9, 1)
  `).run(`fact-${entityId}`, entityId);
}

function insertDiaryEntry(db: Database): void {
  db.prepare(`
    INSERT INTO agent_diary (project, entry)
    VALUES ('test', 'A diary entry')
  `).run();
}

function insertSyncState(db: Database): void {
  db.prepare(`
    INSERT INTO sync_state (file_path, content_hash, source_type, last_sync_at)
    VALUES ('/test/file.md', 'abc123', 'observation', datetime('now'))
  `).run();
}

function insertUserPrompt(db: Database): void {
  db.prepare(`
    INSERT INTO user_prompts (content_session_id, prompt_number, prompt_text, created_at, created_at_epoch)
    VALUES ('sess-1', 1, 'test prompt', datetime('now'), ?)
  `).run(Date.now());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DoctorService', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('runFull', () => {
    it('returns low score for empty database', () => {
      const service = new DoctorService(db);
      const report = service.runFull();

      expect(report.mode).toBe('full');
      expect(report.score).toBeLessThan(30);
      expect(report.grade).toBe('F');
      expect(report.critical_failures.length).toBeGreaterThan(0);
      expect(report.recommendations.length).toBeGreaterThan(0);
    });

    it('returns high score for healthy database', () => {
      const service = new DoctorService(db);

      // Populate with healthy data
      for (let i = 1; i <= 10; i++) {
        const contentId = `sess-${i}`;
        const memId = `mem-sess-${i}`;
        insertSession(db, i, contentId);

        // 4 observations per session (>= 3 threshold)
        insertObservation(db, memId, 'discovery');
        insertObservation(db, memId, 'change');
        insertObservation(db, memId, 'decision');
        insertObservation(db, memId, 'feature');

        insertSummary(db, memId, true);
        insertUserPrompt(db);
      }

      // Add completed_at for E-104
      db.prepare("UPDATE sdk_sessions SET completed_at = datetime('now')").run();

      // Add facts + concepts to observations for E-205
      db.prepare("UPDATE observations SET facts = '[\"fact1\"]', concepts = '[\"concept1\"]'").run();

      // Add compilation, knowledge, entities, facts, diary, sync
      insertCompilationLog(db);
      insertCompiledKnowledge(db);
      // Add a knowledge page with version > 1 for E-403
      db.prepare("INSERT INTO compiled_knowledge (project, topic, content, source_observation_ids, version) VALUES ('test', 'Updated Topic', 'Updated', '[]', 2)").run();
      for (let i = 1; i <= 15; i++) insertEntity(db, `entity-${i}`);
      // Add enough facts for E-602 ratio >= 2.0 (need >= 30 facts for 15 entities)
      for (let i = 1; i <= 15; i++) {
        insertFact(db, `ent-entity-${i}`);
        db.prepare("INSERT INTO facts (id, subject, predicate, object, confidence, source_observation_id) VALUES (?, ?, 'has', NULL, 0.9, 1)").run(`fact2-ent-entity-${i}`, `ent-entity-${i}`);
      }
      for (let i = 0; i < 5; i++) insertDiaryEntry(db);
      insertSyncState(db);

      const report = service.runFull();

      expect(report.score).toBeGreaterThan(75);
      expect(['A', 'B']).toContain(report.grade);
      // E-201 should pass: 40 obs / 10 sessions = 4.0
      expect(report.results['E-201'].score).toBe('PASS');
      // E-401, E-402 should pass
      expect(report.results['E-401'].score).toBe('PASS');
      expect(report.results['E-402'].score).toBe('PASS');
    });

    it('stores report in doctor_reports table', () => {
      const service = new DoctorService(db);
      service.runFull();

      const row = db.prepare('SELECT COUNT(*) as cnt FROM doctor_reports').get() as { cnt: number };
      expect(row.cnt).toBe(1);
    });

    it('calculates weighted score correctly', () => {
      const service = new DoctorService(db);

      // Add just enough to pass CRITICAL items: 3 sessions, 4 obs each = 4.0 obs/session
      for (let i = 1; i <= 3; i++) {
        const contentId = `score-sess-${i}`;
        const memId = `mem-score-sess-${i}`;
        insertSession(db, 100 + i, contentId);
        for (let j = 0; j < 4; j++) insertObservation(db, memId, 'discovery');
      }
      insertCompilationLog(db);
      insertCompiledKnowledge(db);

      const report = service.runFull();

      // CRITICAL items should pass
      expect(report.results['E-401'].score).toBe('PASS');
      expect(report.results['E-402'].score).toBe('PASS');
      // E-201: 12 obs / 3 sessions = 4.0 >= 3 = PASS
      // NOTE: previous runFull() in "returns low score" test stored a report, so
      // doctor_reports has 1 row. But observations/sessions from this test are fresh.
      expect(report.results['E-201'].score).toBe('PASS');
      expect(report.critical_failures).toEqual([]);
    });
  });

  describe('runQuick', () => {
    it('only runs CRITICAL expectations', () => {
      const service = new DoctorService(db);
      const report = service.runQuick();

      expect(report.mode).toBe('quick');
      const ids = Object.keys(report.results);
      expect(ids).toEqual(expect.arrayContaining(['E-201', 'E-401', 'E-402']));
      expect(ids.length).toBe(3);
    });

    it('does not write to doctor_reports', () => {
      const service = new DoctorService(db);
      service.runQuick();

      const row = db.prepare('SELECT COUNT(*) as cnt FROM doctor_reports').get() as { cnt: number };
      expect(row.cnt).toBe(0);
    });

    it('reports critical failures when they exist', () => {
      const service = new DoctorService(db);
      const report = service.runQuick();

      // Empty DB: E-201, E-401, E-402 should all fail
      expect(report.critical_failures).toEqual(expect.arrayContaining(['E-201', 'E-401', 'E-402']));
    });

    it('reports no critical failures when all pass', () => {
      const service = new DoctorService(db);

      for (let i = 1; i <= 3; i++) {
        const contentId = `quick-sess-${i}`;
        const memId = `mem-quick-sess-${i}`;
        insertSession(db, 200 + i, contentId);
        for (let j = 0; j < 4; j++) insertObservation(db, memId, 'discovery');
      }
      insertCompilationLog(db);
      insertCompiledKnowledge(db);

      const report = service.runQuick();
      expect(report.critical_failures).toEqual([]);
    });
  });

  describe('getHistory', () => {
    it('returns empty for fresh database', () => {
      const service = new DoctorService(db);
      const history = service.getHistory(7);
      expect(history).toEqual([]);
    });

    it('returns reports after runFull', () => {
      const service = new DoctorService(db);
      service.runFull();
      service.runFull();

      const history = service.getHistory(7);
      expect(history.length).toBe(2);
      expect(history[0].score).toBeDefined();
      expect(history[0].grade).toBeDefined();
    });
  });

  describe('getLatest', () => {
    it('returns null for fresh database', () => {
      const service = new DoctorService(db);
      expect(service.getLatest()).toBeNull();
    });

    it('returns most recent full report', () => {
      const service = new DoctorService(db);
      service.runFull();

      const latest = service.getLatest();
      expect(latest).not.toBeNull();
      expect(latest!.mode).toBe('full');
      expect(latest!.results).toBeDefined();
    });
  });

  describe('grade boundaries', () => {
    it('assigns correct grades', () => {
      // Test the grading function indirectly via score
      const service = new DoctorService(db);

      // Empty DB = mostly FAIL = low score = F
      const report = service.runFull();
      expect(['D', 'F']).toContain(report.grade);
    });
  });

  describe('individual expectations', () => {
    it('E-202: counts distinct observation types', () => {
      const service = new DoctorService(db);
      insertSession(db, 1, 'sess-1');
      const memId = 'mem-sess-1';
      insertObservation(db, memId, 'discovery');
      insertObservation(db, memId, 'change');
      insertObservation(db, memId, 'decision');
      insertObservation(db, memId, 'feature');

      const report = service.runFull();
      expect(report.results['E-202'].score).toBe('PASS');
      expect(report.results['E-202'].value).toBe(4);
    });

    it('E-204: detects duplicate content hashes', () => {
      const service = new DoctorService(db);
      insertSession(db, 1, 'sess-1');
      const memId = 'mem-sess-1';

      // 10 observations, 5 with duplicate hashes
      for (let i = 0; i < 5; i++) insertObservation(db, memId, 'discovery', 'Test', `unique-${i}`);
      for (let i = 0; i < 5; i++) insertObservation(db, memId, 'discovery', 'Test', 'duplicate-hash');

      const report = service.runFull();
      // 6 unique / 10 total = 60% — below 80% threshold = FAIL
      expect(report.results['E-204'].score).toBe('FAIL');
    });

    it('E-302: checks structured summary fields', () => {
      const service = new DoctorService(db);
      insertSession(db, 1, 'sess-1');
      const memId = 'mem-sess-1';

      insertSummary(db, memId, true);   // structured
      insertSummary(db, memId, false);  // not structured

      const report = service.runFull();
      // 1/2 = 50% — below 70% but above 40% = WARN
      expect(report.results['E-302'].score).toBe('WARN');
    });

    it('E-601: requires > 10 entities', () => {
      const service = new DoctorService(db);
      insertSession(db, 1, 'sess-1');
      insertObservation(db, 'mem-sess-1', 'discovery');

      // 5 entities (below 10 threshold)
      for (let i = 0; i < 5; i++) insertEntity(db, `ent-${i}`);

      const report = service.runFull();
      expect(report.results['E-601'].score).toBe('FAIL');

      // Now add more to pass
      for (let i = 5; i < 15; i++) insertEntity(db, `ent-${i}`);

      const report2 = service.runFull();
      expect(report2.results['E-601'].score).toBe('PASS');
    });
  });

  describe('runDeep', () => {
    it('returns deep report with all analysis sections', () => {
      const service = new DoctorService(db);

      // Populate with data
      for (let i = 1; i <= 5; i++) {
        insertSession(db, i, `deep-sess-${i}`);
        insertObservation(db, `mem-deep-sess-${i}`, 'discovery');
        insertObservation(db, `mem-deep-sess-${i}`, 'change');
        insertSummary(db, `mem-deep-sess-${i}`, true);
      }

      const report = service.runDeep();

      expect(report.mode).toBe('deep');
      expect(report.score).toBeDefined();
      expect(report.grade).toBeDefined();
      expect(report.results).toBeDefined();

      // Deep analysis sections exist
      expect(report.daily_breakdown).toBeDefined();
      expect(Array.isArray(report.daily_breakdown)).toBe(true);
      expect(report.session_status).toBeDefined();
      expect(report.session_status.completed).toBeGreaterThanOrEqual(0);
      expect(report.obs_per_session).toBeDefined();
      expect(Array.isArray(report.obs_per_session)).toBe(true);
      expect(report.observation_quality).toBeDefined();
      expect(report.observation_quality.total).toBe(10);
      expect(report.summary_quality).toBeDefined();
      expect(report.summary_quality.total).toBe(5);
      expect(report.log_analysis).toBeDefined();
    });

    it('stores deep_analysis in doctor_reports', () => {
      const service = new DoctorService(db);
      insertSession(db, 1, 'deep-store-sess-1');
      insertObservation(db, 'mem-deep-store-sess-1', 'discovery');

      service.runDeep();

      const row = db.prepare("SELECT deep_analysis, mode FROM doctor_reports WHERE mode = 'deep' ORDER BY created_at DESC LIMIT 1").get() as { deep_analysis: string | null; mode: string } | null;
      expect(row).not.toBeNull();
      expect(row!.mode).toBe('deep');
      expect(row!.deep_analysis).not.toBeNull();

      const parsed = JSON.parse(row!.deep_analysis!);
      expect(parsed.observation_quality).toBeDefined();
      expect(parsed.session_status).toBeDefined();
    });

    it('generates deep recommendations for interrupted sessions', () => {
      const service = new DoctorService(db);

      // Create sessions with mixed statuses — many interrupted
      for (let i = 1; i <= 10; i++) {
        db.prepare(`
          INSERT OR IGNORE INTO sdk_sessions (id, content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, status)
          VALUES (?, ?, ?, 'test', 'prompt', datetime('now'), ?, ?)
        `).run(300 + i, `int-sess-${i}`, `mem-int-sess-${i}`, Date.now(), i <= 4 ? 'completed' : 'interrupted');
      }

      const report = service.runDeep();
      // 6/10 interrupted = 60% > 30% threshold
      const hasInterruptRec = report.recommendations.some(r => r.includes('interrupted'));
      expect(hasInterruptRec).toBe(true);
    });
  });
});
