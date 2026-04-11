/**
 * Platform detection module for the agent-recall CLI installer.
 *
 * Detects which AI coding tool platforms are installed on the current machine
 * and provides hook target/source path resolution for each.
 *
 * Ported from scripts/install.sh detection logic.
 */
import { existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { homedir, platform } from 'os';

export interface Platform {
  id: string; // 'claude-code' | 'cursor' | 'codex' | 'gemini' | 'opencode'
  name: string; // Display name
  detect: () => boolean;
  getHooksTarget: (agentRecallRoot: string) => string; // Where hooks should be installed
  getHooksSource: (agentRecallRoot: string) => string; // Where hooks template lives
}

const HOME = homedir();

/**
 * Check if a command exists on the system PATH using `which` (unix) or `where` (windows).
 */
function commandExists(cmd: string): boolean {
  const isWindows = platform() === 'win32';
  const result = spawnSync(isWindows ? 'where' : 'which', [cmd], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

/**
 * The 5 supported platforms with their detection and hook path logic.
 */
export const PLATFORMS: Platform[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    detect: () => existsSync(join(HOME, '.claude')),
    getHooksTarget: (_agentRecallRoot: string) =>
      join(
        HOME,
        '.claude',
        'plugins',
        'marketplaces',
        'agent-recall',
        'plugin',
        'hooks',
        'hooks.json'
      ),
    getHooksSource: (agentRecallRoot: string) =>
      join(agentRecallRoot, 'plugin', 'hooks', 'hooks.json'),
  },
  {
    id: 'cursor',
    name: 'Cursor',
    detect: () => existsSync(join(HOME, '.cursor')),
    getHooksTarget: (_agentRecallRoot: string) =>
      join(HOME, '.cursor', 'hooks', 'agent-recall.json'),
    getHooksSource: (agentRecallRoot: string) =>
      join(agentRecallRoot, 'cursor-hooks', 'hooks.json'),
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    detect: () => existsSync(join(HOME, '.codex')) || commandExists('codex'),
    getHooksTarget: (_agentRecallRoot: string) =>
      join(HOME, '.codex', 'hooks.json'),
    getHooksSource: (agentRecallRoot: string) =>
      join(agentRecallRoot, 'codex-hooks', 'hooks.json'),
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    detect: () => existsSync(join(HOME, '.gemini')) || commandExists('gemini'),
    getHooksTarget: (_agentRecallRoot: string) =>
      join(HOME, '.gemini', 'hooks', 'agent-recall.json'),
    getHooksSource: (agentRecallRoot: string) =>
      join(agentRecallRoot, 'gemini-hooks', 'hooks.json'),
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    detect: () =>
      existsSync(join(HOME, '.config', 'opencode')) || commandExists('opencode'),
    getHooksTarget: (_agentRecallRoot: string) => {
      // Primary location: ~/.config/opencode/...; fallback to ~/.opencode/...
      const primary = join(HOME, '.config', 'opencode');
      const base = existsSync(primary) ? primary : join(HOME, '.opencode');
      return join(base, 'plugins', 'agent-recall', 'index.ts');
    },
    getHooksSource: (agentRecallRoot: string) =>
      join(agentRecallRoot, 'opencode-plugin', 'index.ts'),
  },
];

/**
 * Returns all platforms whose detect() function returns true.
 */
export function detectPlatforms(): Platform[] {
  return PLATFORMS.filter((p) => p.detect());
}

/**
 * Returns the platform with the given id, or undefined if not found.
 */
export function getPlatformById(id: string): Platform | undefined {
  return PLATFORMS.find((p) => p.id === id);
}
