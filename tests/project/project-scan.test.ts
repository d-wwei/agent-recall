/**
 * ProjectScanService tests
 * Tests project scanning with in-memory database
 *
 * Sources:
 * - Test pattern from tests/sqlite/sessions.test.ts
 * - Database setup from src/services/sqlite/Database.ts (ClaudeMemDatabase)
 * - Service under test: src/services/project/ProjectScanService.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { ProjectScanService } from '../../src/services/project/ProjectScanService.js';
import type { Database } from 'bun:sqlite';

describe('ProjectScanService', () => {
  let db: Database;
  let service: ProjectScanService;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    service = new ProjectScanService(db);
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Helper: insert an sdk_session row and return its numeric id.
   */
  function insertSession(
    contentSessionId: string,
    project: string,
    startedAtEpoch: number,
    completedAtEpoch?: number
  ): number {
    const startedAt = new Date(startedAtEpoch).toISOString();
    const completedAt = completedAtEpoch ? new Date(completedAtEpoch).toISOString() : null;

    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, project, started_at, started_at_epoch, completed_at, completed_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, 'completed')
    `).run(contentSessionId, project, startedAt, startedAtEpoch, completedAt, completedAtEpoch ?? null);

    const row = db.prepare('SELECT id, memory_session_id FROM sdk_sessions WHERE content_session_id = ?').get(contentSessionId) as { id: number; memory_session_id: string | null };

    // Set memory_session_id so observations can reference it
    const memoryId = `mem-${contentSessionId}`;
    db.prepare('UPDATE sdk_sessions SET memory_session_id = ? WHERE id = ?').run(memoryId, row.id);

    return row.id;
  }

  /**
   * Helper: insert an observation row linked to a session's memory_session_id.
   */
  function insertObservation(sessionId: number, project: string): void {
    const session = db.prepare('SELECT memory_session_id FROM sdk_sessions WHERE id = ?').get(sessionId) as { memory_session_id: string };
    const now = Date.now();
    db.prepare(`
      INSERT INTO observations (memory_session_id, project, text, type, created_at, created_at_epoch)
      VALUES (?, ?, 'test observation', 'tool_use', ?, ?)
    `).run(session.memory_session_id, project, new Date(now).toISOString(), now);
  }

  /**
   * Helper: insert a session_summaries row linked to a session's memory_session_id.
   */
  function insertSummary(sessionId: number, project: string): void {
    const session = db.prepare('SELECT memory_session_id FROM sdk_sessions WHERE id = ?').get(sessionId) as { memory_session_id: string };
    const now = Date.now();
    db.prepare(`
      INSERT INTO session_summaries (memory_session_id, project, request, created_at, created_at_epoch)
      VALUES (?, ?, 'test summary', ?, ?)
    `).run(session.memory_session_id, project, new Date(now).toISOString(), now);
  }

  /**
   * Helper: insert an agent_profiles row for a given scope.
   */
  function insertProfile(scope: string): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    db.prepare(`
      INSERT OR IGNORE INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch)
      VALUES (?, 'user', '{"name":"test"}', ?, ?)
    `).run(scope, now, nowEpoch);
  }

  // ------------------------------------------
  // Test cases
  // ------------------------------------------

  it('returns empty array when no projects exist', () => {
    const results = service.scanProjects();
    expect(results).toEqual([]);
  });

  it('returns correct counts for sessions, observations, and summaries', () => {
    const epoch = Date.parse('2026-01-15T00:00:00Z');

    // Create 2 sessions for the same project
    const s1 = insertSession('sess-1', 'my-project', epoch, epoch + 3600000);
    const s2 = insertSession('sess-2', 'my-project', epoch + 7200000, epoch + 10800000);

    // Add 3 observations across the sessions
    insertObservation(s1, 'my-project');
    insertObservation(s1, 'my-project');
    insertObservation(s2, 'my-project');

    // Add 1 summary
    insertSummary(s1, 'my-project');

    const results = service.scanProjects();
    expect(results).toHaveLength(1);

    const proj = results[0];
    expect(proj.project).toBe('my-project');
    expect(proj.session_count).toBe(2);
    expect(proj.observation_count).toBe(3);
    expect(proj.summary_count).toBe(1);
  });

  it('returns correct date ranges (first_seen / last_seen)', () => {
    const jan1 = Date.parse('2026-01-01T00:00:00Z');
    const mar15 = Date.parse('2026-03-15T00:00:00Z');
    const apr1 = Date.parse('2026-04-01T00:00:00Z');

    insertSession('sess-a', 'date-project', jan1, mar15);
    insertSession('sess-b', 'date-project', mar15, apr1);

    const results = service.scanProjects();
    expect(results).toHaveLength(1);

    const proj = results[0];
    // first_seen should be the earliest started_at_epoch
    expect(proj.first_seen).toBe(new Date(jan1).toISOString());
    // last_seen should be the latest completed_at_epoch
    expect(proj.last_seen).toBe(new Date(apr1).toISOString());
  });

  it('correctly detects has_persona true when profile exists', () => {
    const epoch = Date.parse('2026-02-01T00:00:00Z');
    insertSession('sess-p1', 'persona-project', epoch);
    insertProfile('persona-project');

    const results = service.scanProjects();
    expect(results).toHaveLength(1);
    expect(results[0].has_persona).toBe(true);
  });

  it('correctly detects has_persona false when no profile exists', () => {
    const epoch = Date.parse('2026-02-01T00:00:00Z');
    insertSession('sess-p2', 'no-persona-project', epoch);

    const results = service.scanProjects();
    expect(results).toHaveLength(1);
    expect(results[0].has_persona).toBe(false);
  });

  it('does not treat global profile as project persona', () => {
    const epoch = Date.parse('2026-02-01T00:00:00Z');
    insertSession('sess-g', 'some-project', epoch);
    insertProfile('global');

    const results = service.scanProjects();
    expect(results).toHaveLength(1);
    expect(results[0].has_persona).toBe(false);
  });

  it('results are sorted by last_seen descending', () => {
    const jan = Date.parse('2026-01-01T00:00:00Z');
    const feb = Date.parse('2026-02-01T00:00:00Z');
    const mar = Date.parse('2026-03-01T00:00:00Z');

    // oldest project has latest start but no completion
    insertSession('sess-old', 'old-project', jan);
    // middle project
    insertSession('sess-mid', 'mid-project', jan, feb);
    // newest project
    insertSession('sess-new', 'new-project', feb, mar);

    const results = service.scanProjects();
    expect(results).toHaveLength(3);
    expect(results[0].project).toBe('new-project');
    expect(results[1].project).toBe('mid-project');
    expect(results[2].project).toBe('old-project');
  });

  it('handles multiple projects with varying data', () => {
    const epoch = Date.parse('2026-01-01T00:00:00Z');

    // Project A: 1 session, 2 observations, 0 summaries, no persona
    const sA = insertSession('sess-a1', 'project-a', epoch);
    insertObservation(sA, 'project-a');
    insertObservation(sA, 'project-a');

    // Project B: 2 sessions, 0 observations, 1 summary, has persona
    const sB1 = insertSession('sess-b1', 'project-b', epoch + 1000);
    const sB2 = insertSession('sess-b2', 'project-b', epoch + 2000, epoch + 5000);
    insertSummary(sB1, 'project-b');
    insertProfile('project-b');

    const results = service.scanProjects();
    expect(results).toHaveLength(2);

    // project-b should come first (last_seen = epoch + 5000)
    const projB = results[0];
    expect(projB.project).toBe('project-b');
    expect(projB.session_count).toBe(2);
    expect(projB.observation_count).toBe(0);
    expect(projB.summary_count).toBe(1);
    expect(projB.has_persona).toBe(true);

    const projA = results[1];
    expect(projA.project).toBe('project-a');
    expect(projA.session_count).toBe(1);
    expect(projA.observation_count).toBe(2);
    expect(projA.summary_count).toBe(0);
    expect(projA.has_persona).toBe(false);
  });
});
