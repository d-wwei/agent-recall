/**
 * Tests for TeamKnowledgeService — shared knowledge pages for team collaboration.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with all required tables
 *
 * Value: Verifies sharing, retrieval, and import of knowledge pages.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { TeamKnowledgeService } from '../../../src/services/collaboration/TeamKnowledgeService.js';
import type { SharedKnowledge } from '../../../src/services/collaboration/TeamKnowledgeService.js';

const PROJECT = 'test-project';

function createTestDb(): Database {
  const db = new Database(':memory:');

  db.exec(`
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

    CREATE TABLE shared_knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT,
      content TEXT,
      shared_by TEXT,
      project TEXT,
      shared_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}

function insertCompiledKnowledge(db: Database, project: string, topic: string, content: string): number {
  const result = db.prepare(`
    INSERT INTO compiled_knowledge (project, topic, content, compiled_at, created_at)
    VALUES (?, ?, ?, datetime('now'), datetime('now'))
  `).run(project, topic, content);
  return Number(result.lastInsertRowid);
}

describe('TeamKnowledgeService', () => {
  let db: Database;
  let service: TeamKnowledgeService;

  beforeEach(() => {
    db = createTestDb();
    service = new TeamKnowledgeService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── shareKnowledge ──────────────────────────────────────────────────────

  describe('shareKnowledge', () => {
    it('shares a compiled knowledge page and returns shared ID', () => {
      const ckId = insertCompiledKnowledge(db, PROJECT, 'Auth Module', 'How auth works');
      const sharedId = service.shareKnowledge(ckId, 'user-eli');

      expect(sharedId).toBeGreaterThan(0);

      const row = db.prepare('SELECT * FROM shared_knowledge WHERE id = ?').get(sharedId) as any;
      expect(row.topic).toBe('Auth Module');
      expect(row.content).toBe('How auth works');
      expect(row.shared_by).toBe('user-eli');
      expect(row.project).toBe(PROJECT);
    });

    it('throws when compiled knowledge ID does not exist', () => {
      expect(() => service.shareKnowledge(9999, 'user-eli')).toThrow('not found');
    });

    it('copies topic and content from compiled_knowledge', () => {
      const ckId = insertCompiledKnowledge(db, PROJECT, 'Database Layer', 'SQLite WAL mode details');
      service.shareKnowledge(ckId, 'user-bob');

      const rows = db.prepare('SELECT * FROM shared_knowledge WHERE project = ?').all(PROJECT) as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].topic).toBe('Database Layer');
      expect(rows[0].content).toBe('SQLite WAL mode details');
    });

    it('allows sharing the same knowledge multiple times', () => {
      const ckId = insertCompiledKnowledge(db, PROJECT, 'Config', 'Config guide');
      const id1 = service.shareKnowledge(ckId, 'user-a');
      const id2 = service.shareKnowledge(ckId, 'user-b');

      expect(id1).not.toBe(id2);
      const rows = db.prepare('SELECT * FROM shared_knowledge').all();
      expect(rows).toHaveLength(2);
    });
  });

  // ─── getSharedKnowledge ──────────────────────────────────────────────────

  describe('getSharedKnowledge', () => {
    it('returns empty array when no shared knowledge exists', () => {
      const results = service.getSharedKnowledge(PROJECT);
      expect(results).toEqual([]);
    });

    it('returns all shared knowledge for a project', () => {
      const ck1 = insertCompiledKnowledge(db, PROJECT, 'Topic A', 'Content A');
      const ck2 = insertCompiledKnowledge(db, PROJECT, 'Topic B', 'Content B');
      service.shareKnowledge(ck1, 'user-1');
      service.shareKnowledge(ck2, 'user-2');

      const results = service.getSharedKnowledge(PROJECT);
      expect(results).toHaveLength(2);
      expect(results.map(r => r.topic)).toContain('Topic A');
      expect(results.map(r => r.topic)).toContain('Topic B');
    });

    it('filters by project', () => {
      const ck1 = insertCompiledKnowledge(db, PROJECT, 'Mine', 'Content');
      const ck2 = insertCompiledKnowledge(db, 'other-project', 'Theirs', 'Content');
      service.shareKnowledge(ck1, 'user-1');
      service.shareKnowledge(ck2, 'user-2');

      const results = service.getSharedKnowledge(PROJECT);
      expect(results).toHaveLength(1);
      expect(results[0].topic).toBe('Mine');
    });

    it('returns correct SharedKnowledge shape', () => {
      const ckId = insertCompiledKnowledge(db, PROJECT, 'Test', 'Content');
      service.shareKnowledge(ckId, 'user-eli');

      const results = service.getSharedKnowledge(PROJECT);
      expect(results).toHaveLength(1);
      const sk = results[0];
      expect(sk).toHaveProperty('id');
      expect(sk).toHaveProperty('topic');
      expect(sk).toHaveProperty('content');
      expect(sk).toHaveProperty('sharedBy');
      expect(sk).toHaveProperty('project');
      expect(sk).toHaveProperty('sharedAt');
      expect(sk.sharedBy).toBe('user-eli');
    });
  });

  // ─── importShared ────────────────────────────────────────────────────────

  describe('importShared', () => {
    it('imports shared knowledge into compiled_knowledge', () => {
      const shared: SharedKnowledge = {
        id: 1,
        topic: 'Imported Topic',
        content: 'Imported Content',
        sharedBy: 'user-bob',
        project: PROJECT,
        sharedAt: new Date().toISOString(),
      };

      const newId = service.importShared(shared);
      expect(newId).toBeGreaterThan(0);

      const row = db.prepare('SELECT * FROM compiled_knowledge WHERE id = ?').get(newId) as any;
      expect(row.topic).toBe('Imported Topic');
      expect(row.content).toBe('Imported Content');
      expect(row.project).toBe(PROJECT);
      expect(row.confidence).toBe('medium');
    });

    it('creates a new entry without affecting existing compiled knowledge', () => {
      insertCompiledKnowledge(db, PROJECT, 'Existing', 'Existing content');

      const shared: SharedKnowledge = {
        id: 99,
        topic: 'New',
        content: 'New content',
        sharedBy: 'user-x',
        project: PROJECT,
        sharedAt: new Date().toISOString(),
      };

      service.importShared(shared);

      const rows = db.prepare('SELECT * FROM compiled_knowledge WHERE project = ?').all(PROJECT);
      expect(rows).toHaveLength(2);
    });

    it('round-trips: share then import preserves content', () => {
      const ckId = insertCompiledKnowledge(db, PROJECT, 'Round Trip', 'Original content');
      service.shareKnowledge(ckId, 'user-eli');

      const shared = service.getSharedKnowledge(PROJECT);
      expect(shared).toHaveLength(1);

      const importedId = service.importShared(shared[0]);
      const imported = db.prepare('SELECT * FROM compiled_knowledge WHERE id = ?').get(importedId) as any;
      expect(imported.topic).toBe('Round Trip');
      expect(imported.content).toBe('Original content');
    });
  });
});
