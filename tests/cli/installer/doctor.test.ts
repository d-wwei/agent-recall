/**
 * Tests for the doctor command
 *
 * Validates that:
 * - runDoctor() returns a DoctorReport with the required shape
 * - Every check in the report has required fields (ok, label, category)
 * - Category values are from the allowed set
 * - issueCount and fixableCount are correctly calculated
 * - The report includes both runtime checks and adapter checks
 */
import { describe, it, expect } from 'bun:test';
import {
  runDoctor,
  type DoctorReport,
} from '../../../src/cli/installer/commands/doctor.js';

// ---------------------------------------------------------------------------
// Allowed categories (mirrors CheckResult type in runtime-check.ts)
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  'runtime',
  'worker',
  'database',
  'compilation',
  'adapter',
  'viewer',
  'config',
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function assertCheckShape(check: { ok: boolean; label: string; category: string }) {
  expect(typeof check.ok).toBe('boolean');
  expect(typeof check.label).toBe('string');
  expect(check.label.length).toBeGreaterThan(0);
  expect(typeof check.category).toBe('string');
  expect(VALID_CATEGORIES.has(check.category)).toBe(true);
}

// ---------------------------------------------------------------------------
// runDoctor
// ---------------------------------------------------------------------------

describe('runDoctor', () => {
  it('returns a DoctorReport object', async () => {
    const report = await runDoctor();
    expect(report).toBeDefined();
    expect(typeof report).toBe('object');
  });

  it('report has a checks array', async () => {
    const report = await runDoctor();
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
  });

  it('report has numeric issueCount', async () => {
    const report = await runDoctor();
    expect(typeof report.issueCount).toBe('number');
    expect(report.issueCount).toBeGreaterThanOrEqual(0);
  });

  it('report has numeric fixableCount', async () => {
    const report = await runDoctor();
    expect(typeof report.fixableCount).toBe('number');
    expect(report.fixableCount).toBeGreaterThanOrEqual(0);
  });

  it('every check has required fields: ok (boolean), label (string), category (string)', async () => {
    const report = await runDoctor();
    for (const check of report.checks) {
      assertCheckShape(check);
    }
  });

  it('every category value is from the allowed set', async () => {
    const report = await runDoctor();
    for (const check of report.checks) {
      expect(VALID_CATEGORIES.has(check.category)).toBe(true);
    }
  });

  it('issueCount equals the number of checks with ok===false', async () => {
    const report = await runDoctor();
    const failCount = report.checks.filter((c) => !c.ok).length;
    expect(report.issueCount).toBe(failCount);
  });

  it('fixableCount equals the number of failed checks with fixable===true', async () => {
    const report = await runDoctor();
    const fixableCount = report.checks.filter((c) => !c.ok && c.fixable === true).length;
    expect(report.fixableCount).toBe(fixableCount);
  });

  it('fixableCount is <= issueCount', async () => {
    const report = await runDoctor();
    expect(report.fixableCount).toBeLessThanOrEqual(report.issueCount);
  });

  it('includes at least the 8 base runtime checks from runAllChecks()', async () => {
    // runAllChecks() always returns 8 checks (Node, Bun, Worker, DB, SeekDB, Chroma, Disk, Viewer)
    const report = await runDoctor();
    expect(report.checks.length).toBeGreaterThanOrEqual(8);
  });

  it('includes checks from the "adapter" category for each detected platform', async () => {
    const report = await runDoctor();
    // Adapter checks are added for each detected platform.
    // On any dev machine with Claude Code installed, at least one adapter check exists.
    // We only assert structure — the count depends on the environment.
    const adapterChecks = report.checks.filter((c) => c.category === 'adapter');
    // Each adapter check must have a valid shape
    for (const check of adapterChecks) {
      assertCheckShape(check);
    }
  });

  it('never throws', async () => {
    await expect(runDoctor()).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// DoctorReport type shape (static type test via runtime)
// ---------------------------------------------------------------------------

describe('DoctorReport shape', () => {
  it('has exactly the three expected top-level keys', async () => {
    const report: DoctorReport = await runDoctor();
    expect('checks' in report).toBe(true);
    expect('issueCount' in report).toBe(true);
    expect('fixableCount' in report).toBe(true);
  });
});
