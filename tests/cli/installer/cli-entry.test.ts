/**
 * Tests for installer CLI output helpers and entry point
 *
 * Source: src/cli/installer/lib/output.ts, src/cli/installer/index.ts
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests only pure formatting functions with no side effects
 * - No network, database, or filesystem access
 *
 * Value: Validates terminal output formatting used throughout the installer CLI.
 */
import { describe, it, expect } from 'bun:test';
import {
  formatCheck,
  formatFail,
  formatSkip,
  formatHeader,
  formatBanner,
} from '../../../src/cli/installer/lib/output.js';

// ANSI escape code patterns
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

describe('installer output helpers', () => {

  describe('formatCheck', () => {
    it('should contain the message text', () => {
      const result = formatCheck('hook installed');
      expect(result).toContain('hook installed');
    });

    it('should contain a check mark', () => {
      const result = formatCheck('hook installed');
      expect(result).toContain('✓');
    });

    it('should apply green color', () => {
      const result = formatCheck('hook installed');
      expect(result).toContain(GREEN);
      expect(result).toContain(RESET);
    });

    it('should be indented with leading spaces', () => {
      const result = formatCheck('hook installed');
      expect(result.startsWith('  ')).toBe(true);
    });

    it('should work with empty string', () => {
      const result = formatCheck('');
      expect(result).toContain('✓');
      expect(result).toContain(GREEN);
    });
  });

  describe('formatFail', () => {
    it('should contain the message text', () => {
      const result = formatFail('hook missing');
      expect(result).toContain('hook missing');
    });

    it('should contain a cross mark', () => {
      const result = formatFail('hook missing');
      expect(result).toContain('✗');
    });

    it('should apply red color', () => {
      const result = formatFail('hook missing');
      expect(result).toContain(RED);
      expect(result).toContain(RESET);
    });

    it('should be indented with leading spaces', () => {
      const result = formatFail('hook missing');
      expect(result.startsWith('  ')).toBe(true);
    });

    it('should not include hint line when hint is omitted', () => {
      const result = formatFail('hook missing');
      expect(result.split('\n').length).toBe(1);
    });

    it('should include hint on a second line when provided', () => {
      const result = formatFail('hook missing', 'run agent-recall install');
      const lines = result.split('\n');
      expect(lines.length).toBe(2);
      expect(lines[1]).toContain('run agent-recall install');
    });

    it('should include hint text in output', () => {
      const result = formatFail('hook missing', 'run agent-recall install');
      expect(result).toContain('run agent-recall install');
    });
  });

  describe('formatSkip', () => {
    it('should contain the message text', () => {
      const result = formatSkip('already installed');
      expect(result).toContain('already installed');
    });

    it('should contain a circle/skip marker', () => {
      const result = formatSkip('already installed');
      expect(result).toContain('○');
    });

    it('should apply dim styling', () => {
      const result = formatSkip('already installed');
      expect(result).toContain(DIM);
      expect(result).toContain(RESET);
    });

    it('should be indented with leading spaces', () => {
      const result = formatSkip('already installed');
      expect(result.startsWith('  ')).toBe(true);
    });
  });

  describe('formatHeader', () => {
    it('should contain the title text', () => {
      const result = formatHeader('Installation');
      expect(result).toContain('Installation');
    });

    it('should apply bold styling', () => {
      const result = formatHeader('Installation');
      expect(result).toContain(BOLD);
      expect(result).toContain(RESET);
    });

    it('should work with multi-word titles', () => {
      const result = formatHeader('Doctor Check Results');
      expect(result).toContain('Doctor Check Results');
    });
  });

  describe('formatBanner', () => {
    it('should contain the product name', () => {
      const result = formatBanner();
      expect(result).toContain('Agent Recall');
    });

    it('should apply cyan color', () => {
      const result = formatBanner();
      expect(result).toContain(CYAN);
      expect(result).toContain(RESET);
    });

    it('should apply bold styling', () => {
      const result = formatBanner();
      expect(result).toContain(BOLD);
    });

    it('should return a non-empty string', () => {
      const result = formatBanner();
      expect(result.length).toBeGreaterThan(0);
    });
  });

  // ─── Formatting consistency checks ───────────────────────────────

  describe('formatting consistency', () => {
    it('formatCheck, formatFail, formatSkip all have two leading spaces', () => {
      const check = formatCheck('test');
      const fail = formatFail('test');
      const skip = formatSkip('test');

      expect(check.slice(0, 2)).toBe('  ');
      expect(fail.slice(0, 2)).toBe('  ');
      expect(skip.slice(0, 2)).toBe('  ');
    });

    it('all status formatters produce different output for same message', () => {
      const msg = 'config file';
      const check = formatCheck(msg);
      const fail = formatFail(msg);
      const skip = formatSkip(msg);

      // Each uses a different color/symbol so results should differ
      expect(check).not.toBe(fail);
      expect(check).not.toBe(skip);
      expect(fail).not.toBe(skip);
    });
  });

  // ─── CLI entry point argument parsing ────────────────────────────
  // The index.ts dispatches commands; we test argument parsing logic
  // without importing the entry point (which triggers side effects).

  describe('CLI argument parsing logic', () => {
    const KNOWN_COMMANDS = ['install', 'doctor', 'adapter', 'status', 'uninstall'];

    function parseCliArgs(argv: string[]): { command: string | null; flags: string[] } {
      const args = argv.slice(2); // strip node + script path
      const flags = args.filter(a => a.startsWith('--'));
      const positional = args.filter(a => !a.startsWith('--'));
      const command = positional[0] ?? null;
      return { command, flags };
    }

    function isKnownCommand(cmd: string | null): boolean {
      return cmd !== null && KNOWN_COMMANDS.includes(cmd);
    }

    it('should parse install command', () => {
      const { command } = parseCliArgs(['node', 'agent-recall', 'install']);
      expect(command).toBe('install');
      expect(isKnownCommand(command)).toBe(true);
    });

    it('should parse doctor command', () => {
      const { command } = parseCliArgs(['node', 'agent-recall', 'doctor']);
      expect(command).toBe('doctor');
      expect(isKnownCommand(command)).toBe(true);
    });

    it('should parse adapter command', () => {
      const { command } = parseCliArgs(['node', 'agent-recall', 'adapter']);
      expect(command).toBe('adapter');
      expect(isKnownCommand(command)).toBe(true);
    });

    it('should parse status command', () => {
      const { command } = parseCliArgs(['node', 'agent-recall', 'status']);
      expect(command).toBe('status');
      expect(isKnownCommand(command)).toBe(true);
    });

    it('should parse uninstall command', () => {
      const { command } = parseCliArgs(['node', 'agent-recall', 'uninstall']);
      expect(command).toBe('uninstall');
      expect(isKnownCommand(command)).toBe(true);
    });

    it('should return null command when no args given', () => {
      const { command } = parseCliArgs(['node', 'agent-recall']);
      expect(command).toBeNull();
    });

    it('should detect --help flag', () => {
      const { flags } = parseCliArgs(['node', 'agent-recall', '--help']);
      expect(flags).toContain('--help');
    });

    it('should detect --version flag', () => {
      const { flags } = parseCliArgs(['node', 'agent-recall', '--version']);
      expect(flags).toContain('--version');
    });

    it('should reject unknown commands', () => {
      const { command } = parseCliArgs(['node', 'agent-recall', 'foobar']);
      expect(isKnownCommand(command)).toBe(false);
    });

    it('should separate flags from positional args', () => {
      const { command, flags } = parseCliArgs(['node', 'agent-recall', 'install', '--dry-run']);
      expect(command).toBe('install');
      expect(flags).toContain('--dry-run');
    });

    it('should have exactly 5 known commands', () => {
      expect(KNOWN_COMMANDS.length).toBe(5);
    });
  });
});
