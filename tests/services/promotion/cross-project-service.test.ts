/**
 * Tests for CrossProjectService — cross-project knowledge migration.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with all required tables
 *
 * Value: Verifies pattern detection across projects, promotion to global scope,
 *        and global knowledge retrieval.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { CrossProjectService } from '../../../src/services/promotion/CrossProjectService.js';
import type { PromotablePattern } from '../../../src/services/promotion/CrossProjectService.js';

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
      narrative TEXT,
      concepts TEXT,
      files_modified TEXT,
      scope TEXT NOT NULL DEFAULT 'project',
      created_at TEXT NOT NULL DEFAULT '',
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'unknown',
      properties TEXT DEFAULT '{}',
      first_seen_at TEXT,
      last_seen_at TEXT
    );
    CREATE INDEX idx_entities_name ON entities(name);
    CREATE INDEX idx_entities_type ON entities(type);

    CREATE TABLE facts (
      id TEXT PRIMARY KEY,
      subject TEXT REFERENCES entities(id),
      predicate TEXT NOT NULL,
      object TEXT REFERENCES entities(id),
      valid_from TEXT,
      valid_to TEXT,
      confidence REAL DEFAULT 1.0,
      source_observation_id INTEGER,
      source_ref TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_facts_subject ON facts(subject);
    CREATE INDEX idx_facts_predicate ON facts(predicate);
  `);

  return db;
}

function insertObservation(db: Database, project: string, concepts: string, opts: {
  scope?: string; type?: string;
} = {}): void {
  db.prepare(`
    INSERT INTO observations (memory_session_id, project, text, type, concepts, scope, created_at, created_at_epoch)
    VALUES ('mem-1', ?, 'test', ?, ?, ?, datetime('now'), ?)
  `).run(project, opts.type || 'discovery', concepts, opts.scope || 'project', Date.now());
}

describe('CrossProjectService', () => {
  let db: Database;
  let service: CrossProjectService;

  beforeEach(() => {
    db = createTestDb();
    service = new CrossProjectService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── detectGlobalPatterns ────────────────────────────────────────────────

  describe('detectGlobalPatterns', () => {
    it('returns empty array when no observations exist', () => {
      const patterns = service.detectGlobalPatterns();
      expect(patterns).toEqual([]);
    });

    it('returns empty array when concepts appear in only one project', () => {
      insertObservation(db, 'project-a', '["typescript", "testing"]');
      insertObservation(db, 'project-a', '["typescript"]');

      const patterns = service.detectGlobalPatterns();
      expect(patterns).toEqual([]);
    });

    it('detects patterns appearing across 2+ projects', () => {
      insertObservation(db, 'project-a', '["typescript", "eslint"]');
      insertObservation(db, 'project-b', '["typescript", "jest"]');

      const patterns = service.detectGlobalPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe('typescript');
      expect(patterns[0].projects).toContain('project-a');
      expect(patterns[0].projects).toContain('project-b');
    });

    it('detects multiple cross-project patterns', () => {
      insertObservation(db, 'project-a', '["typescript", "eslint"]');
      insertObservation(db, 'project-b', '["typescript", "eslint"]');

      const patterns = service.detectGlobalPatterns();
      expect(patterns).toHaveLength(2);
      expect(patterns.map(p => p.pattern)).toContain('typescript');
      expect(patterns.map(p => p.pattern)).toContain('eslint');
    });

    it('handles comma-separated concepts format', () => {
      insertObservation(db, 'project-a', 'typescript, eslint');
      insertObservation(db, 'project-b', 'typescript');

      const patterns = service.detectGlobalPatterns();
      expect(patterns.length).toBeGreaterThanOrEqual(1);
      expect(patterns.some(p => p.pattern === 'typescript')).toBe(true);
    });

    it('normalizes concept names to lowercase', () => {
      insertObservation(db, 'project-a', '["TypeScript"]');
      insertObservation(db, 'project-b', '["typescript"]');

      const patterns = service.detectGlobalPatterns();
      expect(patterns).toHaveLength(1);
      expect(patterns[0].pattern).toBe('typescript');
    });

    it('ignores observations with global scope', () => {
      insertObservation(db, 'project-a', '["typescript"]', { scope: 'global' });
      insertObservation(db, 'project-b', '["typescript"]', { scope: 'global' });

      const patterns = service.detectGlobalPatterns();
      expect(patterns).toEqual([]);
    });

    it('calculates confidence based on project coverage', () => {
      insertObservation(db, 'project-a', '["typescript"]');
      insertObservation(db, 'project-b', '["typescript"]');
      insertObservation(db, 'project-c', '["rust"]');

      const patterns = service.detectGlobalPatterns();
      const ts = patterns.find(p => p.pattern === 'typescript');
      // 2 out of 3 projects = ~0.67
      expect(ts?.confidence).toBeCloseTo(0.67, 1);
    });

    it('sorts by number of projects descending', () => {
      insertObservation(db, 'project-a', '["typescript", "eslint"]');
      insertObservation(db, 'project-b', '["typescript", "eslint"]');
      insertObservation(db, 'project-c', '["typescript"]');

      const patterns = service.detectGlobalPatterns();
      expect(patterns[0].pattern).toBe('typescript');
      expect(patterns[0].projects).toHaveLength(3);
    });
  });

  // ─── promoteToGlobal ────────────────────────────────────────────────────

  describe('promoteToGlobal', () => {
    it('creates a global entity with _global: prefix', () => {
      const pattern: PromotablePattern = {
        pattern: 'typescript',
        projects: ['project-a', 'project-b'],
        confidence: 0.8,
      };

      service.promoteToGlobal(pattern);

      const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get('_global:typescript') as any;
      expect(entity).toBeTruthy();
      expect(entity.name).toBe('typescript');
      expect(entity.type).toBe('global_pattern');
    });

    it('creates a fact linking to global scope', () => {
      const pattern: PromotablePattern = {
        pattern: 'eslint',
        projects: ['project-a', 'project-b'],
        confidence: 0.75,
      };

      service.promoteToGlobal(pattern);

      const facts = db.prepare('SELECT * FROM facts WHERE subject = ?').all('_global:eslint') as any[];
      expect(facts).toHaveLength(1);
      expect(facts[0].predicate).toBe('observed_across_projects');
      expect(facts[0].confidence).toBeCloseTo(0.75);
    });

    it('stores project list in entity properties', () => {
      const pattern: PromotablePattern = {
        pattern: 'testing',
        projects: ['p1', 'p2', 'p3'],
        confidence: 1.0,
      };

      service.promoteToGlobal(pattern);

      const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get('_global:testing') as any;
      const props = JSON.parse(entity.properties);
      expect(props.projects).toEqual(['p1', 'p2', 'p3']);
      expect(props.confidence).toBe(1.0);
    });

    it('upserts on repeated promotion', () => {
      const pattern1: PromotablePattern = {
        pattern: 'typescript',
        projects: ['p1', 'p2'],
        confidence: 0.5,
      };
      const pattern2: PromotablePattern = {
        pattern: 'typescript',
        projects: ['p1', 'p2', 'p3'],
        confidence: 0.75,
      };

      service.promoteToGlobal(pattern1);
      service.promoteToGlobal(pattern2);

      const entities = db.prepare("SELECT * FROM entities WHERE id LIKE '_global:typescript'").all();
      expect(entities).toHaveLength(1);

      const props = JSON.parse((entities[0] as any).properties);
      expect(props.projects).toEqual(['p1', 'p2', 'p3']);
    });
  });

  // ─── getGlobalKnowledge ──────────────────────────────────────────────────

  describe('getGlobalKnowledge', () => {
    it('returns empty array when no global knowledge exists', () => {
      const knowledge = service.getGlobalKnowledge();
      expect(knowledge).toEqual([]);
    });

    it('returns promoted global entities with facts', () => {
      const pattern: PromotablePattern = {
        pattern: 'typescript',
        projects: ['p1', 'p2'],
        confidence: 0.8,
      };

      service.promoteToGlobal(pattern);

      const knowledge = service.getGlobalKnowledge();
      expect(knowledge).toHaveLength(1);
      expect((knowledge[0] as any).name).toBe('typescript');
      expect((knowledge[0] as any).type).toBe('global_pattern');
      expect((knowledge[0] as any).predicate).toBe('observed_across_projects');
    });

    it('ignores non-global entities', () => {
      // Insert a non-global entity
      db.prepare(`
        INSERT INTO entities (id, name, type) VALUES ('local:test', 'test', 'local')
      `).run();

      const knowledge = service.getGlobalKnowledge();
      expect(knowledge).toEqual([]);
    });

    it('returns multiple global knowledge entries', () => {
      service.promoteToGlobal({ pattern: 'typescript', projects: ['p1', 'p2'], confidence: 0.8 });
      service.promoteToGlobal({ pattern: 'eslint', projects: ['p1', 'p2'], confidence: 0.7 });

      const knowledge = service.getGlobalKnowledge();
      expect(knowledge).toHaveLength(2);
    });
  });
});
