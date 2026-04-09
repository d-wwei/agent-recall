/**
 * LockManager — advisory PID-based file lock for background task mutual exclusion.
 *
 * Lock files are JSON objects: { pid: number, acquiredAt: string }
 * Stored as `{locksDir}/{taskName}.lock`.
 *
 * Dead-PID reclaim: if the lock file references a PID that no longer exists
 * (process.kill(pid, 0) throws), the lock is considered stale and may be
 * overwritten by the caller.
 *
 * Design notes:
 * - Advisory only — callers must cooperate; no kernel-enforced exclusion.
 * - Signal 0 (`process.kill(pid, 0)`) checks process existence without
 *   sending a real signal. Throws ESRCH if the PID is gone, EPERM if the
 *   process exists but is owned by another user.
 * - EPERM is treated as "process alive" (conservative).
 */

import { mkdirSync, writeFileSync, unlinkSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface LockFileContent {
  pid: number;
  acquiredAt: string;
}

export class LockManager {
  private readonly locksDir: string;

  /**
   * @param locksDir Directory where `.lock` files are stored.
   *                 Created (recursively) if it does not already exist.
   */
  constructor(locksDir: string) {
    this.locksDir = locksDir;
    mkdirSync(locksDir, { recursive: true });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Attempt to acquire a lock for `taskName`.
   *
   * @returns `true`  — lock acquired (file written with current PID).
   * @returns `false` — lock is held by a live process; caller should not proceed.
   *
   * If a lock file exists but its PID is dead, the stale file is silently
   * overwritten (reclaimed) and `true` is returned.
   */
  acquire(taskName: string): boolean {
    const lockPath = this.lockPath(taskName);

    if (existsSync(lockPath)) {
      const existing = this.readLockFile(lockPath);
      if (existing !== null && this.isAlive(existing.pid)) {
        // Lock is actively held by a live process.
        return false;
      }
      // Stale lock (dead PID or unreadable file) — fall through to reclaim.
    }

    this.writeLockFile(lockPath);
    return true;
  }

  /**
   * Release the lock for `taskName` by deleting its lock file.
   * No-op if the lock file does not exist.
   */
  release(taskName: string): void {
    const lockPath = this.lockPath(taskName);
    if (existsSync(lockPath)) {
      unlinkSync(lockPath);
    }
  }

  /**
   * Check whether `taskName` is currently locked by a live process.
   *
   * A lock file with a dead PID is NOT considered actively held.
   */
  isLocked(taskName: string): boolean {
    const lockPath = this.lockPath(taskName);
    if (!existsSync(lockPath)) {
      return false;
    }
    const content = this.readLockFile(lockPath);
    if (content === null) {
      return false;
    }
    return this.isAlive(content.pid);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────────────────────

  private lockPath(taskName: string): string {
    return join(this.locksDir, `${taskName}.lock`);
  }

  private writeLockFile(lockPath: string): void {
    const content: LockFileContent = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
    };
    writeFileSync(lockPath, JSON.stringify(content), 'utf8');
  }

  private readLockFile(lockPath: string): LockFileContent | null {
    try {
      const raw = readFileSync(lockPath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'pid' in parsed &&
        'acquiredAt' in parsed &&
        typeof (parsed as LockFileContent).pid === 'number' &&
        typeof (parsed as LockFileContent).acquiredAt === 'string'
      ) {
        return parsed as LockFileContent;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Returns `true` if the given PID refers to a live process.
   *
   * Uses signal 0 — existence check only, no actual signal delivered.
   * - Throws `ESRCH`  → process does not exist → dead → returns `false`.
   * - Throws `EPERM`  → process exists, different owner → alive → returns `true`.
   * - No throw        → process exists and owned by same user → returns `true`.
   */
  private isAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'EPERM') {
        // Process exists but we lack permission — treat as alive (conservative).
        return true;
      }
      return false;
    }
  }
}
