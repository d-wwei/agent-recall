/**
 * Tests for TemplateService - CRUD, project merging, defaults, idempotency
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual SQL
 * - Validates template CRUD, scoping, and default seeding
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MigrationRunner } from '../../src/services/sqlite/migrations/runner.js';
import { TemplateService } from '../../src/services/template/TemplateService.js';
import type { Template } from '../../src/services/template/TemplateService.js';

describe('TemplateService', () => {
  let db: Database;
  let service: TemplateService;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');

    const runner = new MigrationRunner(db);
    runner.runAllMigrations();

    service = new TemplateService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('create and list', () => {
    it('should create a template and list it', () => {
      const created = service.create({
        name: 'test-template',
        content: '# Test\n\nHello world',
        category: 'report',
        description: 'A test template',
      });

      expect(created.name).toBe('test-template');
      expect(created.scope).toBe('global');
      expect(created.category).toBe('report');
      expect(created.content).toBe('# Test\n\nHello world');
      expect(created.description).toBe('A test template');
      expect(created.id).toBeGreaterThan(0);
      expect(created.created_at).toBeTruthy();
      expect(created.created_at_epoch).toBeGreaterThan(0);

      const all = service.list();
      expect(all.length).toBeGreaterThanOrEqual(1);
      expect(all.some(t => t.name === 'test-template')).toBe(true);
    });

    it('should filter by scope', () => {
      service.create({ name: 'g1', content: 'global one', scope: 'global' });
      service.create({ name: 'p1', content: 'project one', scope: 'my-project' });

      const globalOnly = service.list('global');
      expect(globalOnly.some(t => t.name === 'g1')).toBe(true);
      expect(globalOnly.some(t => t.name === 'p1')).toBe(false);

      const projectOnly = service.list('my-project');
      expect(projectOnly.some(t => t.name === 'p1')).toBe(true);
      expect(projectOnly.some(t => t.name === 'g1')).toBe(false);
    });

    it('should filter by category', () => {
      service.create({ name: 'r1', content: 'report', category: 'report' });
      service.create({ name: 'm1', content: 'meeting', category: 'meeting' });

      const reports = service.list(undefined, 'report');
      expect(reports.some(t => t.name === 'r1')).toBe(true);
      expect(reports.some(t => t.name === 'm1')).toBe(false);
    });
  });

  describe('get by scope + name', () => {
    it('should get a specific template', () => {
      service.create({ name: 'find-me', content: 'found!', scope: 'global' });
      const result = service.get('global', 'find-me');
      expect(result).not.toBeNull();
      expect(result!.content).toBe('found!');
    });

    it('should return null for non-existent template', () => {
      const result = service.get('global', 'does-not-exist');
      expect(result).toBeNull();
    });

    it('should distinguish between scopes', () => {
      service.create({ name: 'same-name', content: 'global version', scope: 'global' });
      service.create({ name: 'same-name', content: 'project version', scope: 'my-project' });

      const global = service.get('global', 'same-name');
      const project = service.get('my-project', 'same-name');

      expect(global!.content).toBe('global version');
      expect(project!.content).toBe('project version');
    });
  });

  describe('update', () => {
    it('should update template content', () => {
      service.create({ name: 'updatable', content: 'original', scope: 'global' });

      const updated = service.update('global', 'updatable', { content: 'modified' });
      expect(updated).not.toBeNull();
      expect(updated!.content).toBe('modified');
      expect(updated!.updated_at).toBeTruthy();
      expect(updated!.updated_at_epoch).toBeGreaterThan(0);
    });

    it('should update category without changing content', () => {
      service.create({ name: 'cat-change', content: 'keep this', category: 'report', scope: 'global' });

      const updated = service.update('global', 'cat-change', { category: 'meeting' });
      expect(updated!.category).toBe('meeting');
      expect(updated!.content).toBe('keep this');
    });

    it('should update description', () => {
      service.create({ name: 'desc-change', content: 'content', description: 'old desc', scope: 'global' });

      const updated = service.update('global', 'desc-change', { description: 'new desc' });
      expect(updated!.description).toBe('new desc');
    });

    it('should return null for non-existent template', () => {
      const result = service.update('global', 'ghost', { content: 'nope' });
      expect(result).toBeNull();
    });
  });

  describe('delete', () => {
    it('should delete an existing template', () => {
      service.create({ name: 'doomed', content: 'bye', scope: 'global' });

      const deleted = service.delete('global', 'doomed');
      expect(deleted).toBe(true);

      const check = service.get('global', 'doomed');
      expect(check).toBeNull();
    });

    it('should return false for non-existent template', () => {
      const deleted = service.delete('global', 'never-existed');
      expect(deleted).toBe(false);
    });
  });

  describe('getForProject', () => {
    it('should return merged results with project overriding global', () => {
      service.create({ name: 'shared', content: 'global version', scope: 'global' });
      service.create({ name: 'shared', content: 'project version', scope: 'proj-a' });
      service.create({ name: 'global-only', content: 'only in global', scope: 'global' });
      service.create({ name: 'project-only', content: 'only in project', scope: 'proj-a' });

      const merged = service.getForProject('proj-a');

      // 'shared' should be the project version
      const shared = merged.find(t => t.name === 'shared');
      expect(shared).not.toBeUndefined();
      expect(shared!.content).toBe('project version');
      expect(shared!.scope).toBe('proj-a');

      // 'global-only' should still be present
      expect(merged.some(t => t.name === 'global-only')).toBe(true);

      // 'project-only' should be present
      expect(merged.some(t => t.name === 'project-only')).toBe(true);
    });

    it('should return only global templates when project has none', () => {
      service.create({ name: 'g1', content: 'global', scope: 'global' });
      const merged = service.getForProject('empty-project');

      expect(merged.some(t => t.name === 'g1')).toBe(true);
    });
  });

  describe('ensureDefaults', () => {
    it('should create default templates', () => {
      TemplateService.ensureDefaults(db);

      const weeklyReport = service.get('global', 'weekly-report');
      expect(weeklyReport).not.toBeNull();
      expect(weeklyReport!.category).toBe('report');
      expect(weeklyReport!.content).toContain('Weekly Progress Report');

      const meetingNotes = service.get('global', 'meeting-notes');
      expect(meetingNotes).not.toBeNull();
      expect(meetingNotes!.category).toBe('meeting');

      const sessionHandoff = service.get('global', 'session-handoff');
      expect(sessionHandoff).not.toBeNull();
      expect(sessionHandoff!.category).toBe('report');
    });

    it('should be idempotent - running twice does not duplicate or error', () => {
      TemplateService.ensureDefaults(db);
      TemplateService.ensureDefaults(db);

      const all = service.list('global');
      const weeklyCount = all.filter(t => t.name === 'weekly-report').length;
      expect(weeklyCount).toBe(1);
    });

    it('should not overwrite existing customized templates', () => {
      // Create a custom version first
      service.create({
        name: 'weekly-report',
        content: 'My custom weekly report',
        scope: 'global',
        category: 'report',
      });

      // ensureDefaults should not overwrite
      TemplateService.ensureDefaults(db);

      const wr = service.get('global', 'weekly-report');
      expect(wr!.content).toBe('My custom weekly report');
    });
  });

  describe('unique constraint', () => {
    it('should reject duplicate scope + name', () => {
      service.create({ name: 'unique-test', content: 'first', scope: 'global' });

      expect(() => {
        service.create({ name: 'unique-test', content: 'second', scope: 'global' });
      }).toThrow();
    });

    it('should allow same name in different scopes', () => {
      service.create({ name: 'same-name', content: 'global', scope: 'global' });
      service.create({ name: 'same-name', content: 'project', scope: 'my-project' });

      const g = service.get('global', 'same-name');
      const p = service.get('my-project', 'same-name');
      expect(g!.content).toBe('global');
      expect(p!.content).toBe('project');
    });
  });
});
