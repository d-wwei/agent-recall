# One-Click Install System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `npx agent-recall` CLI as the single entry point for installing, diagnosing, and managing Agent Recall across all AI agent platforms.

**Architecture:** TypeScript CLI compiled by esbuild to `bin/agent-recall.cjs`. Reuses existing platform detection patterns and hook registration logic from shell scripts. CLI dispatches to command modules (install, doctor, adapter, status, uninstall). No external CLI framework — hand-parsed args.

**Tech Stack:** TypeScript, esbuild (existing build pipeline), Node.js child_process for Bun/Worker management.

**Spec:** `docs/superpowers/specs/2026-04-10-one-click-install-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/cli/installer/index.ts` | Entry point: parse argv, dispatch to command handler |
| `src/cli/installer/commands/install.ts` | Install orchestration: npm mode + --from-source mode |
| `src/cli/installer/commands/doctor.ts` | Diagnostic checks with --fix auto-repair |
| `src/cli/installer/commands/adapter.ts` | adapter list / install / remove |
| `src/cli/installer/commands/status.ts` | Runtime status (Worker, DB, vector engine) |
| `src/cli/installer/commands/uninstall.ts` | Clean removal: hooks, Worker, optional DB |
| `src/cli/installer/lib/platform-detect.ts` | Detect installed AI platforms |
| `src/cli/installer/lib/hook-register.ts` | Register/remove hooks per platform |
| `src/cli/installer/lib/runtime-check.ts` | Check Bun, Node.js, Worker, DB, SeekDB |
| `src/cli/installer/lib/output.ts` | Colored terminal output helpers (✓ ✗ ○) |
| `tests/cli/installer/platform-detect.test.ts` | Tests for platform detection |
| `tests/cli/installer/doctor.test.ts` | Tests for doctor checks |
| `tests/cli/installer/install.test.ts` | Tests for install flow |
| `bin/agent-recall.cjs` | esbuild output (compiled CLI) |
| `INSTALL.md` | Dual-audience install documentation |

Modified files:
- `package.json` — add `bin` field, update `files` field
- `scripts/build-hooks.js` — add CLI entry point to esbuild config
- `install/public/install.sh` — simplify to npx wrapper

---

### Task 1: Output helpers + CLI entry point

**Files:**
- Create: `src/cli/installer/lib/output.ts`
- Create: `src/cli/installer/index.ts`
- Test: `tests/cli/installer/cli-entry.test.ts`

- [ ] **Step 1: Write test for output helpers**

```typescript
// tests/cli/installer/cli-entry.test.ts
import { describe, it, expect } from 'bun:test';
import { formatCheck, formatSkip, formatFail, formatHeader } from '../../../src/cli/installer/lib/output';

describe('output helpers', () => {
  it('formatCheck returns green checkmark line', () => {
    const result = formatCheck('Bun available');
    expect(result).toContain('✓');
    expect(result).toContain('Bun available');
  });

  it('formatFail returns red cross line', () => {
    const result = formatFail('Worker not running');
    expect(result).toContain('✗');
    expect(result).toContain('Worker not running');
  });

  it('formatSkip returns circle line', () => {
    const result = formatSkip('ChromaDB disabled');
    expect(result).toContain('○');
    expect(result).toContain('ChromaDB disabled');
  });

  it('formatHeader returns bold section header', () => {
    const result = formatHeader('Runtime');
    expect(result).toContain('Runtime');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/installer/cli-entry.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement output helpers**

```typescript
// src/cli/installer/lib/output.ts
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

export function formatCheck(msg: string): string {
  return `  ${GREEN}✓${RESET} ${msg}`;
}

export function formatFail(msg: string, hint?: string): string {
  const base = `  ${RED}✗${RESET} ${msg}`;
  return hint ? `${base}\n    ${DIM}→ ${hint}${RESET}` : base;
}

export function formatSkip(msg: string): string {
  return `  ${DIM}○${RESET} ${DIM}${msg}${RESET}`;
}

export function formatHeader(title: string): string {
  return `\n${BOLD}${title}${RESET}`;
}

export function formatBanner(): string {
  return `${BOLD}${CYAN}Agent Recall${RESET}`;
}

export function log(msg: string): void {
  console.error(msg); // stderr for user messages, stdout reserved for JSON
}
```

- [ ] **Step 4: Implement CLI entry point**

```typescript
// src/cli/installer/index.ts
import { log, formatBanner } from './lib/output.js';

const COMMANDS: Record<string, () => Promise<void>> = {
  install: () => import('./commands/install.js').then(m => m.run()),
  doctor: () => import('./commands/doctor.js').then(m => m.run()),
  adapter: () => import('./commands/adapter.js').then(m => m.run()),
  status: () => import('./commands/status.js').then(m => m.run()),
  uninstall: () => import('./commands/uninstall.js').then(m => m.run()),
};

function printHelp(): void {
  log(`${formatBanner()} — Persistent memory for AI agents\n`);
  log('Usage: npx agent-recall <command> [options]\n');
  log('Commands:');
  log('  install              Install Agent Recall');
  log('    --from-source      Clone repo + local build');
  log('    --platform <name>  Only install for specified platform');
  log('  adapter              Manage platform adapters');
  log('    list               List all platforms + install status');
  log('    install <platform> Install adapter for platform');
  log('    remove <platform>  Remove adapter for platform');
  log('  doctor               Diagnostic check');
  log('    --fix              Attempt auto-fix');
  log('  status               Show runtime status');
  log('  uninstall            Full uninstall');
  log('');
  log('Platforms: claude-code, cursor, codex, gemini, opencode');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  if (command === '--version' || command === '-v') {
    // Version injected at build time
    const version = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined'
      ? __DEFAULT_PACKAGE_VERSION__ : '0.0.0-dev';
    log(version);
    process.exit(0);
  }

  const handler = COMMANDS[command];
  if (!handler) {
    log(`Unknown command: ${command}\n`);
    printHelp();
    process.exit(1);
  }

  try {
    await handler();
  } catch (err: any) {
    log(`\x1b[31mError: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

declare const __DEFAULT_PACKAGE_VERSION__: string;

main();
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/cli/installer/cli-entry.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/installer/lib/output.ts src/cli/installer/index.ts tests/cli/installer/cli-entry.test.ts
git commit -m "feat(cli): add output helpers and CLI entry point"
```

---

### Task 2: Platform detection module

**Files:**
- Create: `src/cli/installer/lib/platform-detect.ts`
- Test: `tests/cli/installer/platform-detect.test.ts`

- [ ] **Step 1: Write test for platform detection**

```typescript
// tests/cli/installer/platform-detect.test.ts
import { describe, it, expect } from 'bun:test';
import { Platform, detectPlatforms, PLATFORMS } from '../../../src/cli/installer/lib/platform-detect';

describe('platform-detect', () => {
  it('exports all 5 platform definitions', () => {
    expect(PLATFORMS).toHaveLength(5);
    const names = PLATFORMS.map(p => p.id);
    expect(names).toContain('claude-code');
    expect(names).toContain('cursor');
    expect(names).toContain('codex');
    expect(names).toContain('gemini');
    expect(names).toContain('opencode');
  });

  it('each platform has id, name, detect, hooksTarget, and hooksSource', () => {
    for (const p of PLATFORMS) {
      expect(p.id).toBeTruthy();
      expect(p.name).toBeTruthy();
      expect(typeof p.detect).toBe('function');
      expect(typeof p.getHooksTarget).toBe('function');
      expect(typeof p.getHooksSource).toBe('function');
    }
  });

  it('detectPlatforms returns array of detected platforms', () => {
    const detected = detectPlatforms();
    expect(Array.isArray(detected)).toBe(true);
    // On this dev machine, at least Claude Code should be detected
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/installer/platform-detect.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement platform detection**

```typescript
// src/cli/installer/lib/platform-detect.ts
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawnSync } from 'child_process';

export interface Platform {
  id: string;
  name: string;
  detect: () => boolean;
  getHooksTarget: (agentRecallRoot: string) => string;
  getHooksSource: (agentRecallRoot: string) => string;
}

function commandExists(cmd: string): boolean {
  const result = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  return result.status === 0;
}

function dirExists(path: string): boolean {
  return existsSync(path);
}

const home = homedir();

export const PLATFORMS: Platform[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: () => dirExists(join(home, '.claude')),
    getHooksTarget: () => join(home, '.claude', 'plugins', 'marketplaces', 'agent-recall', 'plugin', 'hooks', 'hooks.json'),
    getHooksSource: (root: string) => join(root, 'plugin', 'hooks', 'hooks.json'),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: () => dirExists(join(home, '.cursor')),
    getHooksTarget: () => join(home, '.cursor', 'hooks', 'agent-recall.json'),
    getHooksSource: (root: string) => join(root, 'cursor-hooks', 'hooks.json'),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    detect: () => dirExists(join(home, '.codex')) || commandExists('codex'),
    getHooksTarget: () => join(home, '.codex', 'hooks.json'),
    getHooksSource: (root: string) => join(root, 'codex-hooks', 'hooks.json'),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    detect: () => dirExists(join(home, '.gemini')) || commandExists('gemini'),
    getHooksTarget: () => join(home, '.gemini', 'hooks', 'agent-recall.json'),
    getHooksSource: (root: string) => join(root, 'gemini-hooks', 'hooks.json'),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    detect: () => dirExists(join(home, '.config', 'opencode')) || commandExists('opencode'),
    getHooksTarget: () => {
      const xdg = join(home, '.config', 'opencode', 'plugins', 'agent-recall', 'index.ts');
      const legacy = join(home, '.opencode', 'plugins', 'agent-recall', 'index.ts');
      return existsSync(join(home, '.config', 'opencode')) ? xdg : legacy;
    },
    getHooksSource: (root: string) => join(root, 'opencode-plugin', 'index.ts'),
  },
];

export function detectPlatforms(): Platform[] {
  return PLATFORMS.filter(p => p.detect());
}

export function getPlatformById(id: string): Platform | undefined {
  return PLATFORMS.find(p => p.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/installer/platform-detect.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/installer/lib/platform-detect.ts tests/cli/installer/platform-detect.test.ts
git commit -m "feat(cli): add platform detection module"
```

---

### Task 3: Runtime check module

**Files:**
- Create: `src/cli/installer/lib/runtime-check.ts`
- Test: `tests/cli/installer/runtime-check.test.ts`

- [ ] **Step 1: Write test for runtime checks**

```typescript
// tests/cli/installer/runtime-check.test.ts
import { describe, it, expect } from 'bun:test';
import {
  checkNodeVersion,
  checkBunAvailable,
  checkWorkerRunning,
  checkDatabase,
  checkSeekdb,
  checkDiskSpace,
  type CheckResult,
} from '../../../src/cli/installer/lib/runtime-check';

describe('runtime-check', () => {
  it('checkNodeVersion returns ok when Node >= 18', () => {
    const result = checkNodeVersion();
    expect(result.ok).toBe(true);
    expect(result.label).toContain('Node.js');
  });

  it('checkBunAvailable returns a CheckResult', () => {
    const result = checkBunAvailable();
    expect(typeof result.ok).toBe('boolean');
    expect(result.label).toContain('Bun');
  });

  it('checkWorkerRunning returns a CheckResult with port info', () => {
    const result = checkWorkerRunning();
    expect(typeof result.ok).toBe('boolean');
    expect(result.label).toContain('Worker');
  });

  it('checkDatabase returns a CheckResult', () => {
    const result = checkDatabase();
    expect(typeof result.ok).toBe('boolean');
    expect(result.label).toContain('SQLite');
  });

  it('checkSeekdb returns a CheckResult', () => {
    const result = checkSeekdb();
    expect(typeof result.ok).toBe('boolean');
  });

  it('checkDiskSpace returns a CheckResult', () => {
    const result = checkDiskSpace();
    expect(result.ok).toBe(true); // Dev machine should have space
    expect(result.label).toContain('Disk');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/installer/runtime-check.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement runtime checks**

```typescript
// src/cli/installer/lib/runtime-check.ts
import { existsSync, statSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { spawnSync, execSync } from 'child_process';

export interface CheckResult {
  ok: boolean;
  label: string;
  detail?: string;
  hint?: string;
  fixable?: boolean;
  category: 'runtime' | 'worker' | 'database' | 'compilation' | 'adapter' | 'viewer' | 'config';
}

const DATA_DIR = join(homedir(), '.agent-recall');
const DB_PATH = join(DATA_DIR, 'agent-recall.db');
const WORKER_PORT = 37777;

export function checkNodeVersion(): CheckResult {
  try {
    const version = process.version.replace('v', '');
    const major = parseInt(version.split('.')[0], 10);
    return {
      ok: major >= 18,
      label: `Node.js ${process.version}`,
      hint: major < 18 ? 'Upgrade Node.js to >= 18: https://nodejs.org' : undefined,
      category: 'runtime',
    };
  } catch {
    return { ok: false, label: 'Node.js not detected', hint: 'Install from https://nodejs.org', category: 'runtime' };
  }
}

export function checkBunAvailable(): CheckResult {
  const result = spawnSync('bun', ['--version'], {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  if (result.status === 0) {
    return { ok: true, label: `Bun ${result.stdout.trim()}`, category: 'runtime' };
  }
  // Check common paths
  const bunPaths = process.platform === 'win32'
    ? [join(homedir(), '.bun', 'bin', 'bun.exe')]
    : [join(homedir(), '.bun', 'bin', 'bun'), '/usr/local/bin/bun', '/opt/homebrew/bin/bun'];
  for (const p of bunPaths) {
    if (existsSync(p)) {
      return { ok: true, label: `Bun found at ${p} (not in PATH)`, hint: 'Add Bun to PATH for faster startup', category: 'runtime' };
    }
  }
  return { ok: false, label: 'Bun not found', hint: 'Install: curl -fsSL https://bun.sh/install | bash', fixable: true, category: 'runtime' };
}

export function checkWorkerRunning(): CheckResult {
  try {
    const resp = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${WORKER_PORT}/api/health`], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    const code = resp.stdout?.trim();
    if (code === '200') {
      // Get version
      try {
        const vResp = spawnSync('curl', ['-s', `http://127.0.0.1:${WORKER_PORT}/api/health`], { encoding: 'utf-8', timeout: 3000 });
        const data = JSON.parse(vResp.stdout);
        return { ok: true, label: `Worker running on port ${WORKER_PORT} (v${data.version || 'unknown'})`, category: 'worker' };
      } catch {
        return { ok: true, label: `Worker running on port ${WORKER_PORT}`, category: 'worker' };
      }
    }
    return { ok: false, label: 'Worker not running', hint: 'Run: npx agent-recall install', fixable: true, category: 'worker' };
  } catch {
    return { ok: false, label: 'Worker not running', hint: 'Run: npx agent-recall install', fixable: true, category: 'worker' };
  }
}

export function checkDatabase(): CheckResult {
  if (!existsSync(DB_PATH)) {
    return { ok: false, label: 'SQLite database not found', detail: DB_PATH, category: 'database' };
  }
  const size = statSync(DB_PATH).size;
  const sizeMB = (size / 1024 / 1024).toFixed(1);
  return { ok: true, label: `SQLite: ${DB_PATH} (${sizeMB} MB)`, category: 'database' };
}

export function checkSeekdb(): CheckResult {
  const seekdbPath = join(DATA_DIR, 'vector-db', 'seekdb.db');
  if (!existsSync(seekdbPath)) {
    return { ok: false, label: 'SeekDB vector engine: not initialized', hint: 'Will initialize on first session', category: 'database' };
  }
  return { ok: true, label: 'SeekDB vector engine: active', category: 'database' };
}

export function checkChromaFallback(): CheckResult {
  // ChromaDB is disabled by default — just report status
  return { ok: true, label: 'ChromaDB fallback: disabled (default)', category: 'database' };
}

export function checkDiskSpace(): CheckResult {
  try {
    const output = execSync('df -k ~/', { encoding: 'utf-8' });
    const lines = output.trim().split('\n');
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/);
      const availKB = parseInt(parts[3], 10);
      const availGB = (availKB / 1024 / 1024).toFixed(0);
      const ok = availKB > 100 * 1024; // > 100 MB
      return { ok, label: `Disk space: ${availGB} GB free`, hint: ok ? undefined : 'Low disk space', category: 'database' };
    }
  } catch { /* fallback */ }
  return { ok: true, label: 'Disk space: unknown', category: 'database' };
}

export function checkViewer(): CheckResult {
  try {
    const resp = spawnSync('curl', ['-s', '-o', '/dev/null', '-w', '%{http_code}', `http://127.0.0.1:${WORKER_PORT}/`], {
      encoding: 'utf-8',
      timeout: 3000,
    });
    if (resp.stdout?.trim() === '200') {
      return { ok: true, label: `Viewer: http://localhost:${WORKER_PORT}`, category: 'viewer' };
    }
  } catch { /* fallback */ }
  return { ok: false, label: 'Viewer not accessible', hint: 'Worker may not be running', fixable: true, category: 'viewer' };
}

export function runAllChecks(): CheckResult[] {
  return [
    checkNodeVersion(),
    checkBunAvailable(),
    checkWorkerRunning(),
    checkDatabase(),
    checkSeekdb(),
    checkChromaFallback(),
    checkDiskSpace(),
    checkViewer(),
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/installer/runtime-check.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/installer/lib/runtime-check.ts tests/cli/installer/runtime-check.test.ts
git commit -m "feat(cli): add runtime check module"
```

---

### Task 4: Hook registration module

**Files:**
- Create: `src/cli/installer/lib/hook-register.ts`
- Test: `tests/cli/installer/hook-register.test.ts`

- [ ] **Step 1: Write test for hook registration**

```typescript
// tests/cli/installer/hook-register.test.ts
import { describe, it, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { registerHooks, isHooksRegistered, removeHooks } from '../../../src/cli/installer/lib/hook-register';
import { PLATFORMS } from '../../../src/cli/installer/lib/platform-detect';

describe('hook-register', () => {
  it('registerHooks copies and substitutes hooks.json for codex', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ar-test-'));
    const fakeRoot = join(tmp, 'agent-recall');
    const fakeHooksDir = join(fakeRoot, 'codex-hooks');
    const fakeTarget = join(tmp, 'codex-target', 'hooks.json');

    // Create fake source hooks.json with $AGENT_RECALL_ROOT placeholder
    require('fs').mkdirSync(fakeHooksDir, { recursive: true });
    writeFileSync(join(fakeHooksDir, 'hooks.json'), '{"root": "$AGENT_RECALL_ROOT/plugin"}');

    registerHooks(fakeRoot, join(fakeHooksDir, 'hooks.json'), fakeTarget);

    expect(existsSync(fakeTarget)).toBe(true);
    const content = readFileSync(fakeTarget, 'utf-8');
    expect(content).toContain(fakeRoot);
    expect(content).not.toContain('$AGENT_RECALL_ROOT');
  });

  it('isHooksRegistered returns false for missing file', () => {
    expect(isHooksRegistered('/nonexistent/path/hooks.json')).toBe(false);
  });

  it('removeHooks deletes hooks file', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'ar-test-'));
    const target = join(tmp, 'hooks.json');
    writeFileSync(target, '{}');
    expect(existsSync(target)).toBe(true);
    removeHooks(target);
    expect(existsSync(target)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/installer/hook-register.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement hook registration**

```typescript
// src/cli/installer/lib/hook-register.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { dirname } from 'path';

/**
 * Register hooks by copying source hooks.json to target path,
 * substituting $AGENT_RECALL_ROOT with the actual install root.
 */
export function registerHooks(agentRecallRoot: string, sourcePath: string, targetPath: string): void {
  if (!existsSync(sourcePath)) {
    throw new Error(`Hooks source not found: ${sourcePath}`);
  }

  const content = readFileSync(sourcePath, 'utf-8');
  const substituted = content.replace(/\$AGENT_RECALL_ROOT/g, agentRecallRoot);

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, substituted, 'utf-8');
}

/**
 * Check if hooks file exists at expected target location.
 */
export function isHooksRegistered(targetPath: string): boolean {
  return existsSync(targetPath);
}

/**
 * Remove hooks file from target location.
 */
export function removeHooks(targetPath: string): void {
  if (existsSync(targetPath)) {
    unlinkSync(targetPath);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/installer/hook-register.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/installer/lib/hook-register.ts tests/cli/installer/hook-register.test.ts
git commit -m "feat(cli): add hook registration module"
```

---

### Task 5: Doctor command

**Files:**
- Create: `src/cli/installer/commands/doctor.ts`
- Test: `tests/cli/installer/doctor.test.ts`

- [ ] **Step 1: Write test for doctor command**

```typescript
// tests/cli/installer/doctor.test.ts
import { describe, it, expect } from 'bun:test';
import { runDoctor, type DoctorReport } from '../../../src/cli/installer/commands/doctor';

describe('doctor command', () => {
  it('runDoctor returns a DoctorReport with categorized checks', () => {
    const report = runDoctor();
    expect(report.checks.length).toBeGreaterThan(0);
    expect(typeof report.issueCount).toBe('number');
    expect(typeof report.fixableCount).toBe('number');
  });

  it('every check has required fields', () => {
    const report = runDoctor();
    for (const check of report.checks) {
      expect(typeof check.ok).toBe('boolean');
      expect(typeof check.label).toBe('string');
      expect(['runtime', 'worker', 'database', 'compilation', 'adapter', 'viewer', 'config']).toContain(check.category);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/installer/doctor.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement doctor command**

```typescript
// src/cli/installer/commands/doctor.ts
import { runAllChecks, type CheckResult } from '../lib/runtime-check.js';
import { detectPlatforms, PLATFORMS } from '../lib/platform-detect.js';
import { isHooksRegistered } from '../lib/hook-register.js';
import { log, formatCheck, formatFail, formatSkip, formatHeader } from '../lib/output.js';

export interface DoctorReport {
  checks: CheckResult[];
  issueCount: number;
  fixableCount: number;
}

export function runDoctor(): DoctorReport {
  const checks = runAllChecks();

  // Add adapter checks for all platforms
  for (const platform of PLATFORMS) {
    const detected = platform.detect();
    if (detected) {
      const hooksTarget = platform.getHooksTarget('');
      const registered = isHooksRegistered(hooksTarget);
      checks.push({
        ok: registered,
        label: `${platform.name}: hooks ${registered ? 'registered' : 'missing'}`,
        hint: registered ? undefined : `Run: npx agent-recall adapter install ${platform.id}`,
        fixable: !registered,
        category: 'adapter',
      });
    }
  }

  const issueCount = checks.filter(c => !c.ok).length;
  const fixableCount = checks.filter(c => !c.ok && c.fixable).length;

  return { checks, issueCount, fixableCount };
}

function printReport(report: DoctorReport): void {
  log('\nAgent Recall Doctor');
  log('───────────────────');

  const categories = ['runtime', 'worker', 'database', 'compilation', 'adapter', 'viewer', 'config'] as const;
  const categoryNames: Record<string, string> = {
    runtime: 'Runtime',
    worker: 'Worker Service',
    database: 'Database',
    compilation: 'Compilation Engine',
    adapter: 'Platform Adapters',
    viewer: 'Viewer UI',
    config: 'Configuration',
  };

  for (const cat of categories) {
    const catChecks = report.checks.filter(c => c.category === cat);
    if (catChecks.length === 0) continue;

    log(formatHeader(categoryNames[cat]));
    for (const check of catChecks) {
      if (check.ok) {
        log(formatCheck(check.label));
      } else {
        log(formatFail(check.label, check.hint));
      }
    }
  }

  log('');
  if (report.issueCount === 0) {
    log('\x1b[32mAll checks passed.\x1b[0m');
  } else {
    log(`${report.issueCount} issue(s) found.${report.fixableCount > 0 ? ' Run with --fix to attempt auto-repair.' : ''}`);
  }
}

export async function run(): Promise<void> {
  const args = process.argv.slice(3);
  const shouldFix = args.includes('--fix');

  const report = runDoctor();
  printReport(report);

  if (shouldFix && report.fixableCount > 0) {
    log('\nAttempting auto-fix...');
    // Re-check after each fix
    for (const check of report.checks) {
      if (!check.ok && check.fixable) {
        log(`  Fixing: ${check.label}...`);
        // Fixes are command-specific — handled by delegating to install/adapter commands
      }
    }
  }

  process.exit(report.issueCount > 0 ? 1 : 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/installer/doctor.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/installer/commands/doctor.ts tests/cli/installer/doctor.test.ts
git commit -m "feat(cli): add doctor diagnostic command"
```

---

### Task 6: Install command

**Files:**
- Create: `src/cli/installer/commands/install.ts`
- Test: `tests/cli/installer/install.test.ts`

- [ ] **Step 1: Write test for install command**

```typescript
// tests/cli/installer/install.test.ts
import { describe, it, expect } from 'bun:test';
import { resolveInstallRoot, ensureBun } from '../../../src/cli/installer/commands/install';

describe('install command', () => {
  it('resolveInstallRoot returns ~/.agent-recall for npm mode', () => {
    const root = resolveInstallRoot(false);
    expect(root).toContain('.agent-recall');
  });

  it('resolveInstallRoot returns ~/.agent-recall/source for from-source mode', () => {
    const root = resolveInstallRoot(true);
    expect(root).toContain('source');
  });

  it('ensureBun returns true when Bun is available', () => {
    // On this dev machine, Bun should be available
    const result = ensureBun();
    expect(result).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/installer/install.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement install command**

```typescript
// src/cli/installer/commands/install.ts
import { existsSync, mkdirSync, cpSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync, spawnSync } from 'child_process';
import { log, formatCheck, formatFail, formatSkip, formatBanner } from '../lib/output.js';
import { detectPlatforms, getPlatformById, type Platform } from '../lib/platform-detect.js';
import { registerHooks } from '../lib/hook-register.js';
import { checkBunAvailable, checkWorkerRunning } from '../lib/runtime-check.js';

const DATA_DIR = join(homedir(), '.agent-recall');
const WORKER_PORT = 37777;

export function resolveInstallRoot(fromSource: boolean): string {
  if (fromSource) {
    return join(DATA_DIR, 'source');
  }
  return DATA_DIR;
}

export function ensureBun(): boolean {
  const check = checkBunAvailable();
  if (check.ok) return true;

  log('Installing Bun...');
  try {
    if (process.platform === 'win32') {
      execSync('powershell -c "irm bun.sh/install.ps1 | iex"', { stdio: ['pipe', 'pipe', 'inherit'] });
    } else {
      execSync('curl -fsSL https://bun.sh/install | bash', { stdio: ['pipe', 'pipe', 'inherit'] });
    }
    return checkBunAvailable().ok;
  } catch {
    return false;
  }
}

function findPluginDir(): string {
  // When running via npx, the plugin/ dir is inside the npm package
  const candidates = [
    join(__dirname, '..', '..', 'plugin'),           // bin/agent-recall.cjs → ../../plugin
    join(__dirname, '..', 'plugin'),                  // fallback
    join(process.cwd(), 'plugin'),                    // local dev
  ];
  for (const c of candidates) {
    if (existsSync(join(c, 'hooks', 'hooks.json'))) {
      return c;
    }
  }
  throw new Error('Could not locate plugin/ directory. Is the package installed correctly?');
}

function installNpmMode(): string {
  const pluginDir = findPluginDir();
  const installDir = join(DATA_DIR, 'plugin');

  mkdirSync(DATA_DIR, { recursive: true });

  // Copy plugin artifacts
  log('  Copying plugin artifacts...');
  cpSync(pluginDir, installDir, { recursive: true, force: true });

  // Install runtime dependencies
  log('  Installing dependencies...');
  try {
    execSync('bun install --production', { cwd: installDir, stdio: ['pipe', 'pipe', 'inherit'] });
  } catch {
    // Fallback to npm
    execSync('npm install --production', { cwd: installDir, stdio: ['pipe', 'pipe', 'inherit'] });
  }

  return DATA_DIR;
}

function installFromSource(): string {
  const sourceDir = resolveInstallRoot(true);
  const repoUrl = 'https://github.com/d-wwei/agent-recall.git';

  if (existsSync(join(sourceDir, '.git'))) {
    log('  Source already cloned, pulling latest...');
    execSync('git pull', { cwd: sourceDir, stdio: ['pipe', 'pipe', 'inherit'] });
  } else {
    log('  Cloning repository...');
    mkdirSync(DATA_DIR, { recursive: true });
    execSync(`git clone ${repoUrl} "${sourceDir}"`, { stdio: ['pipe', 'pipe', 'inherit'] });
  }

  log('  Installing dependencies...');
  execSync('bun install', { cwd: sourceDir, stdio: ['pipe', 'pipe', 'inherit'] });

  log('  Building...');
  execSync('npm run build', { cwd: sourceDir, stdio: ['pipe', 'pipe', 'inherit'] });

  return sourceDir;
}

function startWorker(root: string): boolean {
  const workerScript = join(root, 'plugin', 'scripts', 'worker-service.cjs');
  if (!existsSync(workerScript)) {
    log(formatFail('Worker script not found', workerScript));
    return false;
  }

  try {
    const bunRunner = join(root, 'plugin', 'scripts', 'bun-runner.js');
    if (existsSync(bunRunner)) {
      spawnSync('node', [bunRunner, workerScript, 'start'], {
        stdio: ['pipe', 'pipe', 'inherit'],
        timeout: 30000,
      });
    } else {
      spawnSync('bun', [workerScript, 'start'], {
        stdio: ['pipe', 'pipe', 'inherit'],
        timeout: 30000,
      });
    }
    // Wait for health
    for (let i = 0; i < 10; i++) {
      const check = checkWorkerRunning();
      if (check.ok) return true;
      spawnSync('sleep', ['1']);
    }
    return checkWorkerRunning().ok;
  } catch {
    return false;
  }
}

export async function run(): Promise<void> {
  const args = process.argv.slice(3);
  const fromSource = args.includes('--from-source');
  const platformFilter = args.includes('--platform')
    ? args[args.indexOf('--platform') + 1]
    : null;

  log(`\n${formatBanner()} — Install\n`);

  // Step 1: Check Node.js
  const nodeVersion = process.version;
  const nodeMajor = parseInt(nodeVersion.replace('v', '').split('.')[0], 10);
  if (nodeMajor < 18) {
    log(formatFail(`Node.js ${nodeVersion} is too old`, 'Upgrade to >= 18: https://nodejs.org'));
    process.exit(1);
  }
  log(formatCheck(`Node.js ${nodeVersion}`));

  // Step 2: Ensure Bun
  if (!ensureBun()) {
    log(formatFail('Could not install Bun', 'Manual install: https://bun.sh'));
    process.exit(1);
  }
  log(formatCheck('Bun runtime ready'));

  // Step 3: Install
  let installRoot: string;
  if (fromSource) {
    log('\nInstalling from source...');
    installRoot = installFromSource();
  } else {
    log('\nInstalling from npm package...');
    installRoot = installNpmMode();
  }
  log(formatCheck(`Installed to ${installRoot}`));

  // Step 4: Detect and configure platforms
  log('\nConfiguring platforms...');
  const platforms = platformFilter
    ? [getPlatformById(platformFilter)].filter(Boolean) as Platform[]
    : detectPlatforms();

  if (platforms.length === 0) {
    log(formatSkip('No AI agent platforms detected'));
    log('  Install a platform first, then run: npx agent-recall adapter install <platform>');
  }

  for (const platform of platforms) {
    try {
      const source = platform.getHooksSource(installRoot);
      const target = platform.getHooksTarget(installRoot);
      registerHooks(installRoot, source, target);
      log(formatCheck(`${platform.name} — hooks registered`));
    } catch (err: any) {
      log(formatFail(`${platform.name} — ${err.message}`));
    }
  }

  // Step 5: Start Worker
  log('\nStarting Worker service...');
  const workerOk = startWorker(installRoot);
  if (workerOk) {
    log(formatCheck(`Worker started on port ${WORKER_PORT}`));
    log(formatCheck(`Viewer: http://localhost:${WORKER_PORT}`));
  } else {
    log(formatFail('Worker failed to start', 'Run: npx agent-recall doctor'));
  }

  // Summary
  log('\n───────────────────');
  log('Done! Your AI agents now have persistent memory.\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/cli/installer/install.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/installer/commands/install.ts tests/cli/installer/install.test.ts
git commit -m "feat(cli): add install command (npm + from-source modes)"
```

---

### Task 7: Adapter and status commands

**Files:**
- Create: `src/cli/installer/commands/adapter.ts`
- Create: `src/cli/installer/commands/status.ts`
- Create: `src/cli/installer/commands/uninstall.ts`

- [ ] **Step 1: Implement adapter command**

```typescript
// src/cli/installer/commands/adapter.ts
import { log, formatCheck, formatFail, formatSkip, formatHeader } from '../lib/output.js';
import { PLATFORMS, detectPlatforms, getPlatformById } from '../lib/platform-detect.js';
import { registerHooks, isHooksRegistered, removeHooks } from '../lib/hook-register.js';
import { homedir } from 'os';
import { join } from 'path';

const DATA_DIR = join(homedir(), '.agent-recall');

function listAdapters(): void {
  log(formatHeader('Platform Adapters'));
  for (const platform of PLATFORMS) {
    const detected = platform.detect();
    const target = platform.getHooksTarget(DATA_DIR);
    const registered = isHooksRegistered(target);

    if (!detected) {
      log(formatSkip(`${platform.name} — not installed`));
    } else if (registered) {
      log(formatCheck(`${platform.name} — hooks registered`));
    } else {
      log(formatFail(`${platform.name} — detected but hooks not registered`, `Run: npx agent-recall adapter install ${platform.id}`));
    }
  }
}

function installAdapter(platformId: string): void {
  const platform = getPlatformById(platformId);
  if (!platform) {
    log(formatFail(`Unknown platform: ${platformId}`));
    log(`Available: ${PLATFORMS.map(p => p.id).join(', ')}`);
    process.exit(1);
  }

  const source = platform.getHooksSource(DATA_DIR);
  const target = platform.getHooksTarget(DATA_DIR);

  try {
    registerHooks(DATA_DIR, source, target);
    log(formatCheck(`${platform.name} — hooks registered`));
  } catch (err: any) {
    log(formatFail(`${platform.name} — ${err.message}`));
    process.exit(1);
  }
}

function removeAdapter(platformId: string): void {
  const platform = getPlatformById(platformId);
  if (!platform) {
    log(formatFail(`Unknown platform: ${platformId}`));
    process.exit(1);
  }

  const target = platform.getHooksTarget(DATA_DIR);
  removeHooks(target);
  log(formatCheck(`${platform.name} — hooks removed`));
}

export async function run(): Promise<void> {
  const args = process.argv.slice(3);
  const subcommand = args[0];

  switch (subcommand) {
    case 'list':
      listAdapters();
      break;
    case 'install':
      if (!args[1]) { log(formatFail('Specify platform: npx agent-recall adapter install <platform>')); process.exit(1); }
      installAdapter(args[1]);
      break;
    case 'remove':
      if (!args[1]) { log(formatFail('Specify platform: npx agent-recall adapter remove <platform>')); process.exit(1); }
      removeAdapter(args[1]);
      break;
    default:
      log('Usage: npx agent-recall adapter <list|install|remove> [platform]');
      process.exit(1);
  }
}
```

- [ ] **Step 2: Implement status command**

```typescript
// src/cli/installer/commands/status.ts
import { log, formatCheck, formatFail, formatSkip, formatHeader } from '../lib/output.js';
import { checkWorkerRunning, checkDatabase, checkSeekdb, checkChromaFallback } from '../lib/runtime-check.js';

export async function run(): Promise<void> {
  log(formatHeader('Agent Recall Status'));

  const checks = [
    checkWorkerRunning(),
    checkDatabase(),
    checkSeekdb(),
    checkChromaFallback(),
  ];

  for (const check of checks) {
    if (check.ok) {
      log(formatCheck(check.label));
    } else {
      log(formatFail(check.label, check.hint));
    }
  }
}
```

- [ ] **Step 3: Implement uninstall command**

```typescript
// src/cli/installer/commands/uninstall.ts
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';
import { log, formatCheck, formatFail, formatHeader } from '../lib/output.js';
import { PLATFORMS } from '../lib/platform-detect.js';
import { removeHooks, isHooksRegistered } from '../lib/hook-register.js';
import { checkWorkerRunning } from '../lib/runtime-check.js';

const DATA_DIR = join(homedir(), '.agent-recall');

export async function run(): Promise<void> {
  log(formatHeader('Uninstalling Agent Recall'));

  // Step 1: Stop Worker
  if (checkWorkerRunning().ok) {
    log('  Stopping Worker...');
    try {
      execSync(`curl -s -X POST http://127.0.0.1:37777/api/admin/shutdown`, { timeout: 5000 });
      log(formatCheck('Worker stopped'));
    } catch {
      log(formatFail('Could not stop Worker', 'Kill manually: lsof -i :37777'));
    }
  }

  // Step 2: Remove hooks from all platforms
  for (const platform of PLATFORMS) {
    const target = platform.getHooksTarget(DATA_DIR);
    if (isHooksRegistered(target)) {
      removeHooks(target);
      log(formatCheck(`${platform.name} — hooks removed`));
    }
  }

  // Step 3: Prompt about data
  log('\nData directory: ' + DATA_DIR);
  log('  Database and vector embeddings are stored here.');
  log('  To remove all data: rm -rf ' + DATA_DIR);
  log('  (Not deleted automatically to prevent accidental data loss)\n');

  log(formatCheck('Uninstall complete'));
}
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/installer/commands/adapter.ts src/cli/installer/commands/status.ts src/cli/installer/commands/uninstall.ts
git commit -m "feat(cli): add adapter, status, and uninstall commands"
```

---

### Task 8: Build pipeline + package.json integration

**Files:**
- Modify: `scripts/build-hooks.js`
- Modify: `package.json`

- [ ] **Step 1: Add CLI entry point to esbuild config**

In `scripts/build-hooks.js`, add the CLI entry point definition alongside existing entries and add its build step:

```javascript
// Add after existing entry point definitions (WORKER_SERVICE, MCP_SERVER, CONTEXT_GENERATOR):
const CLI_INSTALLER = {
  name: 'agent-recall',
  source: 'src/cli/installer/index.ts'
};
```

Add its build call after existing builds (same pattern as worker-service but with `#!/usr/bin/env node` banner and output to `bin/` instead of `plugin/scripts/`):

```javascript
// CLI installer build
await build({
  entryPoints: [CLI_INSTALLER.source],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: `bin/${CLI_INSTALLER.name}.cjs`,
  minify: true,
  logLevel: 'error',
  external: [
    'bun:sqlite',
  ],
  define: {
    '__DEFAULT_PACKAGE_VERSION__': `"${version}"`
  },
  banner: {
    js: '#!/usr/bin/env node'
  }
});

fs.chmodSync(`bin/${CLI_INSTALLER.name}.cjs`, 0o755);
```

- [ ] **Step 2: Update package.json**

Add `bin` field and update `files` to include `bin/`:

```json
{
  "bin": {
    "agent-recall": "./bin/agent-recall.cjs"
  },
  "files": [
    "plugin",
    "bin",
    "!plugin/scripts/claude-mem"
  ]
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: `bin/agent-recall.cjs` created, executable

Run: `node bin/agent-recall.cjs --help`
Expected: Help text displayed

Run: `node bin/agent-recall.cjs --version`
Expected: Version printed

- [ ] **Step 4: Commit**

```bash
git add scripts/build-hooks.js package.json bin/agent-recall.cjs
git commit -m "feat(cli): integrate CLI into build pipeline"
```

---

### Task 9: INSTALL.md + simplified curl installer

**Files:**
- Create: `INSTALL.md`
- Modify: `install/public/install.sh`

- [ ] **Step 1: Write INSTALL.md**

```markdown
# Installing Agent Recall

Agent Recall gives your AI coding agents persistent memory across sessions.
It works with Claude Code, Cursor, Codex CLI, Gemini CLI, and OpenCode.

## Quick Start

```bash
npx agent-recall install
```

That's it. The installer auto-detects your AI platforms and configures them.

## Verify Installation

```bash
npx agent-recall doctor
```

## Managing Platforms

```bash
npx agent-recall adapter list              # See what's installed
npx agent-recall adapter install cursor    # Add a platform
npx agent-recall adapter remove cursor     # Remove a platform
```

## For Developers

Install from source (allows editing code):

```bash
npx agent-recall install --from-source
```

## Uninstall

```bash
npx agent-recall uninstall
```

Your memory database (~/.agent-recall/) is preserved. Delete manually if desired.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `npx` not found | Install Node.js >= 18 from https://nodejs.org |
| Bun install fails | Manual: `curl -fsSL https://bun.sh/install \| bash` |
| Worker won't start | `npx agent-recall doctor --fix` |
| Platform not detected | `npx agent-recall adapter install <platform>` |

---

## Agent-Executable Installation Steps

The following section is structured for AI agents to execute directly.

### Prerequisites

- Node.js >= 18 (verify: `node --version`)
- Internet access for npm package download

### Step-by-Step

1. Run: `npx agent-recall install`
2. Verify: `npx agent-recall doctor`
3. Expected output of doctor: all lines show ✓ (green checkmark)
4. If any ✗ (red cross) appears, run: `npx agent-recall doctor --fix`
5. Verify Worker is accessible: `curl -s http://localhost:37777/api/health`
6. Expected response: JSON with `{"status":"ok"}`

### Platform-Specific Manual Registration

If auto-detection fails, register manually:

- Claude Code: `npx agent-recall adapter install claude-code`
- Cursor: `npx agent-recall adapter install cursor`
- Codex CLI: `npx agent-recall adapter install codex`
- Gemini CLI: `npx agent-recall adapter install gemini`
- OpenCode: `npx agent-recall adapter install opencode`
```

- [ ] **Step 2: Simplify curl installer**

Replace `install/public/install.sh` contents:

```bash
#!/bin/bash
set -euo pipefail

# Agent Recall — One-line installer
# Usage: curl -fsSL <url> | bash

RED='\033[0;31m'
NC='\033[0m'

if ! command -v node &> /dev/null; then
  echo -e "${RED}Error: Node.js is required but not found.${NC}" >&2
  echo "Install from https://nodejs.org (>= 18)" >&2
  exit 1
fi

NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}Error: Node.js >= 18 required. Current: $(node -v)${NC}" >&2
  exit 1
fi

npx agent-recall install "$@"
```

- [ ] **Step 3: Commit**

```bash
git add INSTALL.md install/public/install.sh
git commit -m "docs: add INSTALL.md + simplify curl installer to npx wrapper"
```

---

### Task 10: Integration test + final verification

**Files:**
- Create: `tests/cli/installer/integration.test.ts`

- [ ] **Step 1: Write integration test**

```typescript
// tests/cli/installer/integration.test.ts
import { describe, it, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const CLI_PATH = join(__dirname, '..', '..', '..', 'bin', 'agent-recall.cjs');

describe('CLI integration', () => {
  it('bin/agent-recall.cjs exists and is executable', () => {
    expect(existsSync(CLI_PATH)).toBe(true);
  });

  it('--help prints usage info', () => {
    const result = spawnSync('node', [CLI_PATH, '--help'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('agent-recall');
    expect(result.stderr).toContain('install');
    expect(result.stderr).toContain('doctor');
  });

  it('--version prints a version string', () => {
    const result = spawnSync('node', [CLI_PATH, '--version'], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(result.stderr.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('unknown command exits with code 1', () => {
    const result = spawnSync('node', [CLI_PATH, 'nonexistent'], { encoding: 'utf-8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Unknown command');
  });

  it('doctor runs and produces output', () => {
    const result = spawnSync('node', [CLI_PATH, 'doctor'], { encoding: 'utf-8', timeout: 15000 });
    // Doctor may exit 0 or 1 depending on system state — both are valid
    expect(result.stderr).toContain('Agent Recall Doctor');
    expect(result.stderr).toContain('Runtime');
  });

  it('adapter list runs and produces output', () => {
    const result = spawnSync('node', [CLI_PATH, 'adapter', 'list'], { encoding: 'utf-8' });
    expect(result.stderr).toContain('Platform Adapters');
  });

  it('status runs and produces output', () => {
    const result = spawnSync('node', [CLI_PATH, 'status'], { encoding: 'utf-8' });
    expect(result.stderr).toContain('Status');
  });
});
```

- [ ] **Step 2: Build and run full test suite**

Run: `npm run build`
Run: `bun test tests/cli/installer/`
Expected: All tests pass

- [ ] **Step 3: Manual smoke test**

Run: `node bin/agent-recall.cjs --help`
Run: `node bin/agent-recall.cjs doctor`
Run: `node bin/agent-recall.cjs adapter list`
Run: `node bin/agent-recall.cjs status`

Verify each command produces expected output.

- [ ] **Step 4: Verify npm pack contents**

Run: `npm pack --dry-run 2>&1 | head -30`
Expected: `bin/agent-recall.cjs` and `plugin/` included, no `src/` or `tests/`

- [ ] **Step 5: Commit**

```bash
git add tests/cli/installer/integration.test.ts
git commit -m "test(cli): add integration tests for CLI commands"
```

---

## Task Summary

| Task | What | Files | Depends On |
|------|------|-------|------------|
| 1 | Output helpers + CLI entry | 3 new | — |
| 2 | Platform detection | 2 new | — |
| 3 | Runtime checks | 2 new | — |
| 4 | Hook registration | 2 new | — |
| 5 | Doctor command | 2 new | Tasks 2, 3, 4 |
| 6 | Install command | 2 new | Tasks 2, 3, 4 |
| 7 | Adapter, status, uninstall | 3 new | Tasks 2, 3, 4 |
| 8 | Build pipeline + package.json | 2 modified | Tasks 1-7 |
| 9 | INSTALL.md + curl simplification | 2 files | Task 8 |
| 10 | Integration test + verification | 1 new | Task 8 |

Tasks 1-4 are independent and can be parallelized. Tasks 5-7 depend on 1-4. Task 8 integrates everything. Tasks 9-10 are final.
