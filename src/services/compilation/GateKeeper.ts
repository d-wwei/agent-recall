/**
 * GateKeeper - 5-gate compilation trigger guard.
 *
 * All five gates must pass before a compilation run is allowed to proceed.
 * Gates are evaluated in order; the first failing gate short-circuits the check.
 *
 * Gates:
 *  1. Feature gate  — compilation must not be explicitly disabled via settings
 *  2. Time gate     — at least 24 hours since the last successful compilation
 *  3. Scan throttle — at least 10 minutes since the last gate check
 *  4. Session gate  — at least 5 new sessions recorded since last compilation
 *  5. Lock gate     — no other compilation is currently in progress
 */

import { Database } from 'bun:sqlite';
import { LockManager } from '../concurrency/LockManager.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum elapsed time (ms) between compilations: 24 hours */
const COMPILATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Minimum elapsed time (ms) between gate checks: 10 minutes */
const SCAN_THROTTLE_MS = 10 * 60 * 1000;

/** Minimum number of new sessions required to trigger a compilation */
const MIN_NEW_SESSIONS = 5;

/** Lock name used to prevent concurrent compilations */
const COMPILATION_LOCK = 'compilation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GateCheckResult {
  canProceed: boolean;
  /** Name of the gate that blocked the check, if any. */
  blockedBy?: string;
}

// ─── GateKeeper ───────────────────────────────────────────────────────────────

export class GateKeeper {
  /** Epoch ms of the last successful compilation (in-memory). */
  private lastCompilationTime: number = 0;

  /** Epoch ms of the last gate check (in-memory). */
  private lastScanTime: number = 0;

  constructor(
    private readonly db: Database,
    private readonly lockManager: LockManager,
    private readonly settings: Record<string, string>
  ) {}

  /**
   * Run all five gates in sequence.
   *
   * Returns `{ canProceed: true }` only when every gate passes.
   * Returns `{ canProceed: false, blockedBy: '<gate_name>' }` on the first failure.
   *
   * NOTE: The lock gate **acquires** the compilation lock when it passes, so the
   * caller is responsible for releasing it (via `recordCompilationTime()` or
   * directly via `lockManager.release('compilation')`).
   */
  check(project: string): GateCheckResult {
    // Gate 1 — Feature gate
    if (this.settings['AGENT_RECALL_COMPILATION_ENABLED'] === 'false') {
      return { canProceed: false, blockedBy: 'feature_gate' };
    }

    // Gate 2 — Time gate (minimum 24 h between compilations)
    const now = Date.now();
    if (now - this.lastCompilationTime < COMPILATION_INTERVAL_MS) {
      return { canProceed: false, blockedBy: 'time_gate' };
    }

    // Gate 3 — Scan throttle (minimum 10 min between gate checks)
    if (now - this.lastScanTime < SCAN_THROTTLE_MS) {
      return { canProceed: false, blockedBy: 'scan_throttle' };
    }

    // Gate 4 — Session gate (≥ 5 new sessions since last compilation)
    const newSessionCount = this.countNewSessions(project);
    if (newSessionCount < MIN_NEW_SESSIONS) {
      return { canProceed: false, blockedBy: 'session_gate' };
    }

    // Gate 5 — Lock gate (no concurrent compilation in progress)
    const acquired = this.lockManager.acquire(COMPILATION_LOCK);
    if (!acquired) {
      return { canProceed: false, blockedBy: 'lock_gate' };
    }

    return { canProceed: true };
  }

  /**
   * Record the current timestamp as the last gate-check time.
   * Call this after every `check()` invocation (pass or fail) to enforce the
   * scan throttle for the next caller.
   */
  recordScanTime(): void {
    this.lastScanTime = Date.now();
  }

  /**
   * Record the current timestamp as the last successful compilation time and
   * release the compilation lock.
   *
   * Call this after a compilation run finishes (successfully or not) so that
   * the time gate and lock gate reset properly.
   */
  recordCompilationTime(): void {
    this.lastCompilationTime = Date.now();
    this.lockManager.release(COMPILATION_LOCK);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Count sessions for the given project that started after the last compilation.
   */
  private countNewSessions(project: string): number {
    try {
      const row = this.db
        .prepare(
          `SELECT COUNT(*) AS cnt
           FROM sdk_sessions
           WHERE project = ? AND started_at_epoch > ?`
        )
        .get(project, this.lastCompilationTime) as { cnt: number } | undefined;

      return row?.cnt ?? 0;
    } catch {
      // If the table does not exist yet (e.g., fresh test DB), treat as 0.
      return 0;
    }
  }
}
