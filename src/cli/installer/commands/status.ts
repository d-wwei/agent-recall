/**
 * status.ts — Show runtime diagnostics for the agent-recall installation.
 *
 * Runs the core runtime checks and prints their results:
 *   - Worker service health
 *   - SQLite database
 *   - SeekDB vector store
 */

import {
  checkWorkerRunning,
  checkDatabase,
  checkSeekdb,
  type CheckResult,
} from '../lib/runtime-check.js';
import { log, formatCheck, formatFail, formatHeader } from '../lib/output.js';

// ─── Renderer ────────────────────────────────────────────────────────────────

function renderResult(result: CheckResult): void {
  if (result.ok) {
    const detail = result.detail ? ` — ${result.detail}` : '';
    log(formatCheck(`${result.label}${detail}`));
  } else {
    const detail = result.detail ? ` — ${result.detail}` : '';
    log(formatFail(`${result.label}${detail}`, result.hint));
  }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function run(): Promise<void> {
  log(formatHeader('Agent Recall Status'));
  log('');

  const results = await Promise.all([
    checkWorkerRunning(),
    checkDatabase(),
    checkSeekdb(),
  ]);

  for (const result of results) {
    renderResult(result);
  }

  log('');

  const failures = results.filter((r) => !r.ok);
  if (failures.length === 0) {
    log(formatCheck('All checks passed'));
  } else {
    log(formatFail(`${failures.length} check(s) failed`));
  }

  log('');
}
