/**
 * StructuredSummaryBuilder Tests
 *
 * Validates structured session summary generation for actionable session recovery.
 * Uses in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import { StructuredSummaryBuilder } from '../../../src/services/recovery/StructuredSummaryBuilder.js';
import type { StructuredSummary } from '../../../src/services/recovery/StructuredSummaryBuilder.js';
import type { Database } from 'bun:sqlite';

describe('StructuredSummaryBuilder', () => {
  let db: Database;
  let builder: StructuredSummaryBuilder;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    builder = new StructuredSummaryBuilder(db);
  });

  afterEach(() => {
    db.close();
  });

  function makeObs(overrides: Partial<{
    type: string;
    title: string;
    narrative: string;
    facts: string;
    confidence: string;
    files_modified: string;
    files_read: string;
  }> = {}) {
    return {
      type: 'observation',
      title: 'Some action',
      narrative: 'Did something',
      facts: '',
      confidence: '',
      files_modified: null,
      files_read: null,
      ...overrides,
    };
  }

  describe('buildFromSession', () => {
    it('should extract completed tasks from feature observations', () => {
      const observations = [
        makeObs({ type: 'feature', title: 'Added JWT auth endpoint' }),
        makeObs({ type: 'bugfix', title: 'Fixed session timeout bug' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.tasksCompleted).toContain('Added JWT auth endpoint');
      expect(summary.tasksCompleted).toContain('Fixed session timeout bug');
    });

    it('should extract completed tasks from completion keywords', () => {
      const observations = [
        makeObs({ type: 'observation', title: 'Implemented rate limiting' }),
        makeObs({ type: 'observation', title: 'Created test utilities', narrative: 'Built helper functions' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.tasksCompleted).toContain('Implemented rate limiting');
      expect(summary.tasksCompleted).toContain('Created test utilities');
    });

    it('should extract completed from raw summary', () => {
      const rawSummary = { completed: 'Fixed auth bug; Added tests' };
      const observations: any[] = [];

      const summary = builder.buildFromSession('project', 'session-1', observations, rawSummary, Date.now() - 60000);

      expect(summary.tasksCompleted).toContain('Fixed auth bug');
      expect(summary.tasksCompleted).toContain('Added tests');
    });

    it('should detect in-progress work from WIP/TODO keywords', () => {
      const observations = [
        makeObs({ narrative: 'WIP: refactoring the preferences API', title: 'Refactor preferences' }),
        makeObs({ narrative: 'TODO: add validation to input fields', title: 'Input validation' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.tasksInProgress.length).toBe(2);
      expect(summary.tasksInProgress[0]).toContain('Refactor preferences');
    });

    it('should add file hints to in-progress items', () => {
      const observations = [
        makeObs({
          narrative: 'Started working on the API routes',
          title: 'API routes WIP',
          files_modified: JSON.stringify(['src/routes.ts'])
        }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.tasksInProgress.length).toBe(1);
      expect(summary.tasksInProgress[0]).toContain('src/routes.ts');
    });

    it('should capture decisions from decision-type observations', () => {
      const observations = [
        makeObs({ type: 'decision', title: 'Switched from Postgres to SQLite' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.decisionsMade).toContain('Switched from Postgres to SQLite');
    });

    it('should capture decisions from decision keywords', () => {
      const observations = [
        makeObs({ title: 'Connection pool', narrative: 'Decided to increase pool from 5 to 20' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.decisionsMade.length).toBeGreaterThan(0);
    });

    it('should detect blockers from error/fail keywords', () => {
      const observations = [
        makeObs({ title: 'Auth tests failing', narrative: 'Tests failed due to missing env vars' }),
        makeObs({ narrative: 'Cannot connect to database — timeout error' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.blockers.length).toBe(2);
    });

    it('should extract key discoveries from high-confidence discovery observations', () => {
      const observations = [
        makeObs({ type: 'discovery', confidence: 'high', title: 'TypeScript strict mode caught 23 bugs' }),
        makeObs({ type: 'discovery', confidence: 'low', title: 'Minor performance issue' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.keyDiscoveries).toContain('TypeScript strict mode caught 23 bugs');
      expect(summary.keyDiscoveries).not.toContain('Minor performance issue');
    });

    it('should build resumeContext prioritizing in-progress work', () => {
      const observations = [
        makeObs({ type: 'feature', title: 'Added auth module' }),
        makeObs({ narrative: 'WIP: Writing unit tests', title: 'Unit tests' }),
      ];
      const rawSummary = { next_steps: 'Finish tests, then deploy' };

      const summary = builder.buildFromSession('project', 'session-1', observations, rawSummary, Date.now() - 60000);

      // New enhanced resumeContext prioritizes in-progress over completed
      expect(summary.resumeContext).toContain('Unit tests');
    });

    it('should calculate duration correctly for 45 minutes', () => {
      const startEpoch = Date.now() - (45 * 60 * 1000);
      const summary = builder.buildFromSession('project', 'session-1', [], null, startEpoch);

      expect(summary.sessionDuration).toBe('45 minutes');
    });

    it('should calculate duration for 2 hours', () => {
      const startEpoch = Date.now() - (2 * 60 * 60 * 1000);
      const summary = builder.buildFromSession('project', 'session-1', [], null, startEpoch);

      expect(summary.sessionDuration).toBe('2 hours');
    });

    it('should calculate duration for 1 hour 30 minutes', () => {
      const startEpoch = Date.now() - (90 * 60 * 1000);
      const summary = builder.buildFromSession('project', 'session-1', [], null, startEpoch);

      expect(summary.sessionDuration).toBe('1 hour 30 minutes');
    });

    it('should handle unknown duration when startEpoch is 0', () => {
      const summary = builder.buildFromSession('project', 'session-1', [], null, 0);
      // 0 epoch means very long ago, which is fine — just should not crash
      expect(summary.sessionDuration).toBeTruthy();
    });

    it('should set observationCount correctly', () => {
      const observations = [makeObs(), makeObs(), makeObs()];
      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.observationCount).toBe(3);
    });

    it('should produce minimal summary for empty session', () => {
      const summary = builder.buildFromSession('project', 'session-1', [], null, Date.now() - 60000);

      expect(summary.tasksCompleted).toEqual([]);
      expect(summary.tasksInProgress).toEqual([]);
      expect(summary.decisionsMade).toEqual([]);
      expect(summary.blockers).toEqual([]);
      expect(summary.keyDiscoveries).toEqual([]);
      expect(summary.resumeContext).toBe('No specific resume context available.');
      expect(summary.observationCount).toBe(0);
    });

    it('should deduplicate tasks across observations and raw summary', () => {
      const observations = [
        makeObs({ type: 'feature', title: 'Added auth module' }),
      ];
      const rawSummary = { completed: 'Added auth module' };

      const summary = builder.buildFromSession('project', 'session-1', observations, rawSummary, Date.now() - 60000);

      // Should not have duplicates
      const authEntries = summary.tasksCompleted.filter(t => t.toLowerCase().includes('auth module'));
      expect(authEntries.length).toBe(1);
    });
  });

  describe('formatAsMarkdown', () => {
    it('should produce valid markdown with all sections', () => {
      const summary: StructuredSummary = {
        tasksCompleted: ['Fixed JWT expiry bug (auth/middleware.ts)'],
        tasksInProgress: ['Refactoring preference API - stopped at routes.ts'],
        decisionsMade: ['Changed connection pool from 5 to 20'],
        blockers: ['preference API tests not written yet'],
        keyDiscoveries: ['TypeScript strict mode caught 23 null pointer bugs'],
        resumeContext: 'Next time: finish preference API refactor.',
        sessionDuration: '45 minutes',
        observationCount: 12,
      };

      const md = builder.formatAsMarkdown(summary);

      expect(md).toContain('## Session Summary');
      expect(md).toContain('### Completed');
      expect(md).toContain('- Fixed JWT expiry bug');
      expect(md).toContain('### In Progress');
      expect(md).toContain('- Refactoring preference API');
      expect(md).toContain('### Decisions');
      expect(md).toContain('- Changed connection pool');
      expect(md).toContain('### Blockers');
      expect(md).toContain('- preference API tests');
      expect(md).toContain('### Key Discoveries');
      expect(md).toContain('- TypeScript strict mode');
      expect(md).toContain('### Resume Context');
      expect(md).toContain('Next time: finish preference API refactor');
      expect(md).toContain('Duration: 45 minutes | 12 observations');
    });

    it('should omit empty sections', () => {
      const summary: StructuredSummary = {
        tasksCompleted: ['Fixed a bug'],
        tasksInProgress: [],
        decisionsMade: [],
        blockers: [],
        keyDiscoveries: [],
        resumeContext: 'Continue working.',
        sessionDuration: '10 minutes',
        observationCount: 2,
      };

      const md = builder.formatAsMarkdown(summary);

      expect(md).toContain('### Completed');
      expect(md).not.toContain('### In Progress');
      expect(md).not.toContain('### Decisions');
      expect(md).not.toContain('### Blockers');
      expect(md).not.toContain('### Key Discoveries');
    });

    it('should produce minimal markdown for empty summary', () => {
      const summary: StructuredSummary = {
        tasksCompleted: [],
        tasksInProgress: [],
        decisionsMade: [],
        blockers: [],
        keyDiscoveries: [],
        resumeContext: '',
        sessionDuration: '5 minutes',
        observationCount: 0,
      };

      const md = builder.formatAsMarkdown(summary);

      expect(md).toContain('## Session Summary');
      expect(md).toContain('Duration: 5 minutes | 0 observations');
    });
  });

  describe('storeStructuredSummary', () => {
    it('should store structured summary when summary row exists', () => {
      // Create session first
      db.prepare(`
        INSERT INTO sdk_sessions (content_session_id, project, user_prompt, started_at, started_at_epoch)
        VALUES (?, ?, ?, ?, ?)
      `).run('session-1', 'test-project', '', new Date().toISOString(), Date.now());

      // Update memory_session_id
      db.prepare(`
        UPDATE sdk_sessions SET memory_session_id = ? WHERE content_session_id = ?
      `).run('memory-1', 'session-1');

      // Create summary row
      db.prepare(`
        INSERT INTO session_summaries (memory_session_id, project, request, investigated, learned, completed, next_steps, created_at, created_at_epoch)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run('memory-1', 'test-project', 'What was done', 'Looked at code', 'Learned stuff', 'Fixed bugs', 'Write tests', new Date().toISOString(), Date.now());

      const summary: StructuredSummary = {
        tasksCompleted: ['Fixed bug'],
        tasksInProgress: [],
        decisionsMade: [],
        blockers: [],
        keyDiscoveries: [],
        resumeContext: 'Write tests next.',
        sessionDuration: '30 minutes',
        observationCount: 5,
      };

      builder.storeStructuredSummary('test-project', 'memory-1', summary);

      // Verify storage
      const row = db.prepare(
        'SELECT structured_summary FROM session_summaries WHERE memory_session_id = ?'
      ).get('memory-1') as any;

      expect(row.structured_summary).toBeTruthy();
      const stored = JSON.parse(row.structured_summary);
      expect(stored.tasksCompleted).toEqual(['Fixed bug']);
      expect(stored.resumeContext).toBe('Write tests next.');
    });

    it('should not throw when no summary row exists', () => {
      const summary: StructuredSummary = {
        tasksCompleted: [],
        tasksInProgress: [],
        decisionsMade: [],
        blockers: [],
        keyDiscoveries: [],
        resumeContext: '',
        sessionDuration: '',
        observationCount: 0,
      };

      expect(() => builder.storeStructuredSummary('test-project', 'nonexistent', summary)).not.toThrow();
    });
  });

  describe('buildEnhancedResumeContext', () => {
    it('should prioritize in-progress over completed', () => {
      const result = builder.buildEnhancedResumeContext(
        ['Fixed the login bug'],
        ['Refactoring auth service'],
        [],
        [],
        null,
        null
      );

      expect(result).toContain('Continue: Refactoring auth service');
      expect(result).not.toContain('Fixed the login bug');
    });

    it('should mention blockers prominently', () => {
      const result = builder.buildEnhancedResumeContext(
        [],
        ['Working on API'],
        [],
        ['Cannot connect to staging database'],
        null,
        null
      );

      expect(result).toContain('Blocked: Cannot connect to staging database');
    });

    it('should include file hints from checkpoint', () => {
      const checkpoint = {
        currentTask: 'Fixing auth',
        filesModified: ['src/auth.ts', 'src/middleware.ts', 'src/routes.ts'],
        filesRead: [],
        testStatus: null,
        pendingWork: [],
        lastToolAction: 'Edit src/routes.ts',
        observationCount: 5,
        resumeHint: '',
        savedAt: new Date().toISOString(),
        taskHistory: [],
        conversationTopics: [],
      };

      const result = builder.buildEnhancedResumeContext(
        [],
        ['Working on routes'],
        [],
        [],
        checkpoint,
        null
      );

      expect(result).toContain('Files to check:');
      expect(result).toContain('src/routes.ts');
    });

    it('should mention failing tests from checkpoint', () => {
      const checkpoint = {
        currentTask: 'Fix tests',
        filesModified: ['src/auth.ts'],
        filesRead: [],
        testStatus: '10 pass, 3 fail',
        pendingWork: [],
        lastToolAction: 'Run tests',
        observationCount: 3,
        resumeHint: '',
        savedAt: new Date().toISOString(),
        taskHistory: [],
        conversationTopics: [],
      };

      const result = builder.buildEnhancedResumeContext(
        [],
        [],
        [],
        [],
        checkpoint,
        null
      );

      expect(result).toContain('Fix failing tests first');
      expect(result).toContain('3 fail');
    });

    it('should fall back to rawNextSteps when everything is empty', () => {
      const result = builder.buildEnhancedResumeContext(
        [],
        [],
        [],
        [],
        null,
        'Deploy to staging and run integration tests'
      );

      expect(result).toBe('Deploy to staging and run integration tests');
    });

    it('should fall back to completed summary when no pending work', () => {
      const result = builder.buildEnhancedResumeContext(
        ['Implemented auth', 'Added tests'],
        [],
        [],
        [],
        null,
        null
      );

      expect(result).toContain('Last session completed');
      expect(result).toContain('Implemented auth');
      expect(result).toContain('No pending work detected');
    });

    it('should include decisions to remember', () => {
      const result = builder.buildEnhancedResumeContext(
        [],
        ['Building the API'],
        ['Switched from REST to GraphQL'],
        [],
        null,
        null
      );

      expect(result).toContain('Remember: Switched from REST to GraphQL');
    });

    it('should include multiple pending items', () => {
      const result = builder.buildEnhancedResumeContext(
        [],
        ['Fix auth bug', 'Update docs', 'Add tests'],
        [],
        [],
        null,
        null
      );

      expect(result).toContain('Continue: Fix auth bug');
      expect(result).toContain('Also pending: Update docs, Add tests');
    });
  });

  describe('buildAIResumePrompt', () => {
    it('should include all summary fields', () => {
      const summary: StructuredSummary = {
        tasksCompleted: ['Fixed auth bug'],
        tasksInProgress: ['Writing tests'],
        decisionsMade: ['Use SQLite'],
        blockers: ['CI pipeline broken'],
        keyDiscoveries: ['Found race condition'],
        resumeContext: 'Fix CI first.',
        sessionDuration: '30 minutes',
        observationCount: 5,
      };

      const prompt = builder.buildAIResumePrompt(summary);

      expect(prompt).toContain('Fixed auth bug');
      expect(prompt).toContain('Writing tests');
      expect(prompt).toContain('Use SQLite');
      expect(prompt).toContain('CI pipeline broken');
      expect(prompt).toContain('Found race condition');
      expect(prompt).toContain('what to do first');
    });

    it('should handle empty summary gracefully', () => {
      const summary: StructuredSummary = {
        tasksCompleted: [],
        tasksInProgress: [],
        decisionsMade: [],
        blockers: [],
        keyDiscoveries: [],
        resumeContext: '',
        sessionDuration: '5 minutes',
        observationCount: 0,
      };

      const prompt = builder.buildAIResumePrompt(summary);

      expect(prompt).toContain('nothing');
      expect(prompt).toContain('none');
    });
  });

  describe('enhanced detection', () => {
    it('should detect modified-but-not-completed files as in-progress', () => {
      // Create 3+ observations with files modified but none completed
      const observations = [
        makeObs({ title: 'Read config', narrative: 'Reading configuration', files_modified: JSON.stringify(['src/config.ts']) }),
        makeObs({ title: 'Edit routes', narrative: 'Editing route handlers', files_modified: JSON.stringify(['src/routes.ts']) }),
        makeObs({ title: 'Edit middleware', narrative: 'Updating middleware', files_modified: JSON.stringify(['src/middleware.ts']) }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      // Files from last 3 obs should appear as in-progress since nothing is completed
      const inProgressStr = summary.tasksInProgress.join(' ');
      // At least some of the modified files should be flagged
      expect(summary.tasksInProgress.length).toBeGreaterThan(0);
    });

    it('should detect repeated file modifications as in-progress', () => {
      const observations = [
        makeObs({ title: 'Edit auth v1', narrative: 'First attempt', files_modified: JSON.stringify(['src/auth.ts']) }),
        makeObs({ title: 'Edit auth v2', narrative: 'Second attempt', files_modified: JSON.stringify(['src/auth.ts']) }),
        makeObs({ title: 'Edit auth v3', narrative: 'Third attempt', files_modified: JSON.stringify(['src/auth.ts']) }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.tasksInProgress.some(t => t.includes('Repeatedly modified') && t.includes('src/auth.ts'))).toBe(true);
    });

    it('should detect blockers from facts field with fail keyword', () => {
      const observations = [
        makeObs({ title: 'Test run', narrative: 'Executed test suite', facts: 'auth.test.ts: 3 fail' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.blockers.length).toBeGreaterThan(0);
      expect(summary.blockers[0]).toContain('Test run');
    });

    it('should detect explicit blockers like "blocked by"', () => {
      const observations = [
        makeObs({ title: 'API integration', narrative: 'Blocked by missing API key from ops team' }),
      ];

      const summary = builder.buildFromSession('project', 'session-1', observations, null, Date.now() - 60000);

      expect(summary.blockers.length).toBeGreaterThan(0);
      expect(summary.blockers[0]).toContain('API integration');
    });
  });

  describe('duration edge cases', () => {
    it('should handle less than 1 minute', () => {
      const summary = builder.buildFromSession('project', 'session-1', [], null, Date.now() - 15000);
      expect(summary.sessionDuration).toBe('less than a minute');
    });

    it('should handle exactly 1 minute', () => {
      const summary = builder.buildFromSession('project', 'session-1', [], null, Date.now() - 60000);
      expect(summary.sessionDuration).toBe('1 minute');
    });

    it('should handle exactly 1 hour', () => {
      const summary = builder.buildFromSession('project', 'session-1', [], null, Date.now() - 3600000);
      expect(summary.sessionDuration).toBe('1 hour');
    });
  });
});
