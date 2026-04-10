/**
 * Tests for ActiveLearningService — knowledge gap detection and learning prompts.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with all required tables
 * - Uses real temp directories with mock project structures
 *
 * Value: Verifies gap detection, learning prompt generation, and completeness scoring.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ActiveLearningService } from '../../../src/services/learning/ActiveLearningService.js';

const PROJECT = 'test-project';

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
      files_modified TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    );
  `);

  return db;
}

function insertObservation(db: Database, project: string, filesModified: string): void {
  db.prepare(`
    INSERT INTO observations (memory_session_id, project, text, type, files_modified, created_at, created_at_epoch)
    VALUES ('mem-1', ?, 'test', 'discovery', ?, datetime('now'), ?)
  `).run(project, filesModified, Date.now());
}

function createTempProject(): string {
  const dir = join(tmpdir(), `test-project-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, 'src', 'auth'), { recursive: true });
  mkdirSync(join(dir, 'src', 'api'), { recursive: true });
  mkdirSync(join(dir, 'src', 'utils'), { recursive: true });

  // auth module: 5 files (high priority if gap)
  for (let i = 0; i < 5; i++) {
    writeFileSync(join(dir, 'src', 'auth', `auth-${i}.ts`), '');
  }

  // api module: 3 files (medium priority if gap)
  for (let i = 0; i < 3; i++) {
    writeFileSync(join(dir, 'src', 'api', `api-${i}.ts`), '');
  }

  // utils module: 1 file (low priority if gap)
  writeFileSync(join(dir, 'src', 'utils', 'helpers.ts'), '');

  return dir;
}

describe('ActiveLearningService', () => {
  let db: Database;
  let service: ActiveLearningService;
  let tempDir: string;

  beforeEach(() => {
    db = createTestDb();
    service = new ActiveLearningService(db);
    tempDir = createTempProject();
  });

  afterEach(() => {
    db.close();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch {}
  });

  // ─── detectGaps ──────────────────────────────────────────────────────────

  describe('detectGaps', () => {
    it('detects all modules as gaps when no observations exist', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      expect(gaps).toHaveLength(3);
      expect(gaps.map(g => g.area)).toContain('auth');
      expect(gaps.map(g => g.area)).toContain('api');
      expect(gaps.map(g => g.area)).toContain('utils');
    });

    it('assigns high priority to modules with 5+ files', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      const authGap = gaps.find(g => g.area === 'auth');
      expect(authGap?.priority).toBe('high');
    });

    it('assigns medium priority to modules with 2-4 files', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      const apiGap = gaps.find(g => g.area === 'api');
      expect(apiGap?.priority).toBe('medium');
    });

    it('assigns low priority to modules with 1 file', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      const utilsGap = gaps.find(g => g.area === 'utils');
      expect(utilsGap?.priority).toBe('low');
    });

    it('excludes modules with 2+ observations', () => {
      insertObservation(db, PROJECT, '["src/auth/auth-0.ts"]');
      insertObservation(db, PROJECT, '["src/auth/auth-1.ts"]');

      const gaps = service.detectGaps(PROJECT, tempDir);
      expect(gaps.map(g => g.area)).not.toContain('auth');
    });

    it('includes modules with exactly 1 observation', () => {
      insertObservation(db, PROJECT, '["src/api/api-0.ts"]');

      const gaps = service.detectGaps(PROJECT, tempDir);
      expect(gaps.map(g => g.area)).toContain('api');
    });

    it('returns gaps sorted by priority (high first)', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      const priorities = gaps.map(g => g.priority);
      expect(priorities[0]).toBe('high');
    });

    it('returns empty array when no src/ directory exists', () => {
      const emptyDir = join(tmpdir(), `empty-${Date.now()}`);
      mkdirSync(emptyDir, { recursive: true });

      const gaps = service.detectGaps(PROJECT, emptyDir);
      expect(gaps).toEqual([]);

      rmSync(emptyDir, { recursive: true, force: true });
    });

    it('includes file count in the reason string', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      const authGap = gaps.find(g => g.area === 'auth');
      expect(authGap?.reason).toContain('5 files');
      expect(authGap?.reason).toContain('0 observations');
    });
  });

  // ─── generateLearningPrompt ──────────────────────────────────────────────

  describe('generateLearningPrompt', () => {
    it('generates a prompt listing all gaps', () => {
      const gaps = service.detectGaps(PROJECT, tempDir);
      const prompt = service.generateLearningPrompt(gaps);
      expect(prompt).toContain('Knowledge gaps detected');
      expect(prompt).toContain('auth');
      expect(prompt).toContain('api');
      expect(prompt).toContain('Pay attention');
    });

    it('returns positive message when no gaps', () => {
      const prompt = service.generateLearningPrompt([]);
      expect(prompt).toContain('good observation coverage');
    });
  });

  // ─── getCompletenessScore ────────────────────────────────────────────────

  describe('getCompletenessScore', () => {
    it('returns 0 when no observations exist', () => {
      const score = service.getCompletenessScore(PROJECT);
      expect(score).toBe(0);
    });

    it('returns 100 when all modules have 2+ observations', () => {
      insertObservation(db, PROJECT, '["src/auth/a.ts"]');
      insertObservation(db, PROJECT, '["src/auth/b.ts"]');

      const score = service.getCompletenessScore(PROJECT);
      expect(score).toBe(100);
    });

    it('returns partial score for mixed coverage', () => {
      // auth: 2 observations (covered)
      insertObservation(db, PROJECT, '["src/auth/a.ts"]');
      insertObservation(db, PROJECT, '["src/auth/b.ts"]');
      // api: 1 observation (not covered)
      insertObservation(db, PROJECT, '["src/api/x.ts"]');

      const score = service.getCompletenessScore(PROJECT);
      // 1 covered out of 2 modules = 50%
      expect(score).toBe(50);
    });
  });
});
