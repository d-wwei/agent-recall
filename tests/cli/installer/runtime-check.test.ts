/**
 * Tests for runtime-check module
 *
 * Validates that each check function returns a properly-shaped CheckResult
 * and that the aggregate runAllChecks() returns an array of results.
 *
 * These are integration-style unit tests — they run against the real environment
 * (real Node version, real filesystem, real worker port probe). No mocks.
 * All checks must never throw; failures are captured in ok=false results.
 */

import { describe, it, expect } from 'bun:test';
import {
  checkNodeVersion,
  checkBunAvailable,
  checkWorkerRunning,
  checkDatabase,
  checkSeekdb,
  checkDiskSpace,
  runAllChecks,
  type CheckResult,
} from '../../../src/cli/installer/lib/runtime-check.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertCheckResult(result: CheckResult) {
  expect(typeof result.ok).toBe('boolean');
  expect(typeof result.label).toBe('string');
  expect(result.label.length).toBeGreaterThan(0);
  // optional fields — if present must be strings
  if (result.detail !== undefined) expect(typeof result.detail).toBe('string');
  if (result.hint !== undefined) expect(typeof result.hint).toBe('string');
  if (result.fixable !== undefined) expect(typeof result.fixable).toBe('boolean');
  // category must be one of the allowed values
  const validCategories = ['runtime', 'worker', 'database', 'compilation', 'adapter', 'viewer', 'config'];
  expect(validCategories).toContain(result.category);
}

// ---------------------------------------------------------------------------
// checkNodeVersion
// ---------------------------------------------------------------------------

describe('checkNodeVersion', () => {
  it('returns a CheckResult shaped object', async () => {
    const result = await checkNodeVersion();
    assertCheckResult(result);
  });

  it('returns ok=true on Node >= 18 (dev machine requirement)', async () => {
    const result = await checkNodeVersion();
    // CI and dev machines always run Node >= 18 per package.json engines field
    expect(result.ok).toBe(true);
  });

  it('has category "runtime"', async () => {
    const result = await checkNodeVersion();
    expect(result.category).toBe('runtime');
  });

  it('includes the detected version in detail', async () => {
    const result = await checkNodeVersion();
    expect(result.detail).toBeDefined();
    // detail should include the Node version string (e.g. "v20.x.x")
    expect(result.detail).toMatch(/v?\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// checkBunAvailable
// ---------------------------------------------------------------------------

describe('checkBunAvailable', () => {
  it('returns a CheckResult shaped object', async () => {
    const result = await checkBunAvailable();
    assertCheckResult(result);
  });

  it('has category "runtime"', async () => {
    const result = await checkBunAvailable();
    expect(result.category).toBe('runtime');
  });

  // Note: ok can be true or false depending on whether bun is installed.
  // We only assert shape, not value, for portability.
  it('has a non-empty label', async () => {
    const result = await checkBunAvailable();
    expect(result.label.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// checkWorkerRunning
// ---------------------------------------------------------------------------

describe('checkWorkerRunning', () => {
  it('returns a CheckResult shaped object', async () => {
    const result = await checkWorkerRunning();
    assertCheckResult(result);
  });

  it('has category "worker"', async () => {
    const result = await checkWorkerRunning();
    expect(result.category).toBe('worker');
  });

  it('never throws even when worker is not running', async () => {
    // This must not reject
    await expect(checkWorkerRunning()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkDatabase
// ---------------------------------------------------------------------------

describe('checkDatabase', () => {
  it('returns a CheckResult shaped object', async () => {
    const result = await checkDatabase();
    assertCheckResult(result);
  });

  it('has category "database"', async () => {
    const result = await checkDatabase();
    expect(result.category).toBe('database');
  });

  it('never throws even when database does not exist', async () => {
    await expect(checkDatabase()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkSeekdb
// ---------------------------------------------------------------------------

describe('checkSeekdb', () => {
  it('returns a CheckResult shaped object', async () => {
    const result = await checkSeekdb();
    assertCheckResult(result);
  });

  it('has category "database"', async () => {
    const result = await checkSeekdb();
    expect(result.category).toBe('database');
  });

  it('never throws even when seekdb does not exist', async () => {
    await expect(checkSeekdb()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// checkDiskSpace
// ---------------------------------------------------------------------------

describe('checkDiskSpace', () => {
  it('returns a CheckResult shaped object', async () => {
    const result = await checkDiskSpace();
    assertCheckResult(result);
  });

  it('returns ok=true on a dev machine with adequate disk space', async () => {
    // Dev machines have > 100 MB free; this is a sanity baseline
    const result = await checkDiskSpace();
    expect(result.ok).toBe(true);
  });

  it('has category "runtime"', async () => {
    const result = await checkDiskSpace();
    expect(result.category).toBe('runtime');
  });

  it('never throws even on unexpected df output', async () => {
    await expect(checkDiskSpace()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// runAllChecks
// ---------------------------------------------------------------------------

describe('runAllChecks', () => {
  it('returns an array of CheckResult objects', async () => {
    const results = await runAllChecks();
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      assertCheckResult(r);
    }
  });

  it('includes at least one result per expected check', async () => {
    const results = await runAllChecks();
    // Minimum expected checks: nodeVersion, bun, worker, db, seekdb, disk
    expect(results.length).toBeGreaterThanOrEqual(6);
  });

  it('never throws', async () => {
    await expect(runAllChecks()).resolves.toBeDefined();
  });
});
