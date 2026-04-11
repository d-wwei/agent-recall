/**
 * doctor.ts — Agent Recall diagnostic command
 *
 * Runs all diagnostic checks and prints a categorized report.
 *
 * Usage:
 *   npx agent-recall doctor
 *   npx agent-recall doctor --fix
 */

import { runAllChecks, type CheckResult } from '../lib/runtime-check.js';
import { PLATFORMS } from '../lib/platform-detect.js';
import { isHooksRegistered } from '../lib/hook-register.js';
import { log, formatCheck, formatFail, formatSkip, formatHeader } from '../lib/output.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DoctorReport {
  checks: CheckResult[];
  issueCount: number;
  fixableCount: number;
}

// ---------------------------------------------------------------------------
// Category display names (ordered for output grouping)
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  runtime:     'Runtime',
  worker:      'Worker Service',
  database:    'Database',
  compilation: 'Compilation',
  adapter:     'Adapters',
  viewer:      'Viewer UI',
  config:      'Configuration',
};

// Canonical display order for categories
const CATEGORY_ORDER = ['runtime', 'worker', 'database', 'compilation', 'adapter', 'viewer', 'config'];

// ---------------------------------------------------------------------------
// runDoctor — exported for tests and programmatic use
// ---------------------------------------------------------------------------

/**
 * Run all diagnostic checks (runtime + adapter) and return a structured report.
 * Never throws.
 */
export async function runDoctor(): Promise<DoctorReport> {
  // 1. Run all base runtime checks (Node, Bun, Worker, DB, SeekDB, Chroma, Disk, Viewer)
  const runtimeChecks = await runAllChecks();

  // 2. Add adapter checks: for each platform in PLATFORMS, check if detected and hooks registered.
  const adapterChecks: CheckResult[] = [];

  for (const platform of PLATFORMS) {
    let detected = false;
    try {
      detected = platform.detect();
    } catch {
      // detect() must never throw in production, but guard defensively
    }

    if (!detected) {
      // Platform not detected — emit an info-level skip (ok=true so it doesn't inflate issueCount)
      adapterChecks.push({
        ok: true,
        label: `${platform.name} hooks`,
        detail: 'not detected',
        category: 'adapter',
      });
      continue;
    }

    // Platform is present — check whether hooks are registered.
    // We don't have a real agentRecallRoot here, but we only need the target path.
    // Use a placeholder root; getHooksTarget doesn't rely on the root for the target.
    const targetPath = platform.getHooksTarget('');
    const registered = isHooksRegistered(targetPath);

    if (registered) {
      adapterChecks.push({
        ok: true,
        label: `${platform.name} hooks`,
        detail: `registered at ${targetPath}`,
        category: 'adapter',
      });
    } else {
      adapterChecks.push({
        ok: false,
        label: `${platform.name} hooks`,
        detail: `hooks file not found at ${targetPath}`,
        hint: `Run \`npx agent-recall install\` to register hooks for ${platform.name}.`,
        fixable: true,
        category: 'adapter',
      });
    }
  }

  const checks = [...runtimeChecks, ...adapterChecks];

  // 3. Count issues and fixable issues
  const issueCount = checks.filter((c) => !c.ok).length;
  const fixableCount = checks.filter((c) => !c.ok && c.fixable === true).length;

  return { checks, issueCount, fixableCount };
}

// ---------------------------------------------------------------------------
// printReport — internal, formats the report to stderr
// ---------------------------------------------------------------------------

function printReport(report: DoctorReport): void {
  log('');
  log(formatHeader('Agent Recall Doctor'));
  log('');

  // Group checks by category, preserving canonical order
  const grouped = new Map<string, CheckResult[]>();
  for (const order of CATEGORY_ORDER) {
    grouped.set(order, []);
  }

  for (const check of report.checks) {
    const cat = check.category;
    if (!grouped.has(cat)) {
      grouped.set(cat, []);
    }
    grouped.get(cat)!.push(check);
  }

  for (const category of CATEGORY_ORDER) {
    const checks = grouped.get(category);
    if (!checks || checks.length === 0) continue;

    const catLabel = CATEGORY_LABELS[category] ?? category;
    log(formatHeader(catLabel));

    for (const check of checks) {
      const label = check.detail ? `${check.label} — ${check.detail}` : check.label;

      if (check.ok) {
        // Checks that are "not detected" / info-only use the skip formatter
        if (check.detail === 'not detected') {
          log(formatSkip(`${check.label} (not detected)`));
        } else {
          log(formatCheck(label));
        }
      } else {
        log(formatFail(label, check.hint));
      }
    }

    log('');
  }

  // Summary line
  if (report.issueCount === 0) {
    log(formatCheck('All checks passed.'));
  } else {
    const fixableNote =
      report.fixableCount > 0
        ? ` (${report.fixableCount} auto-fixable with --fix)`
        : '';
    log(formatFail(`${report.issueCount} issue(s) found${fixableNote}.`));
  }

  log('');
}

// ---------------------------------------------------------------------------
// run — CLI entry point
// ---------------------------------------------------------------------------

export async function run(): Promise<void> {
  const args = process.argv.slice(3);
  const fix = args.includes('--fix');

  const report = await runDoctor();
  printReport(report);

  if (fix && report.fixableCount > 0) {
    log(formatHeader('Auto-fix'));
    log('');
    log('  Auto-fix is not yet implemented. Run the following to fix issues manually:');
    for (const check of report.checks) {
      if (!check.ok && check.fixable && check.hint) {
        log(`  • ${check.hint}`);
      }
    }
    log('');
  }

  // Exit 1 if any issues remain
  if (report.issueCount > 0) {
    process.exit(1);
  }

  process.exit(0);
}
