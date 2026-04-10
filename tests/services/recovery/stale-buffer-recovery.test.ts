/**
 * StaleBufferRecovery Tests
 *
 * Validates that stale observation buffers from interrupted sessions are
 * properly recovered on Worker startup. Uses in-memory SQLite database.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ClaudeMemDatabase } from '../../../src/services/sqlite/Database.js';
import { WriteBuffer } from '../../../src/services/concurrency/WriteBuffer.js';
import { recoverStaleBuffers, markSessionInterrupted } from '../../../src/services/recovery/StaleBufferRecovery.js';
import type { Database } from 'bun:sqlite';

describe('StaleBufferRecovery', () => {
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
  function createSession(contentSessionId: string, project: string = 'test-project', status: string = 'active'): void {
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
        title: `Observation ${i + 1} for ${sessionId}`,
        narrative: `Test narrative ${i + 1}`,
      });
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

  describe('recoverStaleBuffers', () => {
    it('should return 0 when buffer is empty', () => {
      const recovered = recoverStaleBuffers(db);
      expect(recovered).toBe(0);
    });

    it('should flush stale entries from one session', () => {
      createSession('session-1');
      writeToBuffer('session-1', 3);

      expect(getBufferCount()).toBe(3);
      expect(getObservationCount()).toBe(0);

      const recovered = recoverStaleBuffers(db);

      expect(recovered).toBe(3);
      expect(getBufferCount()).toBe(0);
      expect(getObservationCount()).toBe(3);
    });

    it('should flush stale entries from multiple sessions separately', () => {
      createSession('session-a');
      createSession('session-b');
      writeToBuffer('session-a', 2);
      writeToBuffer('session-b', 4);

      expect(getBufferCount()).toBe(6);

      const recovered = recoverStaleBuffers(db);

      expect(recovered).toBe(6);
      expect(getBufferCount()).toBe(0);
      expect(getObservationCount()).toBe(6);
    });

    it('should leave buffer empty after recovery', () => {
      createSession('session-1');
      writeToBuffer('session-1', 5);

      recoverStaleBuffers(db);

      expect(getBufferCount()).toBe(0);
    });

    it('should mark recovered sessions as interrupted', () => {
      createSession('session-1');
      writeToBuffer('session-1', 2);

      expect(getSessionStatus('session-1')).toBe('active');

      recoverStaleBuffers(db);

      expect(getSessionStatus('session-1')).toBe('interrupted');
    });

    it('should mark multiple recovered sessions as interrupted', () => {
      createSession('session-x');
      createSession('session-y');
      writeToBuffer('session-x', 1);
      writeToBuffer('session-y', 1);

      recoverStaleBuffers(db);

      expect(getSessionStatus('session-x')).toBe('interrupted');
      expect(getSessionStatus('session-y')).toBe('interrupted');
    });

    it('should be idempotent - running twice does nothing on second run', () => {
      createSession('session-1');
      writeToBuffer('session-1', 3);

      const firstRun = recoverStaleBuffers(db);
      expect(firstRun).toBe(3);
      expect(getObservationCount()).toBe(3);

      const secondRun = recoverStaleBuffers(db);
      expect(secondRun).toBe(0);
      expect(getObservationCount()).toBe(3); // no duplicates
    });

    it('should not affect already-completed sessions', () => {
      createSession('session-done', 'test-project', 'completed');
      writeToBuffer('session-done', 2);

      recoverStaleBuffers(db);

      // Buffer should still be flushed (data recovery is important)
      expect(getBufferCount()).toBe(0);
      expect(getObservationCount()).toBe(2);
      // But status should remain 'completed' since markSessionInterrupted only changes 'active'
      expect(getSessionStatus('session-done')).toBe('completed');
    });

    it('should handle buffer entries with no matching session gracefully', () => {
      // Buffer entry for a session that does not exist in sdk_sessions
      writeToBuffer('orphan-session', 2);

      // Should not crash — orphaned entries are cleared (cannot flush due to FK constraint)
      const recovered = recoverStaleBuffers(db);
      expect(recovered).toBe(0); // FK prevents flush, so 0 recovered
      expect(getBufferCount()).toBe(0); // orphaned entries cleaned up
      expect(getObservationCount()).toBe(0); // nothing inserted to observations
    });

    it('should preserve observation data fields after flush', () => {
      createSession('session-1');

      const buffer = new WriteBuffer(db);
      buffer.write('session-1', {
        project: 'my-project',
        type: 'feature',
        title: 'Important observation title',
        narrative: 'Detailed narrative text',
      });

      recoverStaleBuffers(db);

      const obs = db.prepare('SELECT * FROM observations WHERE memory_session_id = ?').get('session-1') as any;
      expect(obs).toBeTruthy();
      expect(obs.project).toBe('my-project');
      expect(obs.type).toBe('feature');
      // The text field stores the full JSON payload
      const payload = JSON.parse(obs.text);
      expect(payload.title).toBe('Important observation title');
      expect(payload.narrative).toBe('Detailed narrative text');
    });
  });

  describe('markSessionInterrupted', () => {
    it('should mark an active session as interrupted by content_session_id', () => {
      createSession('session-1');
      expect(getSessionStatus('session-1')).toBe('active');

      markSessionInterrupted(db, 'session-1');

      expect(getSessionStatus('session-1')).toBe('interrupted');
    });

    it('should not change status of already completed sessions', () => {
      createSession('session-done', 'test-project', 'completed');

      markSessionInterrupted(db, 'session-done');

      expect(getSessionStatus('session-done')).toBe('completed');
    });

    it('should not change status of already failed sessions', () => {
      createSession('session-fail', 'test-project', 'failed');

      markSessionInterrupted(db, 'session-fail');

      expect(getSessionStatus('session-fail')).toBe('failed');
    });

    it('should not crash when session does not exist', () => {
      // Should complete without error
      markSessionInterrupted(db, 'nonexistent-session');
    });
  });
});
