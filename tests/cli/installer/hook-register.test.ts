/**
 * Tests for hook registration module
 *
 * Source: src/cli/installer/lib/hook-register.ts
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real temp directories (mkdtempSync) for all filesystem operations
 * - No mocking of fs, path, or any module
 *
 * Value: Validates that hooks are correctly registered (copied with
 * $AGENT_RECALL_ROOT substitution), checked, and removed.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  registerHooks,
  isHooksRegistered,
  removeHooks,
} from '../../../src/cli/installer/lib/hook-register.ts';

// ─── Test Setup ──────────────────────────────────────────────────────────────

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'agent-recall-hook-register-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ─── registerHooks ───────────────────────────────────────────────────────────

describe('registerHooks', () => {
  it('copies source file to target, substituting $AGENT_RECALL_ROOT with actual root path', () => {
    const agentRecallRoot = '/usr/local/lib/agent-recall';
    const sourcePath = join(tmpDir, 'source-hook.sh');
    const targetPath = join(tmpDir, 'target', 'hook.sh');

    // Source contains the placeholder
    writeFileSync(sourcePath, '#!/bin/bash\nexec node "$AGENT_RECALL_ROOT/plugin/scripts/hook.js"');

    registerHooks(agentRecallRoot, sourcePath, targetPath);

    expect(existsSync(targetPath)).toBe(true);
    const content = readFileSync(targetPath, 'utf-8');
    expect(content).toContain('/usr/local/lib/agent-recall/plugin/scripts/hook.js');
    expect(content).not.toContain('$AGENT_RECALL_ROOT');
  });

  it('substitutes all occurrences of $AGENT_RECALL_ROOT (multiple in one file)', () => {
    const agentRecallRoot = '/opt/agent-recall';
    const sourcePath = join(tmpDir, 'multi-hook.sh');
    const targetPath = join(tmpDir, 'output', 'multi-hook.sh');

    writeFileSync(
      sourcePath,
      '#!/bin/bash\n' +
        'export ROOT="$AGENT_RECALL_ROOT"\n' +
        'exec node "$AGENT_RECALL_ROOT/index.js"\n' +
        'log "$AGENT_RECALL_ROOT/logs/hook.log"\n'
    );

    registerHooks(agentRecallRoot, sourcePath, targetPath);

    const content = readFileSync(targetPath, 'utf-8');
    expect(content).not.toContain('$AGENT_RECALL_ROOT');
    const matches = content.match(/\/opt\/agent-recall/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(3);
  });

  it('creates parent directories if missing', () => {
    const agentRecallRoot = '/home/user/agent-recall';
    const sourcePath = join(tmpDir, 'hook.sh');
    // Deep nested path that does not exist
    const targetPath = join(tmpDir, 'deep', 'nested', 'dir', 'hook.sh');

    writeFileSync(sourcePath, '#!/bin/bash\necho "$AGENT_RECALL_ROOT"');

    // Parent dirs should not exist yet
    expect(existsSync(join(tmpDir, 'deep'))).toBe(false);

    registerHooks(agentRecallRoot, sourcePath, targetPath);

    expect(existsSync(targetPath)).toBe(true);
  });

  it('throws if source file does not exist', () => {
    const agentRecallRoot = '/opt/agent-recall';
    const sourcePath = join(tmpDir, 'nonexistent-hook.sh');
    const targetPath = join(tmpDir, 'output', 'hook.sh');

    expect(() => registerHooks(agentRecallRoot, sourcePath, targetPath)).toThrow();
  });
});

// ─── isHooksRegistered ───────────────────────────────────────────────────────

describe('isHooksRegistered', () => {
  it('returns false for missing file', () => {
    const targetPath = join(tmpDir, 'nonexistent', 'hook.sh');
    expect(isHooksRegistered(targetPath)).toBe(false);
  });

  it('returns true for existing file', () => {
    const targetPath = join(tmpDir, 'hook.sh');
    writeFileSync(targetPath, '#!/bin/bash\necho hello');
    expect(isHooksRegistered(targetPath)).toBe(true);
  });
});

// ─── removeHooks ─────────────────────────────────────────────────────────────

describe('removeHooks', () => {
  it('deletes the target file if it exists', () => {
    const targetPath = join(tmpDir, 'hook-to-delete.sh');
    writeFileSync(targetPath, '#!/bin/bash\necho hello');
    expect(existsSync(targetPath)).toBe(true);

    removeHooks(targetPath);

    expect(existsSync(targetPath)).toBe(false);
  });

  it('is a no-op if file does not exist', () => {
    const targetPath = join(tmpDir, 'nonexistent-hook.sh');
    expect(existsSync(targetPath)).toBe(false);

    // Should not throw
    expect(() => removeHooks(targetPath)).not.toThrow();
  });
});
