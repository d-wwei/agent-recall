/**
 * LockManager - Simple in-memory lock manager for preventing concurrent operations.
 *
 * Used by GateKeeper to ensure only one compilation runs at a time.
 * Locks are stored in memory — they do not survive process restarts.
 */

export class LockManager {
  private locks: Set<string> = new Set();

  /**
   * Attempt to acquire a named lock.
   * Returns true if the lock was acquired, false if already held.
   */
  acquire(name: string): boolean {
    if (this.locks.has(name)) {
      return false;
    }
    this.locks.add(name);
    return true;
  }

  /**
   * Release a named lock.
   * No-op if the lock is not held.
   */
  release(name: string): void {
    this.locks.delete(name);
  }

  /**
   * Check whether a named lock is currently held.
   */
  isLocked(name: string): boolean {
    return this.locks.has(name);
  }

  /**
   * Release all currently held locks.
   * Intended for cleanup / test teardown.
   */
  releaseAll(): void {
    this.locks.clear();
  }
}
