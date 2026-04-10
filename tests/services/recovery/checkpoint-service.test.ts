/**
 * CheckpointService Tests
 *
 * Validates auto-checkpoint functionality for session resume continuity.
 * Uses in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import { CheckpointService } from '../../../src/services/recovery/CheckpointService.js';
import type { Checkpoint, TaskHistoryItem } from '../../../src/services/recovery/CheckpointService.js';
import type { Database } from 'bun:sqlite';

describe('CheckpointService', () => {
  let db: Database;
  let service: CheckpointService;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    service = new CheckpointService(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeCheckpoint(overrides: Partial<Checkpoint> = {}): Checkpoint {
    return {
      currentTask: 'Fixing authentication bug',
      filesModified: ['src/auth/middleware.ts'],
      filesRead: ['src/auth/config.ts', 'src/auth/middleware.ts'],
      testStatus: '3 pass, 1 fail',
      pendingWork: ['Write tests for new endpoint'],
      lastToolAction: 'Read src/auth/middleware.ts',
      observationCount: 5,
      resumeHint: 'Last: Read src/auth/middleware.ts. Next: Write tests for new endpoint',
      savedAt: '2026-04-09T10:00:00.000Z',
      taskHistory: [],
      conversationTopics: [],
      ...overrides,
    };
  }

  function makeUserPrompt(overrides: Partial<{
    prompt_text: string;
    created_at: string;
    created_at_epoch: number;
    prompt_number: number;
  }> = {}) {
    return {
      id: 1,
      content_session_id: 'session-1',
      prompt_number: 1,
      prompt_text: 'Fix the authentication bug',
      created_at: '2026-04-09T10:00:00.000Z',
      created_at_epoch: Date.now(),
      ...overrides,
    };
  }

  describe('saveCheckpoint', () => {
    it('should create a new active_task when none exists', () => {
      const checkpoint = makeCheckpoint();
      service.saveCheckpoint('test-project', 'session-1', checkpoint);

      const row = db.prepare(
        "SELECT * FROM active_tasks WHERE project = ? AND status = 'in_progress'"
      ).get('test-project') as any;

      expect(row).toBeTruthy();
      expect(row.task_name).toBe('Fixing authentication bug');
      expect(row.status).toBe('in_progress');

      const context = JSON.parse(row.context_json);
      expect(context.session_checkpoint).toBeTruthy();
      expect(context.session_checkpoint.currentTask).toBe('Fixing authentication bug');
    });

    it('should update existing active_task when one exists', () => {
      // Create initial task
      db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?)
      `).run('test-project', 'Old task', new Date().toISOString(), Date.now(), new Date().toISOString(), Date.now());

      const checkpoint = makeCheckpoint({ currentTask: 'New task description' });
      service.saveCheckpoint('test-project', 'session-1', checkpoint);

      const rows = db.prepare(
        "SELECT * FROM active_tasks WHERE project = ? AND status = 'in_progress'"
      ).all('test-project') as any[];

      expect(rows.length).toBe(1);
      expect(rows[0].task_name).toBe('New task description');
    });

    it('should preserve existing context_json fields when updating', () => {
      // Create task with existing context
      db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, context_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?)
      `).run(
        'test-project', 'My task',
        JSON.stringify({ checkpoints: [{ name: 'Step 1', status: 'completed' }], branch: 'feature/x' }),
        new Date().toISOString(), Date.now(), new Date().toISOString(), Date.now()
      );

      const checkpoint = makeCheckpoint();
      service.saveCheckpoint('test-project', 'session-1', checkpoint);

      const row = db.prepare(
        "SELECT context_json FROM active_tasks WHERE project = ? AND status = 'in_progress'"
      ).get('test-project') as any;

      const context = JSON.parse(row.context_json);
      expect(context.checkpoints).toBeTruthy(); // preserved
      expect(context.branch).toBe('feature/x'); // preserved
      expect(context.session_checkpoint).toBeTruthy(); // added
    });

    it('should store checkpoint data with all fields', () => {
      const checkpoint = makeCheckpoint();
      service.saveCheckpoint('test-project', 'session-1', checkpoint);

      const stored = service.getLatestCheckpoint('test-project');
      expect(stored).toBeTruthy();
      expect(stored!.currentTask).toBe('Fixing authentication bug');
      expect(stored!.filesModified).toEqual(['src/auth/middleware.ts']);
      expect(stored!.filesRead).toEqual(['src/auth/config.ts', 'src/auth/middleware.ts']);
      expect(stored!.testStatus).toBe('3 pass, 1 fail');
      expect(stored!.pendingWork).toEqual(['Write tests for new endpoint']);
      expect(stored!.lastToolAction).toBe('Read src/auth/middleware.ts');
      expect(stored!.observationCount).toBe(5);
      expect(stored!.resumeHint).toContain('Read src/auth/middleware.ts');
    });
  });

  describe('getLatestCheckpoint', () => {
    it('should return null when no active task exists', () => {
      const result = service.getLatestCheckpoint('nonexistent');
      expect(result).toBeNull();
    });

    it('should return null when active task has no checkpoint', () => {
      db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?)
      `).run('test-project', 'Task', new Date().toISOString(), Date.now(), new Date().toISOString(), Date.now());

      const result = service.getLatestCheckpoint('test-project');
      expect(result).toBeNull();
    });

    it('should return null when context_json has no session_checkpoint', () => {
      db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, context_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?)
      `).run('test-project', 'Task', JSON.stringify({ branch: 'main' }), new Date().toISOString(), Date.now(), new Date().toISOString(), Date.now());

      const result = service.getLatestCheckpoint('test-project');
      expect(result).toBeNull();
    });

    it('should return the most recent checkpoint', () => {
      const checkpoint = makeCheckpoint();
      service.saveCheckpoint('test-project', 'session-1', checkpoint);

      const result = service.getLatestCheckpoint('test-project');
      expect(result).toBeTruthy();
      expect(result!.currentTask).toBe('Fixing authentication bug');
    });

    it('should return null for completed tasks', () => {
      service.saveCheckpoint('test-project', 'session-1', makeCheckpoint());

      // Complete the task
      db.prepare(
        "UPDATE active_tasks SET status = 'completed' WHERE project = ?"
      ).run('test-project');

      const result = service.getLatestCheckpoint('test-project');
      expect(result).toBeNull();
    });
  });

  describe('buildCheckpointFromObservations', () => {
    it('should use lastUserPrompt as currentTask', () => {
      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', [], 'Fix the authentication bug'
      );
      expect(checkpoint.currentTask).toBe('Fix the authentication bug');
    });

    it('should truncate long prompts to 100 chars', () => {
      const longPrompt = 'A'.repeat(200);
      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', [], longPrompt
      );
      expect(checkpoint.currentTask.length).toBe(100);
    });

    it('should use fallback when no prompt available', () => {
      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', [], null
      );
      expect(checkpoint.currentTask).toBe('Working on test-project');
    });

    it('should aggregate filesModified from observations', () => {
      const observations = [
        { files_modified: JSON.stringify(['src/a.ts']), files_read: null, title: 'Edit A', narrative: '', facts: '' },
        { files_modified: JSON.stringify(['src/b.ts', 'src/c.ts']), files_read: null, title: 'Edit B', narrative: '', facts: '' },
        { files_modified: JSON.stringify(['src/a.ts']), files_read: null, title: 'Edit A again', narrative: '', facts: '' },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, 'Working'
      );

      expect(checkpoint.filesModified).toContain('src/a.ts');
      expect(checkpoint.filesModified).toContain('src/b.ts');
      expect(checkpoint.filesModified).toContain('src/c.ts');
      // Deduplication: src/a.ts should appear only once
      expect(checkpoint.filesModified.filter(f => f === 'src/a.ts').length).toBe(1);
    });

    it('should aggregate filesRead from observations', () => {
      const observations = [
        { files_read: JSON.stringify(['src/x.ts']), files_modified: null, title: 'Read X', narrative: '', facts: '' },
        { files_read: 'src/y.ts, src/z.ts', files_modified: null, title: 'Read Y,Z', narrative: '', facts: '' },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.filesRead).toContain('src/x.ts');
      expect(checkpoint.filesRead).toContain('src/y.ts');
      expect(checkpoint.filesRead).toContain('src/z.ts');
    });

    it('should detect test status from observations', () => {
      const observations = [
        { title: 'Run unit tests', narrative: 'Ran tests: 10 tests pass, 2 tests fail', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.testStatus).toBe('10 pass, 2 fail');
    });

    it('should detect test status with pass only', () => {
      const observations = [
        { title: 'Tests pass', narrative: '15 pass', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.testStatus).toBe('15 pass');
    });

    it('should detect generic test failure', () => {
      const observations = [
        { title: 'Run test suite', narrative: 'Some tests fail in the CI pipeline', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.testStatus).toBe('tests failing');
    });

    it('should return null testStatus when no test-related observations', () => {
      const observations = [
        { title: 'Read config', narrative: 'Read the configuration file', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.testStatus).toBeNull();
    });

    it('should detect pending work from TODO/WIP patterns', () => {
      const observations = [
        { title: 'Implement auth', narrative: 'Started auth. TODO: add refresh token support', facts: '', files_read: null, files_modified: null },
        { title: 'Refactor routes', narrative: 'WIP: routes are partially refactored', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.pendingWork.length).toBe(2);
      expect(checkpoint.pendingWork[0]).toBe('Implement auth');
    });

    it('should set lastToolAction from most recent observation', () => {
      const observations = [
        { title: 'First action', narrative: '', facts: '', files_read: null, files_modified: null },
        { title: 'Last action', narrative: '', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.lastToolAction).toBe('Last action');
    });

    it('should fall back to subtitle when title is missing', () => {
      const observations = [
        { title: null, subtitle: 'Some subtitle', narrative: '', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.lastToolAction).toBe('Some subtitle');
    });

    it('should count observations correctly', () => {
      const observations = [
        { title: 'A', narrative: '', facts: '', files_read: null, files_modified: null },
        { title: 'B', narrative: '', facts: '', files_read: null, files_modified: null },
        { title: 'C', narrative: '', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.observationCount).toBe(3);
    });

    it('should produce minimal checkpoint for empty observations', () => {
      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', [], null
      );

      expect(checkpoint.currentTask).toBe('Working on test-project');
      expect(checkpoint.filesModified).toEqual([]);
      expect(checkpoint.filesRead).toEqual([]);
      expect(checkpoint.testStatus).toBeNull();
      expect(checkpoint.pendingWork).toEqual([]);
      expect(checkpoint.lastToolAction).toBe('No actions recorded');
      expect(checkpoint.observationCount).toBe(0);
      expect(checkpoint.resumeHint).toBe('Continue working on the project');
      expect(checkpoint.taskHistory).toEqual([]);
      expect(checkpoint.conversationTopics).toEqual([]);
    });

    it('should set savedAt to an ISO timestamp', () => {
      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', [], null
      );

      expect(checkpoint.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('should build resumeHint from lastToolAction and pendingWork', () => {
      const observations = [
        { title: 'Edit middleware.ts', narrative: 'TODO: add rate limiting', facts: '', files_read: null, files_modified: null },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.resumeHint).toContain('Last: Edit middleware.ts');
      expect(checkpoint.resumeHint).toContain('Next: Edit middleware.ts');
    });

    it('should handle comma-separated files_modified strings', () => {
      const observations = [
        { files_modified: 'src/a.ts, src/b.ts', files_read: null, title: 'Edit', narrative: '', facts: '' },
      ];

      const checkpoint = service.buildCheckpointFromObservations(
        'test-project', 'session-1', observations, null
      );

      expect(checkpoint.filesModified).toContain('src/a.ts');
      expect(checkpoint.filesModified).toContain('src/b.ts');
    });
  });

  describe('clearCheckpoint', () => {
    it('should remove session_checkpoint from context_json', () => {
      service.saveCheckpoint('test-project', 'session-1', makeCheckpoint());

      // Verify it exists
      expect(service.getLatestCheckpoint('test-project')).toBeTruthy();

      // Clear it
      service.clearCheckpoint('test-project');

      // Should be gone
      expect(service.getLatestCheckpoint('test-project')).toBeNull();
    });

    it('should preserve other context_json fields', () => {
      // Create task with checkpoint and other context
      db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, context_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?)
      `).run(
        'test-project', 'My task',
        JSON.stringify({ session_checkpoint: makeCheckpoint(), branch: 'main', notes: 'important' }),
        new Date().toISOString(), Date.now(), new Date().toISOString(), Date.now()
      );

      service.clearCheckpoint('test-project');

      const row = db.prepare(
        "SELECT context_json FROM active_tasks WHERE project = ? AND status = 'in_progress'"
      ).get('test-project') as any;

      const context = JSON.parse(row.context_json);
      expect(context.session_checkpoint).toBeUndefined();
      expect(context.branch).toBe('main');
      expect(context.notes).toBe('important');
    });

    it('should not throw when no active task exists', () => {
      expect(() => service.clearCheckpoint('nonexistent')).not.toThrow();
    });

    it('should not throw when context_json is null', () => {
      db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?)
      `).run('test-project', 'Task', new Date().toISOString(), Date.now(), new Date().toISOString(), Date.now());

      expect(() => service.clearCheckpoint('test-project')).not.toThrow();
    });
  });

  describe('multiple projects', () => {
    it('should isolate checkpoints between projects', () => {
      service.saveCheckpoint('project-a', 'session-1', makeCheckpoint({ currentTask: 'Task A' }));
      service.saveCheckpoint('project-b', 'session-2', makeCheckpoint({ currentTask: 'Task B' }));

      const checkpointA = service.getLatestCheckpoint('project-a');
      const checkpointB = service.getLatestCheckpoint('project-b');

      expect(checkpointA!.currentTask).toBe('Task A');
      expect(checkpointB!.currentTask).toBe('Task B');
    });

    it('should clear checkpoint for only one project', () => {
      service.saveCheckpoint('project-a', 'session-1', makeCheckpoint({ currentTask: 'Task A' }));
      service.saveCheckpoint('project-b', 'session-2', makeCheckpoint({ currentTask: 'Task B' }));

      service.clearCheckpoint('project-a');

      expect(service.getLatestCheckpoint('project-a')).toBeNull();
      expect(service.getLatestCheckpoint('project-b')).toBeTruthy();
    });
  });

  describe('buildSmartCheckpoint', () => {
    it('should extract currentTask from the latest user prompt', () => {
      const prompts = [
        makeUserPrompt({ prompt_text: 'Add logging to the auth service', prompt_number: 1, created_at_epoch: 1000 }),
        makeUserPrompt({ prompt_text: 'Fix the database connection pool', prompt_number: 2, created_at_epoch: 2000 }),
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', [], prompts, 0
      );

      expect(checkpoint.currentTask).toContain('Fix the database connection pool');
    });

    it('should strip common prefixes from prompts', () => {
      const prompts = [
        makeUserPrompt({ prompt_text: 'Can you please fix the login bug', prompt_number: 1 }),
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', [], prompts, 0
      );

      // Should strip "Can you" and "please"
      expect(checkpoint.currentTask).not.toMatch(/^can you/i);
      expect(checkpoint.currentTask).not.toMatch(/^please/i);
    });

    it('should build taskHistory marking completed vs pending tasks', () => {
      const baseEpoch = Date.now();
      const prompts = [
        makeUserPrompt({ prompt_text: 'Add auth middleware', prompt_number: 1, created_at_epoch: baseEpoch }),
        makeUserPrompt({ prompt_text: 'Write tests for auth', prompt_number: 2, created_at_epoch: baseEpoch + 2000 }),
      ];
      const observations = [
        {
          title: 'Added auth middleware',
          narrative: 'Implemented JWT auth middleware',
          type: 'feature',
          created_at_epoch: baseEpoch + 1000,
          files_modified: null,
          files_read: null,
          facts: '',
        },
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', observations, prompts, 0
      );

      expect(checkpoint.taskHistory.length).toBe(2);
      expect(checkpoint.taskHistory[0].status).toBe('completed');
      expect(checkpoint.taskHistory[1].status).toBe('pending');
    });

    it('should generate resumeHint mentioning unfinished last prompt', () => {
      const baseEpoch = Date.now();
      const prompts = [
        makeUserPrompt({ prompt_text: 'Refactor the payment service', prompt_number: 1, created_at_epoch: baseEpoch }),
      ];
      // No observations after the prompt
      const observations: any[] = [];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', observations, prompts, 0
      );

      expect(checkpoint.resumeHint).toContain("wasn't finished");
      expect(checkpoint.resumeHint).toContain('Refactor the payment service');
    });

    it('should generate resumeHint mentioning failing tests', () => {
      const baseEpoch = Date.now();
      const prompts = [
        makeUserPrompt({ prompt_text: 'Fix the auth tests', prompt_number: 1, created_at_epoch: baseEpoch }),
      ];
      const observations = [
        {
          title: 'Run tests',
          narrative: 'Ran test suite: 10 pass, 3 fail',
          type: 'observation',
          created_at_epoch: baseEpoch + 1000,
          files_modified: JSON.stringify(['src/auth/middleware.ts']),
          files_read: null,
          facts: '',
        },
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', observations, prompts, 0
      );

      // Test status should be detected, and since last prompt has completion after it (but it's a test run, not feature),
      // the resume hint should mention failing tests
      expect(checkpoint.testStatus).toBe('10 pass, 3 fail');
      expect(checkpoint.resumeHint).toContain('fail');
    });

    it('should extract conversationTopics from user prompts', () => {
      const prompts = [
        makeUserPrompt({ prompt_text: 'Add authentication to the API', prompt_number: 1 }),
        makeUserPrompt({ prompt_text: 'Fix database migration issues', prompt_number: 2 }),
        makeUserPrompt({ prompt_text: 'Improve test coverage for auth module', prompt_number: 3 }),
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', [], prompts, 0
      );

      expect(checkpoint.conversationTopics.length).toBe(3);
      expect(checkpoint.conversationTopics.some(t => t.includes('authentication'))).toBe(true);
      expect(checkpoint.conversationTopics.some(t => t.includes('database migration'))).toBe(true);
    });

    it('should handle empty prompts gracefully', () => {
      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', [], [], 0
      );

      expect(checkpoint.taskHistory).toEqual([]);
      expect(checkpoint.conversationTopics).toEqual([]);
      expect(checkpoint.currentTask).toBe('Working on test-project');
    });

    it('should handle prompts with empty text gracefully', () => {
      const prompts = [
        makeUserPrompt({ prompt_text: '', prompt_number: 1 }),
        makeUserPrompt({ prompt_text: '   ', prompt_number: 2 }),
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', [], prompts, 0
      );

      expect(checkpoint.taskHistory).toEqual([]);
      expect(checkpoint.conversationTopics).toEqual([]);
    });

    it('should truncate currentTask to 120 chars', () => {
      const prompts = [
        makeUserPrompt({ prompt_text: 'A'.repeat(200), prompt_number: 1 }),
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', [], prompts, 0
      );

      expect(checkpoint.currentTask.length).toBeLessThanOrEqual(120);
    });

    it('should detect unfinished last prompt as pending work', () => {
      const baseEpoch = Date.now();
      const prompts = [
        makeUserPrompt({ prompt_text: 'Implement the retry logic', prompt_number: 1, created_at_epoch: baseEpoch + 5000 }),
      ];
      // No observations after the prompt
      const observations = [
        {
          title: 'Read config',
          narrative: 'Reading configuration',
          type: 'observation',
          created_at_epoch: baseEpoch, // before the prompt
          files_modified: null,
          files_read: null,
          facts: '',
        },
      ];

      const checkpoint = service.buildSmartCheckpoint(
        'test-project', 'session-1', observations, prompts, 0
      );

      expect(checkpoint.pendingWork.some(p => p.includes('Implement the retry logic'))).toBe(true);
    });
  });

  describe('checkpoint overwrite', () => {
    it('should overwrite previous checkpoint for same project', () => {
      service.saveCheckpoint('test-project', 'session-1', makeCheckpoint({ currentTask: 'First task', observationCount: 3 }));
      service.saveCheckpoint('test-project', 'session-1', makeCheckpoint({ currentTask: 'Second task', observationCount: 7 }));

      const result = service.getLatestCheckpoint('test-project');
      expect(result!.currentTask).toBe('Second task');
      expect(result!.observationCount).toBe(7);
    });
  });
});
