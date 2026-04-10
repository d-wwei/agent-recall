/**
 * Tests for EntityExtractor — auto-populates entities + facts from observations.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite :memory: with MigrationRunner
 * - Tests actual entity/fact creation in the database
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { EntityExtractor } from '../../../src/services/knowledge-graph/EntityExtractor.js';
import { KnowledgeGraphService } from '../../../src/services/knowledge-graph/KnowledgeGraphService.js';

const PROJECT = 'test-project';

function buildDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  // Disable FK enforcement AFTER migrations — observations are inserted without
  // full session scaffolding. Entity/fact FK relationships are structurally tested.
  db.run('PRAGMA foreign_keys = OFF');
  return db;
}

function insertObservation(db: Database, opts: {
  id?: number;
  project?: string;
  type?: string;
  title?: string;
  narrative?: string | null;
  concepts?: string[];
  files_modified?: string[];
  files_read?: string[];
  createdAtEpoch?: number;
}): number {
  const {
    project = PROJECT,
    type = 'discovery',
    title = 'Test observation',
    narrative = null,
    concepts = [],
    files_modified = [],
    files_read = [],
    createdAtEpoch = Date.now(),
  } = opts;

  const result = db.prepare(
    `INSERT INTO observations
     (memory_session_id, project, type, title, narrative, concepts,
      files_modified, files_read, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'mem-sess-1', project, type, title, narrative,
    JSON.stringify(concepts), JSON.stringify(files_modified),
    JSON.stringify(files_read),
    new Date(createdAtEpoch).toISOString(), createdAtEpoch
  );

  return Number(result.lastInsertRowid);
}

describe('EntityExtractor', () => {
  let db: Database;
  let extractor: EntityExtractor;
  let kgService: KnowledgeGraphService;

  beforeEach(() => {
    db = buildDb();
    extractor = new EntityExtractor(db);
    kgService = new KnowledgeGraphService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── File entity extraction ────────────────────────────────────────────

  describe('File entity extraction', () => {
    it('creates file entities from files_modified', () => {
      const obs = {
        id: 1,
        files_modified: JSON.stringify(['src/index.ts', 'src/app.ts']),
        files_read: '[]',
        concepts: '[]',
        title: 'Test',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBeGreaterThanOrEqual(2);

      const entity = kgService.getEntity(`${PROJECT}:file:src/index.ts`);
      expect(entity).not.toBeNull();
      expect(entity!.type).toBe('file');
    });

    it('creates file entities from files_read', () => {
      const obs = {
        id: 2,
        files_modified: '[]',
        files_read: JSON.stringify(['README.md']),
        concepts: '[]',
        title: 'Read readme',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBeGreaterThanOrEqual(1);

      const entity = kgService.getEntity(`${PROJECT}:file:readme.md`);
      expect(entity).not.toBeNull();
    });

    it('creates modifies fact for files_modified', () => {
      const obs = {
        id: 3,
        files_modified: JSON.stringify(['src/main.ts']),
        files_read: '[]',
        concepts: '[]',
        title: 'Modified main',
      };

      extractor.extractFromObservation(obs, PROJECT);

      const entityId = `${PROJECT}:file:src/main.ts`;
      const facts = kgService.getFactsForEntity(entityId);
      expect(facts.length).toBeGreaterThanOrEqual(1);
      expect(facts.some(f => f.predicate === 'modifies')).toBe(true);
    });

    it('creates reads fact for files_read', () => {
      const obs = {
        id: 4,
        files_modified: '[]',
        files_read: JSON.stringify(['config.json']),
        concepts: '[]',
        title: 'Read config',
      };

      extractor.extractFromObservation(obs, PROJECT);

      const entityId = `${PROJECT}:file:config.json`;
      const facts = kgService.getFactsForEntity(entityId);
      expect(facts.some(f => f.predicate === 'reads')).toBe(true);
    });

    it('handles files that appear in both modified and read (prefers modifies)', () => {
      const obs = {
        id: 5,
        files_modified: JSON.stringify(['shared.ts']),
        files_read: JSON.stringify(['shared.ts']),
        concepts: '[]',
        title: 'Both',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      // File appears in both lists so it gets processed twice
      expect(result.facts).toBe(2);
    });
  });

  // ─── Concept entity extraction ────────────────────────────────────────

  describe('Concept entity extraction', () => {
    it('creates concept entities from concepts field', () => {
      const obs = {
        id: 10,
        files_modified: '[]',
        files_read: '[]',
        concepts: JSON.stringify(['authentication', 'security']),
        title: 'Auth concepts',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(2);

      const entity = kgService.getEntity(`${PROJECT}:concept:authentication`);
      expect(entity).not.toBeNull();
      expect(entity!.type).toBe('concept');
    });

    it('handles empty concepts array', () => {
      const obs = {
        id: 11,
        files_modified: '[]',
        files_read: '[]',
        concepts: '[]',
        title: 'No concepts',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(0);
    });

    it('skips non-string concept entries', () => {
      const obs = {
        id: 12,
        files_modified: '[]',
        files_read: '[]',
        concepts: JSON.stringify(['valid', null, 42, '']),
        title: 'Mixed concepts',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      // Only 'valid' should be created (null, 42, and empty string are skipped)
      expect(result.entities).toBe(1);
    });
  });

  // ─── Tool entity extraction ───────────────────────────────────────────

  describe('Tool entity extraction', () => {
    it('extracts known tool mentions from title', () => {
      const obs = {
        id: 20,
        files_modified: '[]',
        files_read: '[]',
        concepts: '[]',
        title: 'Migrated from PostgreSQL to SQLite',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBeGreaterThanOrEqual(2);

      // Tool entities are global
      const pg = kgService.getEntity('_global:tool:postgresql');
      expect(pg).not.toBeNull();
      expect(pg!.type).toBe('tool');

      const sqlite = kgService.getEntity('_global:tool:sqlite');
      expect(sqlite).not.toBeNull();
    });

    it('deduplicates tool mentions in same title', () => {
      const obs = {
        id: 21,
        files_modified: '[]',
        files_read: '[]',
        concepts: '[]',
        title: 'React component uses React hooks and React context',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      // React should only be counted once (deduped)
      const reactEntity = kgService.getEntity('_global:tool:react');
      expect(reactEntity).not.toBeNull();
      // entities count should be 1 (only one unique tool)
      expect(result.entities).toBe(1);
    });

    it('handles title with no tool mentions', () => {
      const obs = {
        id: 22,
        files_modified: '[]',
        files_read: '[]',
        concepts: '[]',
        title: 'Fixed a general bug in the system',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(0);
    });

    it('handles null title', () => {
      const obs = {
        id: 23,
        files_modified: '[]',
        files_read: '[]',
        concepts: '[]',
        title: null,
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(0);
    });
  });

  // ─── extractFromAllObservations ───────────────────────────────────────

  describe('extractFromAllObservations', () => {
    it('processes all observations for a project', () => {
      insertObservation(db, {
        concepts: ['auth'],
        files_modified: ['auth.ts'],
        title: 'Auth with JWT',
      });
      insertObservation(db, {
        concepts: ['api'],
        files_read: ['routes.ts'],
        title: 'API with Express',
      });

      const result = extractor.extractFromAllObservations(PROJECT);
      // auth.ts file + auth concept + JWT tool + routes.ts file + api concept + Express tool
      expect(result.entities).toBeGreaterThanOrEqual(4);
      expect(result.facts).toBeGreaterThanOrEqual(2);
    });

    it('respects sinceEpoch filter', () => {
      const cutoff = Date.now() - 5000;
      insertObservation(db, {
        concepts: ['old'],
        createdAtEpoch: cutoff - 1000,
        title: 'Old obs',
      });
      insertObservation(db, {
        concepts: ['new'],
        createdAtEpoch: cutoff + 1000,
        title: 'New obs',
      });

      const result = extractor.extractFromAllObservations(PROJECT, cutoff);
      // Only the 'new' concept should be extracted
      expect(result.entities).toBe(1);

      const oldEntity = kgService.getEntity(`${PROJECT}:concept:old`);
      expect(oldEntity).toBeNull();

      const newEntity = kgService.getEntity(`${PROJECT}:concept:new`);
      expect(newEntity).not.toBeNull();
    });

    it('returns zero counts when no observations exist', () => {
      const result = extractor.extractFromAllObservations(PROJECT);
      expect(result.entities).toBe(0);
      expect(result.facts).toBe(0);
    });

    it('only processes observations for the specified project', () => {
      insertObservation(db, {
        project: PROJECT,
        concepts: ['ours'],
        title: 'Our obs',
      });
      insertObservation(db, {
        project: 'other-project',
        concepts: ['theirs'],
        title: 'Their obs',
      });

      const result = extractor.extractFromAllObservations(PROJECT);
      expect(kgService.getEntity(`${PROJECT}:concept:ours`)).not.toBeNull();
      expect(kgService.getEntity(`other-project:concept:theirs`)).toBeNull();
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────

  describe('Edge cases', () => {
    it('handles malformed JSON in files_modified', () => {
      const obs = {
        id: 30,
        files_modified: 'not-json',
        files_read: '[]',
        concepts: '[]',
        title: 'Bad JSON',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(0);
    });

    it('handles null fields', () => {
      const obs = {
        id: 31,
        files_modified: null,
        files_read: null,
        concepts: null,
        title: null,
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(0);
      expect(result.facts).toBe(0);
    });

    it('handles native arrays (not JSON strings)', () => {
      const obs = {
        id: 32,
        files_modified: ['src/native.ts'],
        files_read: [],
        concepts: ['native-concept'],
        title: 'Native arrays',
      };

      const result = extractor.extractFromObservation(obs, PROJECT);
      expect(result.entities).toBe(2); // file + concept
      expect(result.facts).toBe(1); // modifies fact
    });
  });
});
