/**
 * Tests for LockManager — PID-based file lock mutual exclusion
 *
 * Mock Justification: NONE for file ops (0% mock code)
 * - Uses real fs with temp directory — tests actual lock file creation/removal
 * - PID 999999999 used to simulate a dead process (guaranteed non-existent)
 * - process.pid used to represent a live process (current test runner)
 *
 * Value: Prevents concurrent background tasks from clobbering each other
 *        by enforcing advisory locks via PID files with dead-process reclaim
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LockManager } from '../../../src/services/concurrency/LockManager.js';

const DEAD_PID = 999999999;

describe('LockManager', () => {
  let locksDir: string;
  let manager: LockManager;

  beforeEach(() => {
    locksDir = mkdtempSync(join(tmpdir(), 'agent-recall-lock-test-'));
    manager = new LockManager(locksDir);
  });

  afterEach(() => {
    rmSync(locksDir, { recursive: true, force: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 1. acquire creates a lock file containing PID and acquiredAt
  // ────────────────────────────────────────────────────────────────────────────
  test('acquire creates lock file with current PID', () => {
    const result = manager.acquire('build');

    expect(result).toBe(true);

    const lockPath = join(locksDir, 'build.lock');
    expect(existsSync(lockPath)).toBe(true);

    const content = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(content.pid).toBe(process.pid);
    expect(typeof content.acquiredAt).toBe('string');
    expect(new Date(content.acquiredAt).getTime()).toBeGreaterThan(0);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. acquire returns false when lock is held by a live process
  // ────────────────────────────────────────────────────────────────────────────
  test('acquire returns false if already locked by live process', () => {
    // First acquire — held by current (live) process
    const first = manager.acquire('lint');
    expect(first).toBe(true);

    // Second acquire — should fail because current PID is still running
    const second = manager.acquire('lint');
    expect(second).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. release removes the lock file
  // ────────────────────────────────────────────────────────────────────────────
  test('release removes the lock file', () => {
    manager.acquire('deploy');
    const lockPath = join(locksDir, 'deploy.lock');
    expect(existsSync(lockPath)).toBe(true);

    manager.release('deploy');
    expect(existsSync(lockPath)).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. acquire reclaims a lock held by a dead PID
  // ────────────────────────────────────────────────────────────────────────────
  test('acquire succeeds if lock is held by dead PID (999999999)', () => {
    // Manually plant a stale lock from a dead process
    const lockPath = join(locksDir, 'stale-task.lock');
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: DEAD_PID, acquiredAt: new Date().toISOString() }),
      'utf8'
    );

    const result = manager.acquire('stale-task');
    expect(result).toBe(true);

    // Lock file should now belong to the current process
    const content = JSON.parse(readFileSync(lockPath, 'utf8'));
    expect(content.pid).toBe(process.pid);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 5. isLocked reflects correct state
  // ────────────────────────────────────────────────────────────────────────────
  test('isLocked returns false when no lock exists', () => {
    expect(manager.isLocked('check')).toBe(false);
  });

  test('isLocked returns true after acquiring lock', () => {
    manager.acquire('check');
    expect(manager.isLocked('check')).toBe(true);
  });

  test('isLocked returns false after releasing lock', () => {
    manager.acquire('check');
    manager.release('check');
    expect(manager.isLocked('check')).toBe(false);
  });

  test('isLocked returns false for stale lock with dead PID', () => {
    const lockPath = join(locksDir, 'stale2.lock');
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: DEAD_PID, acquiredAt: new Date().toISOString() }),
      'utf8'
    );

    // A dead-PID lock is not considered actively held
    expect(manager.isLocked('stale2')).toBe(false);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 6. release is a no-op when lock file does not exist
  // ────────────────────────────────────────────────────────────────────────────
  test('release does not throw when lock file is absent', () => {
    expect(() => manager.release('nonexistent')).not.toThrow();
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 7. constructor creates locks directory if it does not exist
  // ────────────────────────────────────────────────────────────────────────────
  test('constructor creates locks directory when missing', () => {
    const newDir = join(locksDir, 'nested', 'locks');
    // Directory does not exist yet
    expect(existsSync(newDir)).toBe(false);

    new LockManager(newDir);
    expect(existsSync(newDir)).toBe(true);
  });
});
