/**
 * Tests for KnowledgeGraphService
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual SQL logic
 * - Validates entity/fact CRUD, temporal queries, and entity resolution
 *
 * Coverage: 20+ tests across 5 sections
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { KnowledgeGraphService } from '../../../src/services/knowledge-graph/KnowledgeGraphService.js';

function buildDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  return db;
}

describe('KnowledgeGraphService', () => {
  let db: Database;
  let svc: KnowledgeGraphService;

  beforeEach(() => {
    db = buildDb();
    svc = new KnowledgeGraphService(db);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // Entity CRUD
  // ---------------------------------------------------------------------------

  describe('Entity CRUD', () => {
    it('upsertEntity — inserts a new entity', () => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      const entity = svc.getEntity('proj:person:alice');
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('Alice');
      expect(entity!.type).toBe('person');
    });

    it('upsertEntity — stores properties as JSON', () => {
      svc.upsertEntity('proj:person:bob', 'Bob', 'person', { age: 30, role: 'engineer' });
      const entity = svc.getEntity('proj:person:bob');
      expect(entity).not.toBeNull();
      const props = JSON.parse(entity!.properties);
      expect(props.age).toBe(30);
      expect(props.role).toBe('engineer');
    });

    it('upsertEntity — updates name and type on second call', () => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      svc.upsertEntity('proj:person:alice', 'Alice Smith', 'employee');
      const entity = svc.getEntity('proj:person:alice');
      expect(entity!.name).toBe('Alice Smith');
      expect(entity!.type).toBe('employee');
    });

    it('upsertEntity — preserves first_seen_at on update', () => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      const before = svc.getEntity('proj:person:alice')!.first_seen_at;

      // Small artificial delay to guarantee timestamps differ
      const start = Date.now();
      while (Date.now() - start < 5) { /* busy-wait */ }

      svc.upsertEntity('proj:person:alice', 'Alice Updated', 'person');
      const after = svc.getEntity('proj:person:alice')!.first_seen_at;
      expect(after).toBe(before);
    });

    it('upsertEntity — updates last_seen_at on second call', () => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      const first = svc.getEntity('proj:person:alice')!.last_seen_at;

      const start = Date.now();
      while (Date.now() - start < 5) { /* busy-wait */ }

      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      const second = svc.getEntity('proj:person:alice')!.last_seen_at;
      expect(second! >= first!).toBe(true);
    });

    it('getEntity — returns null for unknown id', () => {
      expect(svc.getEntity('no:such:entity')).toBeNull();
    });

    it('getEntitiesByType — returns only matching type', () => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      svc.upsertEntity('proj:person:bob', 'Bob', 'person');
      svc.upsertEntity('proj:org:acme', 'ACME', 'organization');

      const people = svc.getEntitiesByType('person');
      expect(people.length).toBe(2);
      expect(people.map(e => e.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('getEntitiesByType — returns empty array when type absent', () => {
      const results = svc.getEntitiesByType('nonexistent_type');
      expect(results).toEqual([]);
    });

    it('getEntitiesByType — returns entities ordered by name', () => {
      svc.upsertEntity('proj:person:charlie', 'Charlie', 'person');
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      svc.upsertEntity('proj:person:bob', 'Bob', 'person');

      const people = svc.getEntitiesByType('person');
      expect(people.map(e => e.name)).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  // ---------------------------------------------------------------------------
  // Fact CRUD
  // ---------------------------------------------------------------------------

  describe('Fact CRUD', () => {
    beforeEach(() => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      svc.upsertEntity('proj:person:bob', 'Bob', 'person');
      svc.upsertEntity('proj:org:acme', 'ACME', 'organization');
    });

    it('addFact — inserts a fact', () => {
      svc.addFact('fact-1', 'proj:person:alice', 'works_at', 'proj:org:acme');
      const facts = svc.getFactsForEntity('proj:person:alice');
      expect(facts.length).toBe(1);
      expect(facts[0].predicate).toBe('works_at');
    });

    it('addFact — stores default confidence 1.0', () => {
      svc.addFact('fact-2', 'proj:person:alice', 'knows', 'proj:person:bob');
      const facts = svc.getFactsForEntity('proj:person:alice');
      expect(facts[0].confidence).toBe(1.0);
    });

    it('addFact — stores custom confidence', () => {
      svc.addFact('fact-3', 'proj:person:alice', 'knows', 'proj:person:bob', 0.7);
      const facts = svc.getFactsForEntity('proj:person:alice');
      expect(facts[0].confidence).toBe(0.7);
    });

    it('addFact — stores source_observation_id', () => {
      svc.addFact('fact-4', 'proj:person:alice', 'works_at', 'proj:org:acme', 1.0, 42);
      const facts = svc.getFactsForEntity('proj:person:alice');
      expect(facts[0].source_observation_id).toBe(42);
    });

    it('getFactsForEntity — returns facts where entity is object', () => {
      svc.addFact('fact-5', 'proj:person:bob', 'member_of', 'proj:org:acme');
      const facts = svc.getFactsForEntity('proj:org:acme');
      expect(facts.length).toBe(1);
      expect(facts[0].id).toBe('fact-5');
    });

    it('getFactsForEntity — returns empty array when no facts', () => {
      expect(svc.getFactsForEntity('proj:person:alice')).toEqual([]);
    });

    it('getFactsByPredicate — returns only matching predicate', () => {
      svc.addFact('fact-6', 'proj:person:alice', 'works_at', 'proj:org:acme');
      svc.addFact('fact-7', 'proj:person:bob', 'works_at', 'proj:org:acme');
      svc.addFact('fact-8', 'proj:person:alice', 'knows', 'proj:person:bob');

      const worksAt = svc.getFactsByPredicate('works_at');
      expect(worksAt.length).toBe(2);
      expect(worksAt.every(f => f.predicate === 'works_at')).toBe(true);
    });

    it('getFactsByPredicate — returns empty array when predicate absent', () => {
      expect(svc.getFactsByPredicate('no_such_predicate')).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // Temporal queries
  // ---------------------------------------------------------------------------

  describe('Temporal queries', () => {
    beforeEach(() => {
      svc.upsertEntity('proj:person:alice', 'Alice', 'person');
      svc.upsertEntity('proj:org:acme', 'ACME', 'organization');
    });

    it('getFactsValidAt — returns fact with no temporal bounds', () => {
      svc.addFact('tf-1', 'proj:person:alice', 'works_at', 'proj:org:acme');
      const facts = svc.getFactsValidAt('proj:person:alice', new Date());
      expect(facts.length).toBe(1);
    });

    it('getFactsValidAt — returns fact when date is within valid range', () => {
      db.prepare(
        `INSERT INTO facts (id, subject, predicate, object, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('tf-2', 'proj:person:alice', 'works_at', 'proj:org:acme',
        '2020-01-01T00:00:00.000Z', '2030-01-01T00:00:00.000Z');

      const facts = svc.getFactsValidAt('proj:person:alice', new Date('2025-06-01'));
      expect(facts.length).toBe(1);
    });

    it('getFactsValidAt — excludes fact before valid_from', () => {
      db.prepare(
        `INSERT INTO facts (id, subject, predicate, object, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('tf-3', 'proj:person:alice', 'works_at', 'proj:org:acme',
        '2025-01-01T00:00:00.000Z', null);

      const facts = svc.getFactsValidAt('proj:person:alice', new Date('2020-01-01'));
      expect(facts.length).toBe(0);
    });

    it('getFactsValidAt — excludes fact after valid_to', () => {
      db.prepare(
        `INSERT INTO facts (id, subject, predicate, object, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('tf-4', 'proj:person:alice', 'works_at', 'proj:org:acme',
        '2020-01-01T00:00:00.000Z', '2021-01-01T00:00:00.000Z');

      const facts = svc.getFactsValidAt('proj:person:alice', new Date('2025-06-01'));
      expect(facts.length).toBe(0);
    });

    it('getFactsValidAt — includes only temporally valid facts from multiple', () => {
      db.prepare(
        `INSERT INTO facts (id, subject, predicate, object, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('tf-5a', 'proj:person:alice', 'role', 'proj:org:acme',
        '2020-01-01T00:00:00.000Z', '2022-01-01T00:00:00.000Z');
      db.prepare(
        `INSERT INTO facts (id, subject, predicate, object, valid_from, valid_to)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run('tf-5b', 'proj:person:alice', 'role', 'proj:org:acme',
        '2022-01-01T00:00:00.000Z', null);

      // At 2021 only tf-5a is valid
      const in2021 = svc.getFactsValidAt('proj:person:alice', new Date('2021-06-01'));
      expect(in2021.map(f => f.id)).toContain('tf-5a');
      expect(in2021.map(f => f.id)).not.toContain('tf-5b');

      // At 2023 only tf-5b is valid
      const in2023 = svc.getFactsValidAt('proj:person:alice', new Date('2023-06-01'));
      expect(in2023.map(f => f.id)).toContain('tf-5b');
      expect(in2023.map(f => f.id)).not.toContain('tf-5a');
    });
  });

  // ---------------------------------------------------------------------------
  // Entity resolution
  // ---------------------------------------------------------------------------

  describe('Entity resolution', () => {
    it('resolveEntityId — returns project-scoped id by default', () => {
      const id = svc.resolveEntityId('my-project', 'person', 'Alice');
      expect(id).toBe('my-project:person:alice');
    });

    it('resolveEntityId — returns global id when isGlobal=true', () => {
      const id = svc.resolveEntityId('my-project', 'person', 'Alice', true);
      expect(id).toBe('_global:person:alice');
    });

    it('resolveEntityId — normalizes name to lowercase', () => {
      const id = svc.resolveEntityId('proj', 'org', 'ACME Corp');
      expect(id).toBe('proj:org:acme_corp');
    });

    it('resolveEntityId — collapses internal whitespace to underscores', () => {
      const id = svc.resolveEntityId('proj', 'topic', 'machine   learning');
      expect(id).toBe('proj:topic:machine_learning');
    });

    it('resolveEntityId — trims leading and trailing whitespace', () => {
      const id = svc.resolveEntityId('proj', 'person', '  Bob  ');
      expect(id).toBe('proj:person:bob');
    });

    it('resolveEntityId — global scope ignores project arg', () => {
      const id1 = svc.resolveEntityId('project-a', 'tool', 'SQLite', true);
      const id2 = svc.resolveEntityId('project-b', 'tool', 'SQLite', true);
      expect(id1).toBe(id2);
    });

    it('resolveEntityId — project-scoped ids differ per project', () => {
      const id1 = svc.resolveEntityId('project-a', 'person', 'Alice');
      const id2 = svc.resolveEntityId('project-b', 'person', 'Alice');
      expect(id1).not.toBe(id2);
    });

    it('resolveEntityId — round-trips through upsertEntity and getEntity', () => {
      const id = svc.resolveEntityId('proj', 'person', 'Alice Wonderland');
      svc.upsertEntity(id, 'Alice Wonderland', 'person');
      const entity = svc.getEntity(id);
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('Alice Wonderland');
    });
  });

  // ---------------------------------------------------------------------------
  // Schema guard — tables are created by migration runner
  // ---------------------------------------------------------------------------

  describe('Schema guard', () => {
    it('entities table exists after migrations', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entities'")
        .get() as { name: string } | null;
      expect(row).not.toBeNull();
      expect(row!.name).toBe('entities');
    });

    it('facts table exists after migrations', () => {
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='facts'")
        .get() as { name: string } | null;
      expect(row).not.toBeNull();
      expect(row!.name).toBe('facts');
    });

    it('migration versions 34 and 35 are recorded', () => {
      const v34 = db
        .prepare('SELECT version FROM schema_versions WHERE version = 34')
        .get() as { version: number } | null;
      const v35 = db
        .prepare('SELECT version FROM schema_versions WHERE version = 35')
        .get() as { version: number } | null;
      expect(v34).not.toBeNull();
      expect(v35).not.toBeNull();
    });
  });
});
