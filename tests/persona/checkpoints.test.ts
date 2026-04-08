/**
 * Task Checkpoint / Breakpoint tests
 *
 * Tests PersonaService checkpoint methods using in-memory SQLite database.
 * Validates milestone tracking for multi-step tasks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { PersonaService } from '../../src/services/persona/PersonaService.js';
import type { Database } from 'bun:sqlite';
import type { TaskCheckpoint } from '../../src/services/persona/PersonaTypes.js';

describe('Task Checkpoints', () => {
  let db: Database;
  let service: PersonaService;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    service = new PersonaService(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('getTaskCheckpoints', () => {
    it('should return empty array when no active task exists', () => {
      const checkpoints = service.getTaskCheckpoints('nonexistent-project');
      expect(checkpoints).toEqual([]);
    });

    it('should return empty array when active task has no context_json', () => {
      service.setActiveTask('test-project', {
        task_name: 'Some task'
      });
      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints).toEqual([]);
    });

    it('should return empty array when context_json has no checkpoints', () => {
      service.setActiveTask('test-project', {
        task_name: 'Some task',
        context_json: { someKey: 'someValue' }
      });
      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints).toEqual([]);
    });
  });

  describe('setCheckpoints', () => {
    it('should store and retrieve checkpoints correctly', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      const checkpoints: TaskCheckpoint[] = [
        { name: 'Design', status: 'completed', completed_at: '2026-01-01T00:00:00.000Z' },
        { name: 'Implement', status: 'in_progress' },
        { name: 'Test', status: 'pending' }
      ];

      service.setCheckpoints('test-project', checkpoints);

      const result = service.getTaskCheckpoints('test-project');
      expect(result).toEqual(checkpoints);
    });

    it('should preserve existing context_json fields', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature',
        context_json: { branch: 'feature/abc', notes: 'important' }
      });

      const checkpoints: TaskCheckpoint[] = [
        { name: 'Step 1', status: 'pending' }
      ];

      service.setCheckpoints('test-project', checkpoints);

      // Verify checkpoints are stored
      const result = service.getTaskCheckpoints('test-project');
      expect(result).toEqual(checkpoints);

      // Verify original context fields are preserved
      const task = service.getActiveTask('test-project');
      const context = JSON.parse(task!.context_json!);
      expect(context.branch).toBe('feature/abc');
      expect(context.notes).toBe('important');
      expect(context.checkpoints).toEqual(checkpoints);
    });

    it('should do nothing when no active task exists', () => {
      // Should not throw
      service.setCheckpoints('nonexistent', [{ name: 'Step', status: 'pending' }]);
      const result = service.getTaskCheckpoints('nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('addCheckpoint', () => {
    it('should append checkpoint and set first to in_progress', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      service.addCheckpoint('test-project', 'Design');

      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints).toHaveLength(1);
      expect(checkpoints[0].name).toBe('Design');
      expect(checkpoints[0].status).toBe('in_progress');
    });

    it('should set subsequent checkpoints to pending', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      service.addCheckpoint('test-project', 'Design');
      service.addCheckpoint('test-project', 'Implement');
      service.addCheckpoint('test-project', 'Test');

      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints).toHaveLength(3);
      expect(checkpoints[0].status).toBe('in_progress');
      expect(checkpoints[1].status).toBe('pending');
      expect(checkpoints[2].status).toBe('pending');
    });
  });

  describe('completeCheckpoint', () => {
    it('should advance to next checkpoint', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      service.addCheckpoint('test-project', 'Design');
      service.addCheckpoint('test-project', 'Implement');
      service.addCheckpoint('test-project', 'Test');

      service.completeCheckpoint('test-project', 'Design');

      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints[0].status).toBe('completed');
      expect(checkpoints[0].completed_at).toBeDefined();
      expect(checkpoints[1].status).toBe('in_progress');
      expect(checkpoints[2].status).toBe('pending');
    });

    it('should update progress string', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      service.addCheckpoint('test-project', 'Design');
      service.addCheckpoint('test-project', 'Implement');
      service.addCheckpoint('test-project', 'Test');

      service.completeCheckpoint('test-project', 'Design');

      const task = service.getActiveTask('test-project');
      expect(task!.progress).toBe('Step 2/3: Implement');
    });

    it('should handle completing all checkpoints', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      service.addCheckpoint('test-project', 'Design');
      service.addCheckpoint('test-project', 'Implement');

      service.completeCheckpoint('test-project', 'Design');
      service.completeCheckpoint('test-project', 'Implement');

      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints[0].status).toBe('completed');
      expect(checkpoints[1].status).toBe('completed');

      const task = service.getActiveTask('test-project');
      expect(task!.progress).toBe('Step 2/2: All complete');
    });

    it('should not fail when checkpoint name does not exist', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      service.addCheckpoint('test-project', 'Design');

      // Should not throw
      service.completeCheckpoint('test-project', 'Nonexistent');

      const checkpoints = service.getTaskCheckpoints('test-project');
      expect(checkpoints[0].status).toBe('in_progress');
    });

    it('should complete middle checkpoint and advance correctly', () => {
      service.setActiveTask('test-project', {
        task_name: 'Build feature'
      });

      // Set up checkpoints with first already completed
      const checkpoints: TaskCheckpoint[] = [
        { name: 'Design', status: 'completed', completed_at: '2026-01-01T00:00:00.000Z' },
        { name: 'Implement', status: 'in_progress' },
        { name: 'Test', status: 'pending' },
        { name: 'Deploy', status: 'pending' }
      ];
      service.setCheckpoints('test-project', checkpoints);

      service.completeCheckpoint('test-project', 'Implement');

      const result = service.getTaskCheckpoints('test-project');
      expect(result[1].status).toBe('completed');
      expect(result[1].completed_at).toBeDefined();
      expect(result[2].status).toBe('in_progress');
      expect(result[3].status).toBe('pending');

      const task = service.getActiveTask('test-project');
      expect(task!.progress).toBe('Step 3/4: Test');
    });
  });
});
