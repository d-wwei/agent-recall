/**
 * Tests for the install command utility functions
 *
 * Source: src/cli/installer/commands/install.ts
 *
 * Scope: unit tests for the two exported utility functions only.
 * The full run() flow is an integration concern (Task 10).
 *
 * Mock Justification: NONE
 * - resolveInstallRoot() is pure string manipulation — no I/O
 * - ensureBun() probes the real bun binary; on this dev machine bun is
 *   installed, so we assert ok=true as a sanity baseline (mirrors the
 *   pattern used in runtime-check.test.ts for checkBunAvailable)
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveInstallRoot,
  ensureBun,
} from '../../../src/cli/installer/commands/install.ts';

// ---------------------------------------------------------------------------
// resolveInstallRoot
// ---------------------------------------------------------------------------

describe('resolveInstallRoot', () => {
  it('npm mode (fromSource=false) returns a path containing ".agent-recall"', () => {
    const root = resolveInstallRoot(false);
    expect(root).toContain('.agent-recall');
  });

  it('npm mode (fromSource=false) does NOT contain "source"', () => {
    const root = resolveInstallRoot(false);
    expect(root).not.toContain('source');
  });

  it('from-source mode (fromSource=true) contains "source"', () => {
    const root = resolveInstallRoot(true);
    expect(root).toContain('source');
  });

  it('from-source mode (fromSource=true) still contains ".agent-recall"', () => {
    const root = resolveInstallRoot(true);
    expect(root).toContain('.agent-recall');
  });

  it('npm mode returns an absolute path', () => {
    const root = resolveInstallRoot(false);
    expect(root.startsWith('/')).toBe(true);
  });

  it('from-source mode returns an absolute path', () => {
    const root = resolveInstallRoot(true);
    expect(root.startsWith('/')).toBe(true);
  });

  it('from-source path is a subdirectory of npm path', () => {
    const npmRoot = resolveInstallRoot(false);
    const sourceRoot = resolveInstallRoot(true);
    expect(sourceRoot.startsWith(npmRoot)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureBun
// ---------------------------------------------------------------------------

describe('ensureBun', () => {
  it('returns a boolean', () => {
    const result = ensureBun();
    expect(typeof result).toBe('boolean');
  });

  it('returns true when Bun is available (dev machine requirement)', () => {
    // Bun is the project test runner, so it must be available here.
    const result = ensureBun();
    expect(result).toBe(true);
  });
});
