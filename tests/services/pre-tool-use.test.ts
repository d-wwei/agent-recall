/**
 * Tests for PreToolUse hook — extractSearchTerm function.
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests pure function extractSearchTerm with various tool inputs
 * - No network calls or database access
 */

import { describe, it, expect } from 'bun:test';
import { extractSearchTerm } from '../../src/cli/handlers/pre-tool-use.js';

describe('extractSearchTerm', () => {
  // ─── Read tool ────────────────────────────────────────────────────────

  describe('Read tool', () => {
    it('extracts filename from file_path', () => {
      expect(extractSearchTerm('Read', { file_path: '/src/services/FusionRanker.ts' }))
        .toBe('FusionRanker.ts');
    });

    it('handles deeply nested paths', () => {
      expect(extractSearchTerm('Read', { file_path: '/a/b/c/d/config.json' }))
        .toBe('config.json');
    });

    it('returns null when file_path is missing', () => {
      expect(extractSearchTerm('Read', {})).toBeNull();
    });

    it('returns null when file_path is empty string', () => {
      expect(extractSearchTerm('Read', { file_path: '' })).toBeNull();
    });

    it('returns null when input is null', () => {
      expect(extractSearchTerm('Read', null)).toBeNull();
    });
  });

  // ─── Grep tool ────────────────────────────────────────────────────────

  describe('Grep tool', () => {
    it('extracts pattern directly', () => {
      expect(extractSearchTerm('Grep', { pattern: 'getWorkerPort' }))
        .toBe('getWorkerPort');
    });

    it('handles regex patterns', () => {
      expect(extractSearchTerm('Grep', { pattern: 'import.*sqlite' }))
        .toBe('import.*sqlite');
    });

    it('returns null when pattern is missing', () => {
      expect(extractSearchTerm('Grep', {})).toBeNull();
    });
  });

  // ─── Glob tool ────────────────────────────────────────────────────────

  describe('Glob tool', () => {
    it('extracts pattern directly', () => {
      expect(extractSearchTerm('Glob', { pattern: '**/*.test.ts' }))
        .toBe('**/*.test.ts');
    });

    it('returns null when pattern is missing', () => {
      expect(extractSearchTerm('Glob', {})).toBeNull();
    });
  });

  // ─── Bash tool ────────────────────────────────────────────────────────

  describe('Bash tool', () => {
    it('extracts last token from grep command', () => {
      expect(extractSearchTerm('Bash', { command: 'grep -r "pattern" src/' }))
        .toBe('src/');
    });

    it('extracts last token from find command', () => {
      expect(extractSearchTerm('Bash', { command: 'find . -name "*.ts"' }))
        .toBe('"*.ts"');
    });

    it('extracts last token from cat command', () => {
      expect(extractSearchTerm('Bash', { command: 'cat /etc/config.json' }))
        .toBe('/etc/config.json');
    });

    it('extracts last token from head command', () => {
      expect(extractSearchTerm('Bash', { command: 'head -20 README.md' }))
        .toBe('README.md');
    });

    it('extracts last token from tail command', () => {
      expect(extractSearchTerm('Bash', { command: 'tail -f app.log' }))
        .toBe('app.log');
    });

    it('returns null for non-file-reading commands', () => {
      expect(extractSearchTerm('Bash', { command: 'npm install express' })).toBeNull();
      expect(extractSearchTerm('Bash', { command: 'git status' })).toBeNull();
      expect(extractSearchTerm('Bash', { command: 'ls -la' })).toBeNull();
    });

    it('returns null when command is missing', () => {
      expect(extractSearchTerm('Bash', {})).toBeNull();
    });

    it('returns null when command is not a string', () => {
      expect(extractSearchTerm('Bash', { command: 42 })).toBeNull();
    });

    it('handles leading whitespace in command', () => {
      expect(extractSearchTerm('Bash', { command: '  grep pattern file.txt' }))
        .toBe('file.txt');
    });
  });

  // ─── Other tools ──────────────────────────────────────────────────────

  describe('Other tools', () => {
    it('returns null for non-file-search tools', () => {
      expect(extractSearchTerm('Write', { file_path: '/foo' })).toBeNull();
      expect(extractSearchTerm('Edit', { file_path: '/foo' })).toBeNull();
      expect(extractSearchTerm('WebSearch', { query: 'test' })).toBeNull();
    });

    it('returns null for undefined input', () => {
      expect(extractSearchTerm('Read', undefined)).toBeNull();
    });
  });
});
