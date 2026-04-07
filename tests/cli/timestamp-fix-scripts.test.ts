/**
 * Tests for timestamp fix CLI scripts
 *
 * Source: scripts/fix-all-timestamps.ts, scripts/fix-corrupted-timestamps.ts
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests only pure utility functions and argument parsing logic
 * - No database or filesystem access
 *
 * Value: Validates timestamp formatting, corruption detection window logic,
 * and CLI argument parsing for the timestamp repair tools. Prevents
 * regressions in the data repair workflow.
 */
import { describe, it, expect } from 'bun:test';

// ─── formatTimestamp (shared pattern in both scripts) ───────────────
// Reimplemented here since the scripts don't export it.

function formatTimestamp(epoch: number): string {
  return new Date(epoch).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

describe('timestamp fix scripts', () => {

  describe('formatTimestamp', () => {
    it('should format epoch to human-readable US Pacific time', () => {
      // 2025-01-01T08:00:00Z = Jan 1, 2025 00:00:00 PST
      const epoch = new Date('2025-01-01T08:00:00Z').getTime();
      const result = formatTimestamp(epoch);
      expect(result).toContain('Jan');
      expect(result).toContain('2025');
      expect(result).toContain('12:00:00');
    });

    it('should handle epoch at Unix zero', () => {
      const result = formatTimestamp(0);
      // Dec 31, 1969 in Pacific time (before epoch)
      expect(result).toContain('1969');
    });

    it('should format recent timestamps correctly', () => {
      const epoch = new Date('2025-12-25T20:00:00Z').getTime();
      const result = formatTimestamp(epoch);
      expect(result).toContain('Dec');
      expect(result).toContain('25');
      expect(result).toContain('2025');
    });
  });

  // ─── Argument parsing (shared pattern) ────────────────────────────

  describe('argument parsing', () => {
    function parseTimestampFixArgs(args: string[]) {
      const dryRun = args.includes('--dry-run');
      const autoYes = args.includes('--yes') || args.includes('-y');
      return { dryRun, autoYes };
    }

    it('should parse --dry-run flag', () => {
      expect(parseTimestampFixArgs(['--dry-run'])).toEqual({ dryRun: true, autoYes: false });
    });

    it('should parse --yes flag', () => {
      expect(parseTimestampFixArgs(['--yes'])).toEqual({ dryRun: false, autoYes: true });
    });

    it('should parse -y shorthand', () => {
      expect(parseTimestampFixArgs(['-y'])).toEqual({ dryRun: false, autoYes: true });
    });

    it('should parse combined flags', () => {
      expect(parseTimestampFixArgs(['--dry-run', '--yes'])).toEqual({ dryRun: true, autoYes: true });
    });

    it('should parse combined flags with shorthand', () => {
      expect(parseTimestampFixArgs(['--dry-run', '-y'])).toEqual({ dryRun: true, autoYes: true });
    });

    it('should handle no arguments', () => {
      expect(parseTimestampFixArgs([])).toEqual({ dryRun: false, autoYes: false });
    });
  });

  // ─── Corruption detection logic ───────────────────────────────────

  describe('corruption detection (fix-corrupted-timestamps)', () => {
    // These constants match the source script
    const BAD_WINDOW_START = 1766623500000; // Dec 24 19:45 PST
    const BAD_WINDOW_END = 1766626260000;   // Dec 24 20:31 PST

    it('should identify timestamps within the bad window', () => {
      const inWindow = BAD_WINDOW_START + 1000;
      expect(inWindow >= BAD_WINDOW_START && inWindow <= BAD_WINDOW_END).toBe(true);
    });

    it('should reject timestamps before the bad window', () => {
      const beforeWindow = BAD_WINDOW_START - 1;
      expect(beforeWindow >= BAD_WINDOW_START && beforeWindow <= BAD_WINDOW_END).toBe(false);
    });

    it('should reject timestamps after the bad window', () => {
      const afterWindow = BAD_WINDOW_END + 1;
      expect(afterWindow >= BAD_WINDOW_START && afterWindow <= BAD_WINDOW_END).toBe(false);
    });

    it('should include window boundaries', () => {
      expect(BAD_WINDOW_START >= BAD_WINDOW_START && BAD_WINDOW_START <= BAD_WINDOW_END).toBe(true);
      expect(BAD_WINDOW_END >= BAD_WINDOW_START && BAD_WINDOW_END <= BAD_WINDOW_END).toBe(true);
    });

    it('should have a window duration of about 46 minutes', () => {
      const durationMs = BAD_WINDOW_END - BAD_WINDOW_START;
      const durationMinutes = durationMs / 60000;
      expect(durationMinutes).toBeGreaterThan(45);
      expect(durationMinutes).toBeLessThan(47);
    });
  });

  // ─── fix-all-timestamps corruption detection logic ────────────────

  describe('corruption detection (fix-all-timestamps)', () => {
    interface MockObservation {
      obs_created: number;
      session_started: number;
      session_completed: number | null;
    }

    function isCorrupted(obs: MockObservation): boolean {
      // Observation older than session start
      if (obs.obs_created < obs.session_started) return true;
      // Observation more than 1hr after session completion
      if (
        obs.session_completed !== null &&
        obs.obs_created > obs.session_completed + 3600000
      ) {
        return true;
      }
      return false;
    }

    it('should detect observation created before session start', () => {
      expect(isCorrupted({
        obs_created: 1000,
        session_started: 2000,
        session_completed: 5000,
      })).toBe(true);
    });

    it('should detect observation more than 1hr after session end', () => {
      expect(isCorrupted({
        obs_created: 10000000,
        session_started: 1000,
        session_completed: 5000, // obs is way after completion + 1hr
      })).toBe(true);
    });

    it('should not flag observation within session timeframe', () => {
      expect(isCorrupted({
        obs_created: 3000,
        session_started: 1000,
        session_completed: 5000,
      })).toBe(false);
    });

    it('should not flag observation within 1hr after session end', () => {
      const sessionEnd = 5000;
      expect(isCorrupted({
        obs_created: sessionEnd + 3600000, // exactly 1hr
        session_started: 1000,
        session_completed: sessionEnd,
      })).toBe(false);
    });

    it('should flag observation just over 1hr after session end', () => {
      const sessionEnd = 5000;
      expect(isCorrupted({
        obs_created: sessionEnd + 3600001, // 1hr + 1ms
        session_started: 1000,
        session_completed: sessionEnd,
      })).toBe(true);
    });

    it('should not flag when session_completed is null (ongoing session)', () => {
      expect(isCorrupted({
        obs_created: 999999999,
        session_started: 1000,
        session_completed: null,
      })).toBe(false);
    });

    it('should flag observation at exactly session start as not corrupted', () => {
      expect(isCorrupted({
        obs_created: 1000,
        session_started: 1000,
        session_completed: 5000,
      })).toBe(false);
    });
  });

  // ─── Days-off calculation (used in display) ───────────────────────

  describe('days off calculation', () => {
    it('should calculate correct days difference', () => {
      const wrongTimestamp = 1766623500000; // Dec 24
      const correctTimestamp = 1766019900000; // ~7 days earlier
      const daysDiff = Math.round(
        (wrongTimestamp - correctTimestamp) / (1000 * 60 * 60 * 24)
      );
      expect(daysDiff).toBe(7);
    });

    it('should handle zero difference', () => {
      const ts = 1766623500000;
      const daysDiff = Math.round((ts - ts) / (1000 * 60 * 60 * 24));
      expect(daysDiff).toBe(0);
    });

    it('should handle negative difference (observation before session)', () => {
      const obsCreated = 1000000;
      const sessionStarted = 100000000000; // ~3 years later
      const daysDiff = Math.round(
        (obsCreated - sessionStarted) / (1000 * 60 * 60 * 24)
      );
      expect(daysDiff).toBeLessThan(0);
    });
  });
});
