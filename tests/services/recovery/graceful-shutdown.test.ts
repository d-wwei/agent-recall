/**
 * Graceful Shutdown / Emergency Save Tests
 *
 * Validates that the emergency save logic correctly flushes buffers,
 * saves checkpoints, and marks sessions as interrupted during shutdown.
 * Uses in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import { WriteBuffer } from '../../../src/services/concurrency/WriteBuffer.js';
import { performEmergencySave } from '../../../src/services/recovery/EmergencySave.js';
import { CheckpointService } from '../../../src/services/recovery/CheckpointService.js';
import type { Database } from 'bun:sqlite';

describe('EmergencySave (Graceful Shutdown)', () => {
  let db: Database;

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
  });

  afterEach(() => {
    db.close();
  });

  /**
   * Helper: create a session in sdk_sessions
   */
  function createSession(
    contentSessionId: string,
    project: string = 'test-project',
    status: string = 'active'
  ): void {
    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, status)
      VALUES (?, ?, ?, 'test prompt', datetime('now'), ?, ?)
    `).run(contentSessionId, contentSessionId, project, Date.now(), status);
  }

  /**
   * Helper: write entries to observation_buffer
   */
  function writeToBuffer(sessionId: string, count: number = 1): void {
    const buffer = new WriteBuffer(db);
    for (let i = 0; i < count; i++) {
      buffer.write(sessionId, {
        project: 'test-project',
        type: 'observation',
        title: `Observation ${i + 1}`,
        narrative: `Narrative ${i + 1}`,
      });
    }
  }

  /**
   * Helper: create observations directly (for checkpoint building)
   */
  function createObservation(sessionId: string, title: string, filesModified?: string): void {
    db.prepare(`
      INSERT INTO observations (memory_session_id, project, type, title, narrative, text, created_at, created_at_epoch)
      VALUES (?, 'test-project', 'observation', ?, 'test narrative', '{}', datetime('now'), ?)
    `).run(sessionId, title, Date.now());

    if (filesModified) {
      db.prepare('UPDATE observations SET files_modified = ? WHERE title = ?').run(filesModified, title);
    }
  }

  /**
   * Helper: get buffer count
   */
  function getBufferCount(): number {
    const result = db.prepare('SELECT COUNT(*) as count FROM observation_buffer').get() as { count: number };
    return result.count;
  }

  /**
   * Helper: get observation count
   */
  function getObservationCount(): number {
    const result = db.prepare('SELECT COUNT(*) as count FROM observations').get() as { count: number };
    return result.count;
  }

  /**
   * Helper: get session status
   */
  function getSessionStatus(contentSessionId: string): string | null {
    const row = db.prepare('SELECT status FROM sdk_sessions WHERE content_session_id = ?').get(contentSessionId) as { status: string } | undefined;
    return row?.status ?? null;
  }

  describe('performEmergencySave', () => {
    it('should flush all observation buffers', () => {
      createSession('session-1');
      writeToBuffer('session-1', 3);

      expect(getBufferCount()).toBe(3);

      const result = performEmergencySave(db);

      expect(result.buffersFlushed).toBe(3);
      expect(getBufferCount()).toBe(0);
      expect(getObservationCount()).toBe(3);
    });

    it('should flush buffers from multiple sessions', () => {
      createSession('session-a');
      createSession('session-b');
      writeToBuffer('session-a', 2);
      writeToBuffer('session-b', 4);

      const result = performEmergencySave(db);

      expect(result.buffersFlushed).toBe(6);
      expect(getBufferCount()).toBe(0);
    });

    it('should create checkpoint for active sessions with observations', () => {
      createSession('session-1');
      createObservation('session-1', 'Edited auth module');
      createObservation('session-1', 'Ran tests');

      const result = performEmergencySave(db);

      expect(result.checkpointsSaved).toBe(1);

      // Verify checkpoint was saved
      const checkpointService = new CheckpointService(db);
      const checkpoint = checkpointService.getLatestCheckpoint('test-project');
      expect(checkpoint).toBeTruthy();
      expect(checkpoint!.resumeHint).toContain('interrupted by terminal close');
    });

    it('should mark active sessions as interrupted', () => {
      createSession('session-1');
      createObservation('session-1', 'Some work');

      expect(getSessionStatus('session-1')).toBe('active');

      const result = performEmergencySave(db);

      expect(result.sessionsInterrupted).toBe(1);
      expect(getSessionStatus('session-1')).toBe('interrupted');
    });

    it('should mark multiple active sessions as interrupted', () => {
      createSession('session-x');
      createSession('session-y');
      createObservation('session-x', 'Work X');
      createObservation('session-y', 'Work Y');

      const result = performEmergencySave(db);

      expect(result.sessionsInterrupted).toBe(2);
      expect(getSessionStatus('session-x')).toBe('interrupted');
      expect(getSessionStatus('session-y')).toBe('interrupted');
    });

    it('should work with no active sessions (no crash)', () => {
      // No sessions at all
      const result = performEmergencySave(db);

      expect(result.buffersFlushed).toBe(0);
      expect(result.checkpointsSaved).toBe(0);
      expect(result.sessionsInterrupted).toBe(0);
    });

    it('should work with no stale buffers (no crash)', () => {
      createSession('session-1');
      // No buffer entries, but session exists

      const result = performEmergencySave(db);

      expect(result.buffersFlushed).toBe(0);
      // Session has no observations so no checkpoint saved
      expect(result.checkpointsSaved).toBe(0);
      // Session is still marked interrupted
      expect(result.sessionsInterrupted).toBe(1);
    });

    it('should not affect completed sessions', () => {
      createSession('session-done', 'test-project', 'completed');

      const result = performEmergencySave(db);

      // Only active sessions should be processed
      expect(result.sessionsInterrupted).toBe(0);
      expect(getSessionStatus('session-done')).toBe('completed');
    });

    it('should not affect failed sessions', () => {
      createSession('session-fail', 'test-project', 'failed');

      const result = performEmergencySave(db);

      expect(result.sessionsInterrupted).toBe(0);
      expect(getSessionStatus('session-fail')).toBe('failed');
    });

    it('should include interrupted message in checkpoint resume hint', () => {
      createSession('session-1');
      createObservation('session-1', 'Editing auth');

      performEmergencySave(db);

      const checkpointService = new CheckpointService(db);
      const checkpoint = checkpointService.getLatestCheckpoint('test-project');
      expect(checkpoint).toBeTruthy();
      expect(checkpoint!.resumeHint).toMatch(/Session was interrupted by terminal close/);
    });

    it('should handle both buffers and active sessions together', () => {
      createSession('session-1');
      writeToBuffer('session-1', 2);
      createObservation('session-1', 'Prior work');

      const result = performEmergencySave(db);

      expect(result.buffersFlushed).toBe(2);
      expect(result.checkpointsSaved).toBe(1);
      expect(result.sessionsInterrupted).toBe(1);
      expect(getBufferCount()).toBe(0);
      expect(getSessionStatus('session-1')).toBe('interrupted');
    });

    it('should handle orphaned buffer entries gracefully', () => {
      // Buffer entry for non-existent session
      const buffer = new WriteBuffer(db);
      buffer.write('ghost-session', { project: 'test', type: 'obs', title: 'ghost' });

      // Should not throw
      const result = performEmergencySave(db);

      // Orphaned entries should be cleaned up
      expect(getBufferCount()).toBe(0);
      expect(result.buffersFlushed).toBe(0);
    });
  });
});
