/**
 * NarrativeRecallEngine Tests
 *
 * Validates coherent narrative generation from past observations,
 * compiled knowledge, and session summaries.
 * Uses in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import { NarrativeRecallEngine } from '../../../src/services/recovery/NarrativeRecallEngine.js';
import type { NarrativeRecall, RecallSection } from '../../../src/services/recovery/NarrativeRecallEngine.js';
import type { Database } from 'bun:sqlite';

describe('NarrativeRecallEngine', () => {
  let db: Database;
  let engine: NarrativeRecallEngine;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    engine = new NarrativeRecallEngine(db);
  });

  afterEach(() => {
    db.close();
  });

  // Helper to insert a session
  function createSession(contentSessionId: string, memorySessionId: string, project: string) {
    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch)
      VALUES (?, ?, ?, '', ?, ?)
    `).run(contentSessionId, memorySessionId, project, new Date().toISOString(), Date.now());
  }

  // Helper to insert an observation
  function insertObs(opts: {
    memorySessionId: string;
    project: string;
    type?: string;
    title?: string;
    narrative?: string;
    concepts?: string;
    files_modified?: string;
    epochOffset?: number;
  }) {
    const epoch = Date.now() - (opts.epochOffset || 0);
    db.prepare(`
      INSERT INTO observations (memory_session_id, project, type, title, narrative, concepts, files_modified, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.memorySessionId, opts.project,
      opts.type || 'observation',
      opts.title || null,
      opts.narrative || null,
      opts.concepts || null,
      opts.files_modified || null,
      new Date(epoch).toISOString(), epoch
    );
  }

  // Helper to insert compiled knowledge
  function insertKnowledge(project: string, topic: string, content: string) {
    db.prepare(`
      INSERT INTO compiled_knowledge (project, topic, content, compiled_at)
      VALUES (?, ?, ?, ?)
    `).run(project, topic, content, new Date().toISOString());
  }

  // Helper to insert a session summary
  function insertSummary(opts: {
    memorySessionId: string;
    project: string;
    request?: string;
    completed?: string;
    next_steps?: string;
    structured_summary?: string;
    epochOffset?: number;
  }) {
    const epoch = Date.now() - (opts.epochOffset || 0);
    db.prepare(`
      INSERT INTO session_summaries (memory_session_id, project, request, completed, next_steps, structured_summary, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      opts.memorySessionId, opts.project,
      opts.request || null,
      opts.completed || null,
      opts.next_steps || null,
      opts.structured_summary || null,
      new Date(epoch).toISOString(), epoch
    );
  }

  describe('recall', () => {
    it('should return "no memories" when no data exists', () => {
      const result = engine.recall({ query: 'auth', project: 'test-project' });

      expect(result.narrative).toBe('No relevant memories found for this query.');
      expect(result.sections).toEqual([]);
      expect(result.sourceCount).toBe(0);
      expect(result.confidence).toBe('low');
    });

    it('should produce narrative from matching observations', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'feature',
        title: 'Added auth middleware',
        narrative: 'Implemented JWT validation in auth middleware',
      });

      const result = engine.recall({ query: 'auth', project: 'test-project' });

      expect(result.narrative).toContain('Added auth middleware');
      expect(result.sourceCount).toBeGreaterThan(0);
    });

    it('should include compiled knowledge when available', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertKnowledge('test-project', 'auth module', 'JWT-based auth with refresh tokens');

      const result = engine.recall({ query: 'auth', project: 'test-project' });

      expect(result.narrative).toContain('auth module');
      expect(result.confidence).toBe('high');
    });

    it('should have high confidence with compiled knowledge', () => {
      insertKnowledge('test-project', 'auth', 'Some knowledge');

      const result = engine.recall({ query: 'auth', project: 'test-project' });
      expect(result.confidence).toBe('high');
    });

    it('should have medium confidence with observations only', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      for (let i = 0; i < 5; i++) {
        insertObs({
          memorySessionId: 'ms-1',
          project: 'test-project',
          title: `Auth action ${i}`,
          narrative: `Did something with auth ${i}`,
        });
      }

      const result = engine.recall({ query: 'auth', project: 'test-project' });
      expect(result.confidence).toBe('medium');
    });

    it('should have low confidence with sparse data', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'One auth thing',
        narrative: 'auth related',
      });

      const result = engine.recall({ query: 'auth', project: 'test-project' });
      // 1 observation, no compiled knowledge
      expect(result.confidence).toBe('low');
    });

    it('should filter by time range when provided', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      // Recent observation
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Recent auth work',
        narrative: 'auth today',
        epochOffset: 1000, // 1 second ago
      });
      // Old observation
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Old auth work',
        narrative: 'auth long ago',
        epochOffset: 7 * 24 * 60 * 60 * 1000, // 7 days ago
      });

      const now = Date.now();
      const result = engine.recall({
        query: 'auth',
        project: 'test-project',
        timeRange: {
          start: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date(now).toISOString(),
        },
      });

      // Should find the recent one but filter by time range
      expect(result.sourceCount).toBeGreaterThan(0);
    });

    it('should categorize observations into sections by type', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'feature',
        title: 'Implemented auth module',
        narrative: 'Built auth system',
      });
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'decision',
        title: 'Chose JWT over session tokens',
        narrative: 'Decided to use auth JWT',
      });

      const result = engine.recall({ query: 'auth', project: 'test-project' });

      const sectionTypes = result.sections.map(s => s.type);
      expect(sectionTypes).toContain('completed');
      expect(sectionTypes).toContain('decision');
    });
  });

  describe('recallTimeline', () => {
    it('should return "no activity" for empty project', () => {
      const result = engine.recallTimeline('test-project', 7);

      expect(result.narrative).toContain('No activity found');
      expect(result.sourceCount).toBe(0);
      expect(result.confidence).toBe('low');
    });

    it('should group observations by day', () => {
      createSession('cs-1', 'ms-1', 'test-project');

      // Today
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Today action 1',
        epochOffset: 1000,
      });
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Today action 2',
        epochOffset: 2000,
      });

      // Yesterday
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Yesterday action',
        epochOffset: 24 * 60 * 60 * 1000,
      });

      const result = engine.recallTimeline('test-project', 3);

      expect(result.sections.length).toBeGreaterThanOrEqual(2); // at least 2 day groups
      expect(result.sourceCount).toBeGreaterThan(0);
      expect(result.narrative).toContain('actions were recorded');
    });

    it('should include structured summary highlights', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Some work',
        epochOffset: 1000,
      });

      const structured = JSON.stringify({
        tasksCompleted: ['Built entire auth module'],
        tasksInProgress: [],
        decisionsMade: [],
        blockers: [],
        keyDiscoveries: [],
        resumeContext: '',
        sessionDuration: '30 minutes',
        observationCount: 5,
      });

      insertSummary({
        memorySessionId: 'ms-1',
        project: 'test-project',
        completed: 'Auth module',
        structured_summary: structured,
        epochOffset: 1000,
      });

      const result = engine.recallTimeline('test-project', 7);

      // Should include completions from structured summary
      const completedSection = result.sections.find(s => s.type === 'completed');
      expect(completedSection).toBeTruthy();
      expect(completedSection!.items).toContain('Built entire auth module');
    });

    it('should have high confidence with many observations', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      for (let i = 0; i < 10; i++) {
        insertObs({
          memorySessionId: 'ms-1',
          project: 'test-project',
          title: `Action ${i}`,
          epochOffset: i * 1000,
        });
      }

      const result = engine.recallTimeline('test-project', 1);
      expect(result.confidence).toBe('high');
    });
  });

  describe('recallStatus', () => {
    it('should return "no information" when topic not found', () => {
      const result = engine.recallStatus('test-project', 'nonexistent topic');

      expect(result.narrative).toContain('No information found');
      expect(result.sourceCount).toBe(0);
      expect(result.confidence).toBe('low');
    });

    it('should return "no topic specified" for empty topic', () => {
      const result = engine.recallStatus('test-project', '');
      expect(result.narrative).toContain('No topic specified');
    });

    it('should prefer compiled knowledge when available', () => {
      insertKnowledge('test-project', 'auth module', 'JWT-based authentication with refresh token rotation');

      const result = engine.recallStatus('test-project', 'auth');

      expect(result.narrative).toContain('auth');
      expect(result.confidence).toBe('high');
      expect(result.sections.some(s => s.type === 'discovery')).toBe(true);
    });

    it('should fall back to observations when no compiled knowledge', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'feature',
        title: 'Added auth validation',
        narrative: 'Implemented auth check in middleware',
      });

      const result = engine.recallStatus('test-project', 'auth');

      expect(result.sourceCount).toBeGreaterThan(0);
      expect(result.narrative).toContain('auth');
    });

    it('should categorize status results into completed/in_progress/decisions', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'feature',
        title: 'Implemented auth login',
        narrative: 'Completed auth login flow',
      });
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Auth refresh token',
        narrative: 'Started auth refresh token — WIP',
      });
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'decision',
        title: 'Auth: chose JWT over sessions',
      });

      const result = engine.recallStatus('test-project', 'auth');

      const types = result.sections.map(s => s.type);
      expect(types).toContain('completed');
      expect(types).toContain('in_progress');
      expect(types).toContain('decision');
    });
  });

  describe('buildNarrative', () => {
    it('should handle all section types', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'feature',
        title: 'Built auth',
        narrative: 'Completed auth module',
      });
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Auth tests WIP',
        narrative: 'Started auth tests but incomplete',
      });
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'decision',
        title: 'Use JWT for auth',
      });
      insertKnowledge('test-project', 'auth architecture', 'Microservices auth pattern');

      const result = engine.recall({ query: 'auth', project: 'test-project' });

      expect(result.narrative).toContain('Completed');
      expect(result.narrative).toContain('progress');
      expect(result.narrative).toContain('Decision');
      expect(result.narrative).toContain('finding');
    });

    it('should produce empty-state narrative when no sections match', () => {
      const result = engine.recall({ query: 'nonexistent-xyz', project: 'test-project' });
      expect(result.narrative).toBe('No relevant memories found for this query.');
    });
  });

  describe('queryRelevantData', () => {
    it('should aggregate from all sources', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'Auth observation',
        narrative: 'auth related',
      });
      insertKnowledge('test-project', 'auth topic', 'auth knowledge');
      insertSummary({
        memorySessionId: 'ms-1',
        project: 'test-project',
        request: 'What about auth',
        completed: 'auth stuff',
      });

      const result = engine.recall({ query: 'auth', project: 'test-project' });

      expect(result.sourceCount).toBeGreaterThanOrEqual(3);
    });
  });

  describe('confidence assessment', () => {
    it('should be high when compiled knowledge exists', () => {
      insertKnowledge('test-project', 'topic', 'knowledge about topic');

      const result = engine.recall({ query: 'topic', project: 'test-project' });
      expect(result.confidence).toBe('high');
    });

    it('should be medium with 4+ observations but no compiled knowledge', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      for (let i = 0; i < 5; i++) {
        insertObs({
          memorySessionId: 'ms-1',
          project: 'test-project',
          title: `Topic action ${i}`,
          narrative: `About topic ${i}`,
        });
      }

      const result = engine.recall({ query: 'topic', project: 'test-project' });
      expect(result.confidence).toBe('medium');
    });

    it('should be low with sparse observations', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'One topic thing',
        narrative: 'about topic',
      });

      const result = engine.recall({ query: 'topic', project: 'test-project' });
      expect(result.confidence).toBe('low');
    });
  });

  describe('section types', () => {
    it('should correctly categorize feature observations as completed', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'feature',
        title: 'Built new API',
        narrative: 'feature related API work',
      });

      const result = engine.recall({ query: 'API', project: 'test-project' });
      const completed = result.sections.filter(s => s.type === 'completed');
      expect(completed.length).toBeGreaterThan(0);
    });

    it('should correctly categorize WIP observations as in_progress', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        title: 'API routes',
        narrative: 'WIP: building new API routes',
      });

      const result = engine.recall({ query: 'API', project: 'test-project' });
      const inProgress = result.sections.filter(s => s.type === 'in_progress');
      expect(inProgress.length).toBeGreaterThan(0);
    });

    it('should correctly categorize decision observations', () => {
      createSession('cs-1', 'ms-1', 'test-project');
      insertObs({
        memorySessionId: 'ms-1',
        project: 'test-project',
        type: 'decision',
        title: 'Use REST over GraphQL for API',
      });

      const result = engine.recall({ query: 'API', project: 'test-project' });
      const decisions = result.sections.filter(s => s.type === 'decision');
      expect(decisions.length).toBeGreaterThan(0);
    });
  });
});
