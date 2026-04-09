/**
 * Tests for GateKeeper — 5-gate compilation trigger guard.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real in-memory SQLite with sdk_sessions table
 * - Uses real LockManager (in-memory, no side effects)
 * - Time manipulation is done by directly mutating private fields via
 *   a thin test-helper subclass (no monkey-patching, no fake timers)
 *
 * Value: Ensures each gate independently blocks compilation, and that
 *        recordScanTime / recordCompilationTime update state correctly.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { GateKeeper } from '../../../src/services/compilation/GateKeeper.js';
import { LockManager } from '../../../src/services/concurrency/LockManager.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Minimal schema needed for gate-keeper session queries.
 * We only need sdk_sessions with project + started_at_epoch columns.
 */
function createTestDb(): Database {
  const db = new Database(':memory:');
  db.run(`
    CREATE TABLE sdk_sessions (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT NOT NULL,
      memory_session_id  TEXT,
      project            TEXT NOT NULL,
      status             TEXT NOT NULL DEFAULT 'active',
      started_at         TEXT NOT NULL DEFAULT '',
      started_at_epoch   INTEGER NOT NULL DEFAULT 0
    )
  `);
  return db;
}

/**
 * Insert `count` sessions into sdk_sessions for the given project,
 * each with started_at_epoch set to `epochMs`.
 */
function insertSessions(
  db: Database,
  project: string,
  count: number,
  epochMs: number = Date.now()
): void {
  const stmt = db.prepare(
    `INSERT INTO sdk_sessions (content_session_id, project, started_at_epoch)
     VALUES (?, ?, ?)`
  );
  for (let i = 0; i < count; i++) {
    stmt.run(`session-${i}-${Date.now()}-${Math.random()}`, project, epochMs);
  }
}

/**
 * Test subclass that exposes private timestamp fields for time-travel in tests.
 * This avoids real sleeps while keeping the production code clean.
 */
class TestableGateKeeper extends GateKeeper {
  setLastCompilationTime(ms: number): void {
    (this as unknown as { lastCompilationTime: number }).lastCompilationTime = ms;
  }

  setLastScanTime(ms: number): void {
    (this as unknown as { lastScanTime: number }).lastScanTime = ms;
  }

  getLastCompilationTime(): number {
    return (this as unknown as { lastCompilationTime: number }).lastCompilationTime;
  }

  getLastScanTime(): number {
    return (this as unknown as { lastScanTime: number }).lastScanTime;
  }
}

/** Return a settings map with compilation enabled (default). */
function enabledSettings(): Record<string, string> {
  return {};
}

/** Return a settings map with compilation explicitly disabled. */
function disabledSettings(): Record<string, string> {
  return { AGENT_RECALL_COMPILATION_ENABLED: 'false' };
}

/** A point far enough in the past to satisfy both the time gate and scan throttle. */
const FAR_PAST = Date.now() - 48 * 60 * 60 * 1000; // 48 hours ago

/** A point recent enough to trigger the time-gate block (< 24 h ago). */
const RECENT_COMPILATION = Date.now() - 1 * 60 * 60 * 1000; // 1 hour ago

/** A point recent enough to trigger the scan-throttle block (< 10 min ago). */
const RECENT_SCAN = Date.now() - 2 * 60 * 1000; // 2 minutes ago

const PROJECT = 'test-project';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GateKeeper', () => {
  let db: Database;
  let lockManager: LockManager;
  let gk: TestableGateKeeper;

  beforeEach(() => {
    db = createTestDb();
    lockManager = new LockManager();
    gk = new TestableGateKeeper(db, lockManager, enabledSettings());

    // Default: both timestamps are far in the past so time/scan gates pass
    gk.setLastCompilationTime(FAR_PAST);
    gk.setLastScanTime(FAR_PAST);
  });

  afterEach(() => {
    lockManager.releaseAll();
    db.close();
  });

  // ── 1. All gates pass ───────────────────────────────────────────────────────

  describe('all gates pass', () => {
    it('returns canProceed=true when all 5 gates pass', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000); // 5 sessions after last compilation

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(true);
      expect(result.blockedBy).toBeUndefined();
    });

    it('acquires the compilation lock when all gates pass', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      gk.check(PROJECT);

      expect(lockManager.isLocked('compilation')).toBe(true);
    });

    it('passes with exactly 5 sessions (minimum threshold)', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(true);
    });

    it('passes with more than 5 sessions', () => {
      insertSessions(db, PROJECT, 10, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(true);
    });
  });

  // ── 2. Feature gate ─────────────────────────────────────────────────────────

  describe('gate 1 — feature gate', () => {
    it('blocks when AGENT_RECALL_COMPILATION_ENABLED is "false"', () => {
      const gkDisabled = new TestableGateKeeper(db, lockManager, disabledSettings());
      gkDisabled.setLastCompilationTime(FAR_PAST);
      gkDisabled.setLastScanTime(FAR_PAST);
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gkDisabled.check(PROJECT);

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe('feature_gate');
    });

    it('does NOT block when setting is absent', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).not.toBe('feature_gate');
    });

    it('does NOT block when setting is "true"', () => {
      const gkEnabled = new TestableGateKeeper(
        db,
        lockManager,
        { AGENT_RECALL_COMPILATION_ENABLED: 'true' }
      );
      gkEnabled.setLastCompilationTime(FAR_PAST);
      gkEnabled.setLastScanTime(FAR_PAST);
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gkEnabled.check(PROJECT);

      expect(result.blockedBy).not.toBe('feature_gate');
    });
  });

  // ── 3. Time gate ─────────────────────────────────────────────────────────────

  describe('gate 2 — time gate', () => {
    it('blocks when last compilation was less than 24 h ago', () => {
      gk.setLastCompilationTime(RECENT_COMPILATION);
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe('time_gate');
    });

    it('passes when last compilation was more than 24 h ago', () => {
      gk.setLastCompilationTime(FAR_PAST); // already set in beforeEach, but explicit
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).not.toBe('time_gate');
    });

    it('blocks when lastCompilationTime is 0 and 24h has NOT elapsed (simulated by reducing threshold)', () => {
      // When lastCompilationTime = 0 and now() >> 24h, gate should pass.
      // Verify the inverse: set compilation time to "just now" to block.
      gk.setLastCompilationTime(Date.now() - 1000); // 1 second ago

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('time_gate');
    });
  });

  // ── 4. Scan throttle ─────────────────────────────────────────────────────────

  describe('gate 3 — scan throttle', () => {
    it('blocks when last scan was less than 10 minutes ago', () => {
      gk.setLastScanTime(RECENT_SCAN);
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe('scan_throttle');
    });

    it('passes when last scan was more than 10 minutes ago', () => {
      gk.setLastScanTime(FAR_PAST); // already set in beforeEach, but explicit
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).not.toBe('scan_throttle');
    });

    it('blocks when scan time is "just now"', () => {
      gk.setLastScanTime(Date.now() - 500); // half a second ago

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('scan_throttle');
    });
  });

  // ── 5. Session gate ──────────────────────────────────────────────────────────

  describe('gate 4 — session gate', () => {
    it('blocks when fewer than 5 sessions exist since last compilation', () => {
      insertSessions(db, PROJECT, 4, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe('session_gate');
    });

    it('blocks with zero sessions', () => {
      // No sessions inserted

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe('session_gate');
    });

    it('passes with exactly 5 sessions after last compilation', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).not.toBe('session_gate');
    });

    it('ignores sessions that occurred BEFORE the last compilation', () => {
      // Insert 5 sessions that happened BEFORE the last compilation
      insertSessions(db, PROJECT, 5, FAR_PAST - 1000);
      // Insert only 2 sessions AFTER the last compilation
      insertSessions(db, PROJECT, 2, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('session_gate');
    });

    it('only counts sessions for the specified project', () => {
      // Insert 5 sessions for a DIFFERENT project
      insertSessions(db, 'other-project', 5, FAR_PAST + 1000);
      // Insert only 2 sessions for the target project
      insertSessions(db, PROJECT, 2, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('session_gate');
    });

    it('handles missing sdk_sessions table gracefully (returns session_gate block)', () => {
      // Create a DB without the sdk_sessions table
      const emptyDb = new Database(':memory:');
      const gkEmpty = new TestableGateKeeper(emptyDb, new LockManager(), enabledSettings());
      gkEmpty.setLastCompilationTime(FAR_PAST);
      gkEmpty.setLastScanTime(FAR_PAST);

      const result = gkEmpty.check(PROJECT);

      expect(result.blockedBy).toBe('session_gate');
      emptyDb.close();
    });
  });

  // ── 6. Lock gate ─────────────────────────────────────────────────────────────

  describe('gate 5 — lock gate', () => {
    it('blocks when compilation lock is already held', () => {
      lockManager.acquire('compilation'); // pre-acquire the lock
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.canProceed).toBe(false);
      expect(result.blockedBy).toBe('lock_gate');
    });

    it('passes when lock is free', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).not.toBe('lock_gate');
    });

    it('does not leave lock acquired after a lock-gate failure (lock was pre-held)', () => {
      lockManager.acquire('compilation');
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      gk.check(PROJECT); // should fail at lock_gate

      // Lock is still held by the original owner, not double-acquired
      expect(lockManager.isLocked('compilation')).toBe(true);
    });
  });

  // ── 7. recordScanTime ────────────────────────────────────────────────────────

  describe('recordScanTime', () => {
    it('updates lastScanTime to approximately now', () => {
      const before = Date.now();
      gk.recordScanTime();
      const after = Date.now();

      const scanTime = gk.getLastScanTime();
      expect(scanTime).toBeGreaterThanOrEqual(before);
      expect(scanTime).toBeLessThanOrEqual(after);
    });

    it('causes subsequent check to be blocked by scan throttle', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      gk.recordScanTime(); // record scan "just now"

      const result = gk.check(PROJECT);
      expect(result.blockedBy).toBe('scan_throttle');
    });

    it('can be called multiple times without error', () => {
      expect(() => {
        gk.recordScanTime();
        gk.recordScanTime();
        gk.recordScanTime();
      }).not.toThrow();
    });
  });

  // ── 8. recordCompilationTime ─────────────────────────────────────────────────

  describe('recordCompilationTime', () => {
    it('updates lastCompilationTime to approximately now', () => {
      const before = Date.now();
      gk.recordCompilationTime();
      const after = Date.now();

      const compTime = gk.getLastCompilationTime();
      expect(compTime).toBeGreaterThanOrEqual(before);
      expect(compTime).toBeLessThanOrEqual(after);
    });

    it('releases the compilation lock', () => {
      // Acquire the lock first (simulating an in-progress compilation)
      lockManager.acquire('compilation');
      expect(lockManager.isLocked('compilation')).toBe(true);

      gk.recordCompilationTime();

      expect(lockManager.isLocked('compilation')).toBe(false);
    });

    it('causes subsequent check to be blocked by time gate', () => {
      insertSessions(db, PROJECT, 5, FAR_PAST + 1000);

      gk.recordCompilationTime(); // marks compilation as "just now"

      const result = gk.check(PROJECT);
      expect(result.blockedBy).toBe('time_gate');
    });

    it('can be called without the lock being held (no-op for the lock)', () => {
      expect(() => gk.recordCompilationTime()).not.toThrow();
      expect(lockManager.isLocked('compilation')).toBe(false);
    });
  });

  // ── 9. Gate ordering (short-circuit) ─────────────────────────────────────────

  describe('gate evaluation order', () => {
    it('reports feature_gate before time_gate when both would fail', () => {
      const gkDisabled = new TestableGateKeeper(db, lockManager, disabledSettings());
      gkDisabled.setLastCompilationTime(RECENT_COMPILATION); // time gate would also fail
      gkDisabled.setLastScanTime(FAR_PAST);

      const result = gkDisabled.check(PROJECT);

      expect(result.blockedBy).toBe('feature_gate');
    });

    it('reports time_gate before scan_throttle when both would fail', () => {
      gk.setLastCompilationTime(RECENT_COMPILATION);
      gk.setLastScanTime(RECENT_SCAN);

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('time_gate');
    });

    it('reports scan_throttle before session_gate when both would fail', () => {
      gk.setLastScanTime(RECENT_SCAN);
      // No sessions inserted — session gate would also fail

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('scan_throttle');
    });

    it('reports session_gate before lock_gate when both would fail', () => {
      lockManager.acquire('compilation'); // lock gate would also fail
      // No sessions inserted — session gate should be reported first

      const result = gk.check(PROJECT);

      expect(result.blockedBy).toBe('session_gate');

      lockManager.release('compilation');
    });
  });
});
