/**
 * install.ts — `npx agent-recall install` command
 *
 * Orchestrates the full installation flow:
 *
 *   npm mode (default):
 *     Copy plugin/ artifacts from the npm package to ~/.agent-recall/
 *     → bun install → register hooks → start Worker → verify health
 *
 *   --from-source mode:
 *     git clone repo → bun install → npm run build
 *     → register hooks → start Worker → verify health
 *
 * Exported utility functions (tested in unit tests):
 *   resolveInstallRoot(fromSource)  — pure path resolver
 *   ensureBun()                     — probe + auto-install Bun
 */

import { cpSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

import {
  log,
  formatCheck,
  formatFail,
  formatSkip,
  formatBanner,
} from '../lib/output.js';
import { detectPlatforms, getPlatformById } from '../lib/platform-detect.js';
import { registerHooks, isHooksRegistered } from '../lib/hook-register.js';
import { checkBunAvailable, checkWorkerRunning } from '../lib/runtime-check.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_RECALL_REPO = 'https://github.com/d-wwei/agent-recall.git';
const WORKER_HEALTH_RETRIES = 6;
const WORKER_HEALTH_DELAY_MS = 2000;

// ---------------------------------------------------------------------------
// Exported utilities (unit-testable, pure or near-pure)
// ---------------------------------------------------------------------------

/**
 * Resolve the install root directory.
 *
 * - npm mode:          ~/.agent-recall
 * - from-source mode:  ~/.agent-recall/source
 */
export function resolveInstallRoot(fromSource: boolean): string {
  const base = join(homedir(), '.agent-recall');
  return fromSource ? join(base, 'source') : base;
}

/**
 * Check whether Bun is available, and attempt a one-shot install if not.
 *
 * Returns true if Bun is available after the check (or after install).
 * Returns false if unavailable and install failed.
 */
export function ensureBun(): boolean {
  // Probe via PATH and common install locations (reuses runtime-check logic)
  const pathResult = spawnSync('bun', ['--version'], {
    encoding: 'utf8',
    timeout: 5000,
    shell: false,
    stdio: 'pipe',
  });
  if (pathResult.status === 0 && pathResult.stdout?.trim()) {
    return true;
  }

  // Check common install paths
  const candidates = [
    join(homedir(), '.bun', 'bin', 'bun'),
    '/usr/local/bin/bun',
    '/opt/homebrew/bin/bun',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const r = spawnSync(candidate, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: 'pipe',
      });
      if (r.status === 0 && r.stdout?.trim()) {
        return true;
      }
    }
  }

  // Attempt automatic install via the official install script
  log(formatFail('Bun not found — attempting automatic install...'));
  const installResult = spawnSync(
    'bash',
    ['-c', 'curl -fsSL https://bun.sh/install | bash'],
    { stdio: 'inherit', timeout: 60_000 }
  );

  if (installResult.status !== 0) {
    return false;
  }

  // Re-probe after install
  const retryResult = spawnSync(
    join(homedir(), '.bun', 'bin', 'bun'),
    ['--version'],
    { encoding: 'utf8', timeout: 5000, stdio: 'pipe' }
  );
  return retryResult.status === 0 && Boolean(retryResult.stdout?.trim());
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the plugin/ directory bundled with this package.
 * When running via `npx agent-recall`, __dirname is inside the npm package.
 */
function resolvePluginDir(): string | null {
  // ESM: derive __dirname from import.meta.url when available
  let dir: string;
  try {
    // Works in ESM context
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    // Fallback for CJS / compiled output
    dir = __dirname ?? process.cwd();
  }

  const candidates = [
    // From bin/agent-recall.cjs → up 3 levels to package root, then plugin/
    join(dir, '..', '..', '..', 'plugin'),
    // Compiled output: dist/cli/installer/commands/ → root/plugin/
    join(dir, '..', '..', '..', '..', 'plugin'),
    // Local dev: src/cli/installer/commands/ → root/plugin/
    join(dir, '..', '..', '..', 'plugin'),
    // CWD (local dev or npx cwd)
    join(process.cwd(), 'plugin'),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'scripts', 'bun-runner.js'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Copy plugin/ artifacts from the resolved source into the install root.
 */
function copyPluginArtifacts(pluginSrc: string, installRoot: string): void {
  const dest = join(installRoot, 'plugin');
  mkdirSync(dest, { recursive: true });
  cpSync(pluginSrc, dest, { recursive: true });
}

/**
 * Sleep for a given number of milliseconds (used when probing worker health).
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll the worker health endpoint until it responds 200 or retries are exhausted.
 */
async function waitForWorker(retries: number, delayMs: number): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    const result = await checkWorkerRunning();
    if (result.ok) return true;
    if (i < retries - 1) await sleep(delayMs);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface InstallOptions {
  fromSource?: boolean;
  platform?: string; // optional platform filter (id string)
  verbose?: boolean;
}

// ---------------------------------------------------------------------------
// Main run() function
// ---------------------------------------------------------------------------

/**
 * Entry point for `npx agent-recall install`.
 *
 * Returns exit code: 0 = success, 1 = non-fatal issues, 2 = fatal error.
 */
export async function run(options: InstallOptions = {}): Promise<number> {
  const { fromSource = false, platform: platformFilter, verbose = false } = options;

  log('');
  log(formatBanner() + '  —  installer');
  log('');

  // ── Step 1: Node version check ─────────────────────────────────────────────
  const nodeMajor = parseInt(process.version.replace(/^v/, '').split('.')[0], 10);
  if (nodeMajor < 18) {
    log(formatFail('Node.js version', `requires >= 18, found ${process.version}`));
    log('  Install a newer version: https://nodejs.org');
    return 2;
  }
  log(formatCheck(`Node.js ${process.version}`));

  // ── Step 2: Bun availability ───────────────────────────────────────────────
  const bunOk = ensureBun();
  if (!bunOk) {
    log(formatFail('Bun runtime', 'not found and auto-install failed'));
    log('  Manual install: curl -fsSL https://bun.sh/install | bash');
    return 2;
  }
  log(formatCheck('Bun runtime'));

  // ── Step 3: Determine install root ────────────────────────────────────────
  const installRoot = resolveInstallRoot(fromSource);
  mkdirSync(installRoot, { recursive: true });

  if (verbose) {
    log(formatCheck(`Install root: ${installRoot}`));
  }

  // ── Step 4: Source acquisition ────────────────────────────────────────────
  if (fromSource) {
    // Clone the repo (skip if already present)
    const repoDir = installRoot;
    if (!existsSync(join(repoDir, 'package.json'))) {
      log('  Cloning agent-recall repository...');
      const cloneResult = spawnSync('git', ['clone', '--depth', '1', AGENT_RECALL_REPO, repoDir], {
        stdio: verbose ? 'inherit' : 'pipe',
        timeout: 120_000,
      });
      if (cloneResult.status !== 0) {
        log(formatFail('git clone', 'failed'));
        return 2;
      }
      log(formatCheck('Repository cloned'));
    } else {
      log(formatSkip('Repository already present — skipping clone'));
    }

    // bun install
    log('  Installing dependencies...');
    const bunInstall = spawnSync('bun', ['install', '--frozen-lockfile'], {
      cwd: repoDir,
      stdio: verbose ? 'inherit' : 'pipe',
      timeout: 120_000,
    });
    if (bunInstall.status !== 0) {
      // Retry without --frozen-lockfile (lockfile may not exist in fresh clone)
      const bunInstall2 = spawnSync('bun', ['install'], {
        cwd: repoDir,
        stdio: verbose ? 'inherit' : 'pipe',
        timeout: 120_000,
      });
      if (bunInstall2.status !== 0) {
        log(formatFail('bun install', 'failed'));
        return 2;
      }
    }
    log(formatCheck('Dependencies installed'));

    // npm run build
    log('  Building plugin artifacts...');
    const buildResult = spawnSync('npm', ['run', 'build'], {
      cwd: repoDir,
      stdio: verbose ? 'inherit' : 'pipe',
      timeout: 180_000,
    });
    if (buildResult.status !== 0) {
      log(formatFail('npm run build', 'failed'));
      return 2;
    }
    log(formatCheck('Plugin artifacts built'));
  } else {
    // npm mode: copy plugin/ from the package into installRoot
    const pluginSrc = resolvePluginDir();
    if (!pluginSrc) {
      log(formatFail('plugin/ directory', 'not found — package may be incomplete'));
      return 2;
    }

    log('  Copying plugin artifacts...');
    try {
      copyPluginArtifacts(pluginSrc, installRoot);
      log(formatCheck('Plugin artifacts copied'));
    } catch (err) {
      log(formatFail('Copy failed', (err as Error).message));
      return 2;
    }

    // Install plugin dependencies
    const pluginDest = join(installRoot, 'plugin');
    if (existsSync(join(pluginDest, 'package.json'))) {
      log('  Installing plugin dependencies...');
      const bunInstall = spawnSync('bun', ['install'], {
        cwd: pluginDest,
        stdio: verbose ? 'inherit' : 'pipe',
        timeout: 120_000,
      });
      if (bunInstall.status !== 0) {
        log(formatFail('bun install (plugin)', 'failed'));
        return 1; // non-fatal — worker may still start
      }
      log(formatCheck('Plugin dependencies installed'));
    }
  }

  // ── Step 5: Detect platforms ──────────────────────────────────────────────
  let platforms = detectPlatforms();

  if (platformFilter) {
    const filtered = getPlatformById(platformFilter);
    if (!filtered) {
      log(formatFail(`--platform ${platformFilter}`, 'unknown platform id'));
      log('  Valid ids: claude-code, cursor, codex, gemini, opencode');
      return 1;
    }
    platforms = [filtered];
  }

  if (platforms.length === 0) {
    log(formatFail('Platform detection', 'no supported platforms detected'));
    log('  Supported: Claude Code, Cursor, Codex CLI, Gemini CLI, OpenCode');
    return 1;
  }

  // ── Step 6: Register hooks per platform ───────────────────────────────────
  log('');
  log('  Registering hooks...');

  const pluginRoot = fromSource ? installRoot : join(installRoot, 'plugin');
  // For source builds, plugin/ is at <installRoot>/plugin/ after build
  const effectivePluginRoot = fromSource ? join(installRoot, 'plugin') : join(installRoot, 'plugin');

  let hooksFailed = 0;
  for (const p of platforms) {
    const sourcePath = p.getHooksSource(effectivePluginRoot);
    const targetPath = p.getHooksTarget(effectivePluginRoot);

    if (isHooksRegistered(targetPath) && !verbose) {
      log(formatSkip(`${p.name} hooks already registered`));
      continue;
    }

    try {
      registerHooks(effectivePluginRoot, sourcePath, targetPath);
      log(formatCheck(`${p.name} hooks registered`));
    } catch (err) {
      log(formatFail(`${p.name} hooks`, (err as Error).message));
      hooksFailed++;
    }
  }

  // ── Step 7: Start Worker ───────────────────────────────────────────────────
  log('');
  log('  Starting Worker service...');

  const workerAlreadyRunning = (await checkWorkerRunning()).ok;
  if (workerAlreadyRunning) {
    log(formatSkip('Worker already running'));
  } else {
    const bunRunnerPath = join(effectivePluginRoot, 'scripts', 'bun-runner.js');
    const workerServicePath = join(effectivePluginRoot, 'scripts', 'worker-service.cjs');

    if (!existsSync(bunRunnerPath)) {
      log(formatFail('bun-runner.js', `not found at ${bunRunnerPath}`));
      return 1;
    }

    spawnSync('node', [bunRunnerPath, workerServicePath, 'start'], {
      stdio: 'pipe',
      timeout: 15_000,
    });

    // ── Step 8: Verify health endpoint ──────────────────────────────────────
    log('  Waiting for Worker to become ready...');
    const workerReady = await waitForWorker(WORKER_HEALTH_RETRIES, WORKER_HEALTH_DELAY_MS);

    if (workerReady) {
      log(formatCheck('Worker service running'));
    } else {
      log(formatFail('Worker service', 'did not respond — you may need to start it manually'));
      log('  Run: npx agent-recall worker start');
      hooksFailed++; // treat as soft failure
    }
  }

  // ── Step 9: Summary ────────────────────────────────────────────────────────
  log('');
  if (hooksFailed === 0) {
    log(formatCheck('Installation complete'));
    log('');
    log('  View your memory: http://localhost:37777');
  } else {
    log(formatFail(`Installation completed with ${hooksFailed} issue(s) — check output above`));
    return 1;
  }

  return 0;
}
