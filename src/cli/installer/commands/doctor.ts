/**
 * doctor.ts — Agent Recall diagnostic + health audit command
 *
 * Infrastructure checks (runtime, worker, db) run locally in Node.js.
 * Data quality audit (16 expectations) runs via Worker HTTP API.
 *
 * Usage:
 *   npx agent-recall doctor              # infra checks + full audit
 *   npx agent-recall doctor --quick      # CRITICAL expectations only
 *   npx agent-recall doctor --json       # JSON output (full audit)
 *   npx agent-recall doctor --history 7  # score trend for last N days
 *   npx agent-recall doctor --fix        # (placeholder) auto-fix suggestions
 */

import { runAllChecks, type CheckResult } from '../lib/runtime-check.js';
import { PLATFORMS } from '../lib/platform-detect.js';
import { isHooksRegistered } from '../lib/hook-register.js';
import { log, formatCheck, formatFail, formatSkip, formatHeader, formatBanner } from '../lib/output.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKER_PORT = 37777;
const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// ANSI helpers (supplement output.ts)
// ---------------------------------------------------------------------------

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DoctorReport {
  checks: CheckResult[];
  issueCount: number;
  fixableCount: number;
}

interface AuditResult {
  id: string;
  score: 'PASS' | 'WARN' | 'FAIL' | 'INFO';
  result: string;
  value: number | string | null;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

interface AuditReport {
  score: number;
  grade: string;
  mode: string;
  results: Record<string, AuditResult>;
  critical_failures: string[];
  recommendations: string[];
  created_at: string;
}

interface HistoryEntry {
  id: number;
  score: number;
  grade: string;
  critical_failures: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Worker HTTP helper
// ---------------------------------------------------------------------------

async function fetchWorkerJson<T>(path: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(`${WORKER_URL}${path}`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// runDoctor — infrastructure checks (unchanged from original)
// ---------------------------------------------------------------------------

export async function runDoctor(): Promise<DoctorReport> {
  const runtimeChecks = await runAllChecks();
  const adapterChecks: CheckResult[] = [];

  for (const platform of PLATFORMS) {
    let detected = false;
    try { detected = platform.detect(); } catch { /* guard */ }

    if (!detected) {
      adapterChecks.push({ ok: true, label: `${platform.name} hooks`, detail: 'not detected', category: 'adapter' });
      continue;
    }

    const targetPath = platform.getHooksTarget('');
    const registered = isHooksRegistered(targetPath);

    adapterChecks.push(registered
      ? { ok: true, label: `${platform.name} hooks`, detail: `registered at ${targetPath}`, category: 'adapter' }
      : { ok: false, label: `${platform.name} hooks`, detail: `hooks file not found at ${targetPath}`,
          hint: `Run \`npx agent-recall install\` to register hooks for ${platform.name}.`, fixable: true, category: 'adapter' },
    );
  }

  const checks = [...runtimeChecks, ...adapterChecks];
  const issueCount = checks.filter(c => !c.ok).length;
  const fixableCount = checks.filter(c => !c.ok && c.fixable === true).length;

  return { checks, issueCount, fixableCount };
}

// ---------------------------------------------------------------------------
// Display: infrastructure report
// ---------------------------------------------------------------------------

const CATEGORY_LABELS: Record<string, string> = {
  runtime: 'Runtime', worker: 'Worker Service', database: 'Database',
  compilation: 'Compilation', adapter: 'Adapters', viewer: 'Viewer UI', config: 'Configuration',
};
const CATEGORY_ORDER = ['runtime', 'worker', 'database', 'compilation', 'adapter', 'viewer', 'config'];

function printInfraReport(report: DoctorReport): void {
  log('');
  log(formatHeader('Infrastructure'));
  log('');

  const grouped = new Map<string, CheckResult[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const check of report.checks) {
    if (!grouped.has(check.category)) grouped.set(check.category, []);
    grouped.get(check.category)!.push(check);
  }

  for (const cat of CATEGORY_ORDER) {
    const checks = grouped.get(cat);
    if (!checks || checks.length === 0) continue;
    log(formatHeader(CATEGORY_LABELS[cat] ?? cat));
    for (const c of checks) {
      const label = c.detail ? `${c.label} — ${c.detail}` : c.label;
      if (c.ok) {
        c.detail === 'not detected' ? log(formatSkip(`${c.label} (not detected)`)) : log(formatCheck(label));
      } else {
        log(formatFail(label, c.hint));
      }
    }
    log('');
  }
}

// ---------------------------------------------------------------------------
// Display: audit report
// ---------------------------------------------------------------------------

function scoreIcon(score: string): string {
  switch (score) {
    case 'PASS': return `${GREEN}+${RESET}`;
    case 'WARN': return `${YELLOW}~${RESET}`;
    case 'FAIL': return `${RED}X${RESET}`;
    default: return `${DIM}i${RESET}`;
  }
}

function printAuditReport(audit: AuditReport): void {
  const date = audit.created_at.split('T')[0];
  log('');
  log(`${BOLD}Health Audit${RESET}  ${date}  Score: ${BOLD}${audit.score}%${RESET}  Grade: ${BOLD}${audit.grade}${RESET}`);
  log('');

  if (audit.critical_failures.length > 0) {
    log(`  ${RED}${BOLD}Critical Failures:${RESET} ${audit.critical_failures.join(', ')}`);
    log('');
  }

  // Group by severity
  const severityOrder: Array<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'> = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
  const resultsList = Object.values(audit.results);

  for (const sev of severityOrder) {
    const group = resultsList.filter(r => r.severity === sev);
    if (group.length === 0) continue;

    log(`  ${BOLD}${sev}${RESET}`);
    for (const r of group) {
      log(`    ${scoreIcon(r.score)} ${r.score.padEnd(4)} ${r.id}  ${r.result}`);
    }
    log('');
  }

  if (audit.recommendations.length > 0) {
    log(formatHeader('Recommendations'));
    for (const rec of audit.recommendations) {
      log(`  • ${rec}`);
    }
    log('');
  }
}

// ---------------------------------------------------------------------------
// Display: history trend
// ---------------------------------------------------------------------------

function printHistory(entries: HistoryEntry[]): void {
  if (entries.length === 0) {
    log('  No audit history found. Run `agent-recall doctor` first.');
    return;
  }

  log('');
  log(formatHeader('Audit History'));
  log('');
  log(`  ${'Date'.padEnd(12)} ${'Score'.padEnd(8)} ${'Grade'.padEnd(6)} Critical Failures`);
  log(`  ${'─'.repeat(12)} ${'─'.repeat(8)} ${'─'.repeat(6)} ${'─'.repeat(30)}`);

  for (const entry of entries) {
    const date = entry.created_at.split('T')[0];
    const failures = entry.critical_failures.length > 0 ? entry.critical_failures.join(', ') : '—';
    log(`  ${date.padEnd(12)} ${String(entry.score).padEnd(8)} ${entry.grade.padEnd(6)} ${failures}`);
  }
  log('');
}

// ---------------------------------------------------------------------------
// run — CLI entry point
// ---------------------------------------------------------------------------

export async function run(): Promise<void> {
  const args = process.argv.slice(3);
  const flags = new Set(args.filter(a => a.startsWith('--')));
  const positional = args.filter(a => !a.startsWith('--'));

  const isQuick = flags.has('--quick');
  const isJson = flags.has('--json');
  const isHistory = flags.has('--history');
  const isFix = flags.has('--fix');

  // --- History mode ---
  if (isHistory) {
    const daysArg = positional[0];
    const days = daysArg ? parseInt(daysArg, 10) : 7;
    const data = await fetchWorkerJson<{ entries: HistoryEntry[] }>(`/api/doctor/history?days=${days}`);

    if (!data) {
      log(formatFail('Could not reach worker. Is it running?', 'Start with: npx agent-recall worker start'));
      process.exit(1);
    }

    if (isJson) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      log('');
      log(formatBanner() + '  —  doctor');
      printHistory(data.entries);
    }
    process.exit(0);
  }

  // --- Quick mode ---
  if (isQuick) {
    const audit = await fetchWorkerJson<AuditReport>('/api/doctor/quick');

    if (!audit) {
      log(formatFail('Could not reach worker. Is it running?', 'Start with: npx agent-recall worker start'));
      process.exit(1);
    }

    if (isJson) {
      console.log(JSON.stringify(audit, null, 2));
    } else {
      log('');
      log(formatBanner() + '  —  doctor (quick)');
      printAuditReport(audit);
    }
    process.exit(audit.critical_failures.length > 0 ? 1 : 0);
  }

  // --- Full mode (default): infra + audit ---
  log('');
  log(formatBanner() + '  —  doctor');

  // 1. Infrastructure checks (local)
  const infraReport = await runDoctor();

  if (!isJson) {
    printInfraReport(infraReport);
  }

  // 2. Data quality audit (via worker)
  const audit = await fetchWorkerJson<AuditReport>('/api/doctor');

  if (isJson) {
    console.log(JSON.stringify({
      infrastructure: infraReport,
      audit: audit ?? { error: 'Worker unreachable' },
    }, null, 2));
    process.exit(0);
  }

  if (!audit) {
    log(formatFail('Could not reach worker for health audit.', 'Start with: npx agent-recall worker start'));
    log('');
    process.exit(infraReport.issueCount > 0 ? 1 : 0);
  }

  printAuditReport(audit);

  // Summary
  const totalIssues = infraReport.issueCount + audit.critical_failures.length;
  if (totalIssues === 0) {
    log(formatCheck('All checks passed.'));
  } else {
    log(formatFail(`${totalIssues} issue(s) found.`));
  }
  log('');

  if (isFix && infraReport.fixableCount > 0) {
    log(formatHeader('Auto-fix'));
    log('');
    log('  Auto-fix is not yet implemented. Run the following to fix issues manually:');
    for (const check of infraReport.checks) {
      if (!check.ok && check.fixable && check.hint) {
        log(`  • ${check.hint}`);
      }
    }
    log('');
  }

  process.exit(totalIssues > 0 ? 1 : 0);
}
