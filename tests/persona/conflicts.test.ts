/**
 * Persona Conflict Detection & Resolution tests
 *
 * Tests PersonaService.detectConflicts() and resolveConflict() using in-memory SQLite.
 * Validates proactive detection of divergent fields between global and project profiles.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { PersonaService } from '../../src/services/persona/PersonaService.js';
import type { Database } from 'bun:sqlite';

describe('Persona Conflict Detection', () => {
  let db: Database;
  let service: PersonaService;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    service = new PersonaService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('detectConflicts', () => {
    it('should return empty array when only global profile exists', () => {
      service.setProfile('global', 'user', { name: 'Alice', role: 'engineer' });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toEqual([]);
    });

    it('should return empty array when project values match global', () => {
      service.setProfile('global', 'user', { name: 'Alice', role: 'engineer' });
      service.setProfile('my-project', 'user', { name: 'Alice', role: 'engineer' });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toEqual([]);
    });

    it('should detect conflict when project overrides a global field', () => {
      service.setProfile('global', 'style', { tone: 'formal', brevity: 'concise' });
      service.setProfile('my-project', 'style', { tone: 'casual' });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toEqual({
        profile_type: 'style',
        field: 'tone',
        global_value: 'formal',
        project_value: 'casual',
      });
    });

    it('should detect multiple conflicts across profile types', () => {
      service.setProfile('global', 'user', { name: 'Alice', role: 'engineer' });
      service.setProfile('my-project', 'user', { name: 'Alice', role: 'designer' });

      service.setProfile('global', 'style', { tone: 'formal' });
      service.setProfile('my-project', 'style', { tone: 'casual' });

      service.setProfile('global', 'workflow', { preferred_role: 'reviewer' });
      service.setProfile('my-project', 'workflow', { preferred_role: 'author' });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toHaveLength(3);

      const profileTypes = conflicts.map(c => c.profile_type);
      expect(profileTypes).toContain('user');
      expect(profileTypes).toContain('style');
      expect(profileTypes).toContain('workflow');

      const fields = conflicts.map(c => c.field);
      expect(fields).toContain('role');
      expect(fields).toContain('tone');
      expect(fields).toContain('preferred_role');
    });

    it('should ignore agent_soul conflicts', () => {
      service.setProfile('global', 'agent_soul', { name: 'Atlas', vibe: 'calm' });
      service.setProfile('my-project', 'agent_soul', { name: 'Hermes', vibe: 'energetic' });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toEqual([]);
    });

    it('should ignore empty/null fields', () => {
      service.setProfile('global', 'user', { name: 'Alice', role: 'engineer', language: '' });
      service.setProfile('my-project', 'user', { name: 'Bob', role: null as any, language: 'French' });

      const conflicts = service.detectConflicts('my-project');
      // name differs (both non-empty) -> conflict
      // role: project is null -> skip
      // language: global is '' -> skip
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].field).toBe('name');
    });

    it('should return empty array when project is empty string', () => {
      service.setProfile('global', 'user', { name: 'Alice' });
      const conflicts = service.detectConflicts('');
      expect(conflicts).toEqual([]);
    });

    it('should handle array field conflicts via JSON comparison', () => {
      service.setProfile('global', 'style', { disliked_phrasing: ['honestly', 'basically'] });
      service.setProfile('my-project', 'style', { disliked_phrasing: ['honestly', 'actually'] });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].field).toBe('disliked_phrasing');
      expect(conflicts[0].global_value).toEqual(['honestly', 'basically']);
      expect(conflicts[0].project_value).toEqual(['honestly', 'actually']);
    });

    it('should not report conflict when array values are identical', () => {
      service.setProfile('global', 'workflow', { recurring_tasks: ['deploy', 'review'] });
      service.setProfile('my-project', 'workflow', { recurring_tasks: ['deploy', 'review'] });

      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toEqual([]);
    });
  });

  describe('resolveConflict', () => {
    it('should remove project field with keep_global', () => {
      service.setProfile('global', 'style', { tone: 'formal', brevity: 'concise' });
      service.setProfile('my-project', 'style', { tone: 'casual', brevity: 'verbose' });

      service.resolveConflict('my-project', 'style', 'tone', 'keep_global');

      // Project profile should no longer have the tone field
      const projectProfile = service.getProfile('my-project', 'style');
      expect(projectProfile).toBeDefined();
      expect(projectProfile!.tone).toBeUndefined();
      // Other fields should remain
      expect(projectProfile!.brevity).toBe('verbose');

      // Global should be unchanged
      const globalProfile = service.getProfile('global', 'style');
      expect(globalProfile!.tone).toBe('formal');

      // No more conflicts on tone
      const conflicts = service.detectConflicts('my-project');
      const toneConflicts = conflicts.filter(c => c.field === 'tone');
      expect(toneConflicts).toHaveLength(0);
    });

    it('should update global to match project with keep_project', () => {
      service.setProfile('global', 'user', { name: 'Alice', role: 'engineer' });
      service.setProfile('my-project', 'user', { role: 'designer' });

      service.resolveConflict('my-project', 'user', 'role', 'keep_project');

      // Global should now match project
      const globalProfile = service.getProfile('global', 'user');
      expect(globalProfile!.role).toBe('designer');
      // Other global fields should remain
      expect(globalProfile!.name).toBe('Alice');

      // No more conflicts on role
      const conflicts = service.detectConflicts('my-project');
      const roleConflicts = conflicts.filter(c => c.field === 'role');
      expect(roleConflicts).toHaveLength(0);
    });

    it('should set both profiles to custom value with custom resolution', () => {
      service.setProfile('global', 'style', { tone: 'formal' });
      service.setProfile('my-project', 'style', { tone: 'casual' });

      service.resolveConflict('my-project', 'style', 'tone', 'custom', 'balanced');

      const globalProfile = service.getProfile('global', 'style');
      expect(globalProfile!.tone).toBe('balanced');

      const projectProfile = service.getProfile('my-project', 'style');
      expect(projectProfile!.tone).toBe('balanced');

      // No more conflicts
      const conflicts = service.detectConflicts('my-project');
      expect(conflicts).toEqual([]);
    });

    it('should handle resolving when project profile does not exist yet', () => {
      service.setProfile('global', 'user', { name: 'Alice' });

      // Resolving keep_global on a nonexistent project profile should not throw
      service.resolveConflict('my-project', 'user', 'name', 'keep_global');

      // Project profile should be created (empty with the field removed — effectively empty)
      const projectProfile = service.getProfile('my-project', 'user');
      expect(projectProfile).toBeDefined();
      expect(projectProfile!.name).toBeUndefined();
    });

    it('should resolve conflict then getMergedPersona reflects the resolution', () => {
      service.setProfile('global', 'style', { tone: 'formal', brevity: 'concise' });
      service.setProfile('my-project', 'style', { tone: 'casual' });

      // Before resolution: merged uses project value
      let merged = service.getMergedPersona('my-project');
      expect((merged.style as any).tone).toBe('casual');

      // Resolve with keep_global
      service.resolveConflict('my-project', 'style', 'tone', 'keep_global');

      // After resolution: merged uses global value (since project field was removed)
      merged = service.getMergedPersona('my-project');
      expect((merged.style as any).tone).toBe('formal');
    });
  });
});
