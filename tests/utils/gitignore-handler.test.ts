/**
 * Gitignore Handler Tests
 *
 * Tests automatic .gitignore entry management for Agent Recall data directories.
 * Source: src/utils/gitignore-handler.ts
 */

import { describe, it, expect, afterEach } from 'bun:test';
import { ensureGitignoreEntries } from '../../src/utils/gitignore-handler.js';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/** Create a temp directory for each test */
function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'gitignore-handler-test-'));
}

/** Dirs created during tests, cleaned up in afterEach */
const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = createTempDir();
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs.length = 0;
});

describe('Gitignore Handler', () => {
  describe('ensureGitignoreEntries', () => {
    it('does nothing when not in a git repo', () => {
      const dir = makeTempDir();
      // No .git directory — should return silently without error
      expect(() => ensureGitignoreEntries(dir)).not.toThrow();
    });

    it('does nothing when .gitignore does not exist', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      // .git exists but no .gitignore — should return silently
      expect(() => ensureGitignoreEntries(dir)).not.toThrow();
    });

    it('adds entries when .gitignore exists but is missing them', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');

      ensureGitignoreEntries(dir);

      const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('.assistant/');
      expect(content).toContain('.agent-recall/');
      expect(content).toContain('# Agent Recall data');
      // Original content preserved
      expect(content).toContain('node_modules/');
    });

    it('does not duplicate entries when they already exist', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      const original = 'node_modules/\n.assistant/\n.agent-recall/\n';
      writeFileSync(join(dir, '.gitignore'), original, 'utf-8');

      ensureGitignoreEntries(dir);

      const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
      // Content should be unchanged
      expect(content).toBe(original);
    });

    it('handles partial presence — adds only missing entry', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n.assistant/\n', 'utf-8');

      ensureGitignoreEntries(dir);

      const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('.agent-recall/');
      expect(content).toContain('# Agent Recall data');
      // .assistant/ should appear only once (the original)
      const assistantMatches = content.match(/\.assistant\//g);
      expect(assistantMatches?.length).toBe(1);
    });

    it('handles .gitignore without trailing newline', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), 'node_modules/', 'utf-8');

      ensureGitignoreEntries(dir);

      const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('.assistant/');
      expect(content).toContain('.agent-recall/');
      // Should still be valid — entries on separate lines
      const lines = content.split('\n').map(l => l.trim()).filter(Boolean);
      expect(lines).toContain('.assistant/');
      expect(lines).toContain('.agent-recall/');
    });

    it('finds git root from a subdirectory', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');
      const subdir = join(dir, 'src', 'deep');
      mkdirSync(subdir, { recursive: true });

      ensureGitignoreEntries(subdir);

      const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('.assistant/');
      expect(content).toContain('.agent-recall/');
    });

    it('does not crash on permission errors', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\n', 'utf-8');

      // Make .gitignore read-only to trigger a write error
      chmodSync(join(dir, '.gitignore'), 0o444);

      // Should catch internally and not throw
      expect(() => ensureGitignoreEntries(dir)).not.toThrow();

      // Restore permissions for cleanup
      chmodSync(join(dir, '.gitignore'), 0o644);
    });

    it('handles empty .gitignore file', () => {
      const dir = makeTempDir();
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, '.gitignore'), '', 'utf-8');

      ensureGitignoreEntries(dir);

      const content = readFileSync(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('.assistant/');
      expect(content).toContain('.agent-recall/');
      expect(content).toContain('# Agent Recall data');
    });
  });
});
