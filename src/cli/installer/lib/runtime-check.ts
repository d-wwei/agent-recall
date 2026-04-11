/**
 * Runtime Check Module
 *
 * Diagnostic checks used by the `npx agent-recall` CLI doctor and install commands.
 * Each check returns a CheckResult and NEVER throws — failures are captured internally.
 *
 * Checks:
 *   - Node.js version >= 18
 *   - Bun availability (PATH + common install paths)
 *   - Worker service health (HTTP probe on port 37777)
 *   - SQLite database existence and size
 *   - SeekDB vector store existence
 *   - Disk space (df -k, require > 100 MB free)
 *   - Viewer UI availability (HTTP probe on port 37777)
 */

import { existsSync, statSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { spawnSync, execSync } from 'child_process';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WORKER_PORT = 37777;
const WORKER_BASE_URL = `http://127.0.0.1:${WORKER_PORT}`;
const DATA_DIR = join(homedir(), '.agent-recall');
const DB_PATH = join(DATA_DIR, 'agent-recall.db');
const SEEKDB_PATH = join(DATA_DIR, 'vector-db', 'seekdb.db');
const MIN_FREE_MB = 100;
const HTTP_TIMEOUT_MS = 3000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckResult {
  ok: boolean;
  label: string;
  detail?: string;
  hint?: string;
  fixable?: boolean;
  category: 'runtime' | 'worker' | 'database' | 'compilation' | 'adapter' | 'viewer' | 'config';
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Verify the running Node.js version is >= 18.
 */
export async function checkNodeVersion(): Promise<CheckResult> {
  try {
    const raw = process.version; // e.g. "v20.11.0"
    const major = parseInt(raw.replace(/^v/, '').split('.')[0], 10);
    if (major >= 18) {
      return {
        ok: true,
        label: 'Node.js version',
        detail: raw,
        category: 'runtime',
      };
    }
    return {
      ok: false,
      label: 'Node.js version',
      detail: raw,
      hint: 'Agent Recall requires Node.js >= 18. Please upgrade: https://nodejs.org',
      fixable: false,
      category: 'runtime',
    };
  } catch (err) {
    return {
      ok: false,
      label: 'Node.js version',
      detail: `Failed to read process.version: ${(err as Error).message}`,
      category: 'runtime',
    };
  }
}

/**
 * Verify that Bun is available — first via PATH, then via common install paths.
 */
export async function checkBunAvailable(): Promise<CheckResult> {
  try {
    // 1. Try PATH first
    const pathResult = spawnSync('bun', ['--version'], {
      encoding: 'utf8',
      timeout: HTTP_TIMEOUT_MS,
      shell: false,
    });
    if (pathResult.status === 0 && pathResult.stdout) {
      const version = pathResult.stdout.trim();
      return {
        ok: true,
        label: 'Bun runtime',
        detail: `bun ${version}`,
        category: 'runtime',
      };
    }
  } catch {
    // fall through to path scan
  }

  // 2. Check common install paths
  const isWindows = platform() === 'win32';
  const candidates = isWindows
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [
        join(homedir(), '.bun', 'bin', 'bun'),
        '/usr/local/bin/bun',
        '/opt/homebrew/bin/bun',
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const r = spawnSync(candidate, ['--version'], {
          encoding: 'utf8',
          timeout: HTTP_TIMEOUT_MS,
        });
        if (r.status === 0 && r.stdout) {
          const version = r.stdout.trim();
          return {
            ok: true,
            label: 'Bun runtime',
            detail: `bun ${version} (${candidate})`,
            category: 'runtime',
          };
        }
      } catch {
        // try next candidate
      }
    }
  }

  return {
    ok: false,
    label: 'Bun runtime',
    detail: 'Bun not found in PATH or common install locations',
    hint: 'Install Bun: curl -fsSL https://bun.sh/install | bash',
    fixable: true,
    category: 'runtime',
  };
}

/**
 * Probe the worker service health endpoint.
 * Uses fetch with a 3-second timeout; gracefully falls back if fetch unavailable.
 */
export async function checkWorkerRunning(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${WORKER_BASE_URL}/api/health`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 200) {
      let version: string | undefined;
      try {
        const body = await response.json() as { version?: string };
        version = body.version;
      } catch {
        // body parse failure is non-fatal
      }
      return {
        ok: true,
        label: 'Worker service',
        detail: version ? `running (v${version})` : 'running',
        category: 'worker',
      };
    }

    return {
      ok: false,
      label: 'Worker service',
      detail: `HTTP ${response.status}`,
      hint: 'Start the worker: npx agent-recall worker start',
      fixable: true,
      category: 'worker',
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    const isTimeout = msg.includes('abort') || msg.includes('timeout') || msg.includes('ECONNREFUSED');
    return {
      ok: false,
      label: 'Worker service',
      detail: isTimeout ? 'not reachable on port 37777' : msg,
      hint: 'Start the worker: npx agent-recall worker start',
      fixable: true,
      category: 'worker',
    };
  }
}

/**
 * Check whether the SQLite database file exists and report its size.
 */
export async function checkDatabase(): Promise<CheckResult> {
  try {
    if (!existsSync(DB_PATH)) {
      return {
        ok: false,
        label: 'SQLite database',
        detail: `Not found at ${DB_PATH}`,
        hint: 'Run `npx agent-recall install` to initialise the database.',
        fixable: true,
        category: 'database',
      };
    }

    const stats = statSync(DB_PATH);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
    return {
      ok: true,
      label: 'SQLite database',
      detail: `${DB_PATH} (${sizeMb} MB)`,
      category: 'database',
    };
  } catch (err) {
    return {
      ok: false,
      label: 'SQLite database',
      detail: `Error reading database: ${(err as Error).message}`,
      category: 'database',
    };
  }
}

/**
 * Check whether the SeekDB vector store file exists.
 */
export async function checkSeekdb(): Promise<CheckResult> {
  try {
    if (!existsSync(SEEKDB_PATH)) {
      return {
        ok: false,
        label: 'SeekDB vector store',
        detail: `Not found at ${SEEKDB_PATH}`,
        hint: 'Vector search will be unavailable until the worker processes its first session.',
        fixable: false,
        category: 'database',
      };
    }

    const stats = statSync(SEEKDB_PATH);
    const sizeMb = (stats.size / 1024 / 1024).toFixed(2);
    return {
      ok: true,
      label: 'SeekDB vector store',
      detail: `${SEEKDB_PATH} (${sizeMb} MB)`,
      category: 'database',
    };
  } catch (err) {
    return {
      ok: false,
      label: 'SeekDB vector store',
      detail: `Error reading SeekDB: ${(err as Error).message}`,
      category: 'database',
    };
  }
}

/**
 * Verify there is at least 100 MB of free disk space in the home directory.
 * Uses `df -k ~/` on POSIX systems. Windows is not currently supported.
 */
export async function checkDiskSpace(): Promise<CheckResult> {
  try {
    const isWindows = platform() === 'win32';
    if (isWindows) {
      // Windows df equivalent is complex; skip and return ok for now
      return {
        ok: true,
        label: 'Disk space',
        detail: 'Check skipped on Windows',
        category: 'runtime',
      };
    }

    const output = execSync(`df -k "${homedir()}"`, {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // df -k output (macOS / Linux):
    // Filesystem  1K-blocks  Used  Available  Use%  Mounted on
    // /dev/disk1  ...        ...   AVAILABLE  ...   /
    const lines = output.trim().split('\n');
    // Second line is the data row — join lines in case the filesystem name wraps
    const dataLine = lines.length >= 2 ? lines.slice(1).join(' ') : '';
    // Parse the "Available" column — 4th numeric value in the row
    const cols = dataLine.trim().split(/\s+/);

    // df -k columns: Filesystem, 1K-blocks, Used, Available, Use%, Mounted-on
    // Find the Available value: it's the 4th column (index 3) on standard Linux
    // On macOS it's the same layout. If the filesystem name contains spaces the
    // columns shift, so we find the first column that looks like a large number
    // after the first column.
    let availableKb = NaN;

    // Try standard column position first (index 3)
    if (cols.length >= 4) {
      availableKb = parseInt(cols[3], 10);
    }

    // If that doesn't look right, scan for the pattern: integer integer integer
    if (isNaN(availableKb) || availableKb <= 0) {
      // Find three consecutive numeric columns — middle one after Used is Available
      for (let i = 1; i < cols.length - 2; i++) {
        const a = parseInt(cols[i], 10);
        const b = parseInt(cols[i + 1], 10);
        const c = parseInt(cols[i + 2], 10);
        if (!isNaN(a) && !isNaN(b) && !isNaN(c) && a > 0) {
          availableKb = b;
          break;
        }
      }
    }

    if (isNaN(availableKb)) {
      return {
        ok: false,
        label: 'Disk space',
        detail: `Could not parse df output: ${dataLine.substring(0, 80)}`,
        category: 'runtime',
      };
    }

    const availableMb = Math.floor(availableKb / 1024);
    const ok = availableMb >= MIN_FREE_MB;
    return {
      ok,
      label: 'Disk space',
      detail: `${availableMb} MB free`,
      hint: ok ? undefined : `At least ${MIN_FREE_MB} MB required. Free up disk space.`,
      fixable: false,
      category: 'runtime',
    };
  } catch (err) {
    return {
      ok: false,
      label: 'Disk space',
      detail: `df command failed: ${(err as Error).message}`,
      category: 'runtime',
    };
  }
}

/**
 * Probe the viewer UI served by the worker.
 */
export async function checkViewer(): Promise<CheckResult> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${WORKER_BASE_URL}/`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 200) {
      return {
        ok: true,
        label: 'Viewer UI',
        detail: `reachable at ${WORKER_BASE_URL}`,
        category: 'viewer',
      };
    }

    return {
      ok: false,
      label: 'Viewer UI',
      detail: `HTTP ${response.status}`,
      hint: 'The viewer requires the worker service to be running.',
      fixable: true,
      category: 'viewer',
    };
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    return {
      ok: false,
      label: 'Viewer UI',
      detail: `not reachable: ${msg.substring(0, 80)}`,
      hint: 'Start the worker: npx agent-recall worker start',
      fixable: true,
      category: 'viewer',
    };
  }
}

/**
 * Check AI merge configuration status.
 * Always returns ok=true; reports current configuration.
 */
export async function checkAIMerge(): Promise<CheckResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY || '';
  const aiEnabled = process.env.AGENT_RECALL_AI_MERGE_ENABLED !== 'false';
  const model = process.env.AGENT_RECALL_COMPILATION_MODEL || 'claude-opus-4-6';

  if (!apiKey) {
    return {
      ok: true,
      label: 'AI merge: not configured (using text merge)',
      hint: 'Set ANTHROPIC_API_KEY to enable AI-powered knowledge compilation',
      category: 'compilation',
    };
  }
  if (!aiEnabled) {
    return {
      ok: true,
      label: 'AI merge: disabled by setting',
      category: 'compilation',
    };
  }
  return {
    ok: true,
    label: `AI merge: active (${model})`,
    category: 'compilation',
  };
}

/**
 * Check Mermaid diagram generation status.
 * Always returns ok=true; reports current configuration.
 */
export async function checkMermaid(): Promise<CheckResult> {
  const mermaidEnabled = process.env.AGENT_RECALL_MERMAID_ENABLED !== 'false';
  return {
    ok: true,
    label: `Mermaid generation: ${mermaidEnabled ? 'enabled' : 'disabled'}`,
    category: 'compilation',
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Run all checks and return results in a consistent order.
 * Never throws.
 */
export async function runAllChecks(): Promise<CheckResult[]> {
  const results = await Promise.all([
    checkNodeVersion(),
    checkBunAvailable(),
    checkWorkerRunning(),
    checkDatabase(),
    checkSeekdb(),
    checkDiskSpace(),
    checkViewer(),
    checkAIMerge(),
    checkMermaid(),
  ]);
  return results;
}
