/**
 * output.ts — Terminal output helpers for the agent-recall installer CLI
 *
 * Design notes:
 * - Uses stderr (console.error) for all user-facing messages.
 *   stdout is reserved for machine-readable JSON output from commands.
 * - Colors are inline ANSI codes — no third-party dependencies.
 * - All formatters return a string so callers can test them without I/O.
 */

// ─── ANSI color codes ────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const CYAN   = '\x1b[36m';

// ─── Formatters (pure — return string, no I/O) ──────────────────────────────

/**
 * Format a successful check item.
 * Output:  "  ✓ msg"  in green
 */
export function formatCheck(msg: string): string {
  return `  ${GREEN}✓${RESET} ${msg}`;
}

/**
 * Format a failure item.
 * Output:  "  ✗ msg"  in red
 *          "    hint" on the next line (only when hint is provided)
 */
export function formatFail(msg: string, hint?: string): string {
  const first = `  ${RED}✗${RESET} ${msg}`;
  if (hint !== undefined) {
    return `${first}\n    ${DIM}${hint}${RESET}`;
  }
  return first;
}

/**
 * Format a skipped / already-done item.
 * Output:  "  ○ msg"  in dim
 */
export function formatSkip(msg: string): string {
  return `  ${DIM}○ ${msg}${RESET}`;
}

/**
 * Format a section header.
 * Output:  bold title
 */
export function formatHeader(title: string): string {
  return `${BOLD}${title}${RESET}`;
}

/**
 * Format the product banner shown at CLI startup.
 * Output:  "Agent Recall"  in bold cyan
 */
export function formatBanner(): string {
  return `${BOLD}${CYAN}Agent Recall${RESET}`;
}

// ─── I/O helper ─────────────────────────────────────────────────────────────

/**
 * Write a message to stderr.
 *
 * Rationale: stdout is reserved for machine-readable JSON output from
 * commands (e.g. `agent-recall status --json`).  All human-readable
 * messages — banners, check results, progress lines — go to stderr so
 * they never pollute piped output.
 */
export function log(msg: string): void {
  console.error(msg);
}
