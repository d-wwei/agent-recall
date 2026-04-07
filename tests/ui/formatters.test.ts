/**
 * Tests for viewer utility functions: formatters and formatNumber
 *
 * These are pure functions with no React dependency — ideal for unit testing.
 */
import { describe, it, expect } from 'bun:test';
import { formatDate, formatUptime, formatBytes } from '../../src/ui/viewer/utils/formatters';
import { formatStarCount } from '../../src/ui/viewer/utils/formatNumber';

describe('formatDate', () => {
  it('should convert epoch to locale string', () => {
    const epoch = 1700000000000; // 2023-11-14 in UTC
    const result = formatDate(epoch);
    // Should be a non-empty string representation of a date
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
    // Verify it contains recognizable date parts (year at minimum)
    expect(result).toContain('2023');
  });

  it('should handle zero epoch', () => {
    const result = formatDate(0);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle recent dates', () => {
    const now = Date.now();
    const result = formatDate(now);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('formatUptime', () => {
  it('should return dash when seconds is undefined', () => {
    expect(formatUptime(undefined)).toBe('-');
  });

  it('should return dash when seconds is 0', () => {
    expect(formatUptime(0)).toBe('-');
  });

  it('should format seconds into hours and minutes', () => {
    // 1 hour, 30 minutes = 5400 seconds
    expect(formatUptime(5400)).toBe('1h 30m');
  });

  it('should handle less than one hour', () => {
    // 45 minutes = 2700 seconds
    expect(formatUptime(2700)).toBe('0h 45m');
  });

  it('should handle exact hours', () => {
    // 2 hours = 7200 seconds
    expect(formatUptime(7200)).toBe('2h 0m');
  });

  it('should handle large uptimes', () => {
    // 48 hours, 15 minutes = 173700 seconds
    expect(formatUptime(173700)).toBe('48h 15m');
  });

  it('should truncate seconds (no rounding up)', () => {
    // 1 hour, 59 minutes, 59 seconds = 7199 seconds
    expect(formatUptime(7199)).toBe('1h 59m');
  });
});

describe('formatBytes', () => {
  it('should return dash when bytes is undefined', () => {
    expect(formatBytes(undefined)).toBe('-');
  });

  it('should return dash when bytes is 0', () => {
    expect(formatBytes(0)).toBe('-');
  });

  it('should format bytes (under 1KB)', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(2048)).toBe('2.0 KB');
  });

  it('should format fractional kilobytes', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.0 MB');
  });

  it('should format fractional megabytes', () => {
    expect(formatBytes(1572864)).toBe('1.5 MB');
  });

  it('should handle the boundary between B and KB', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
  });

  it('should handle the boundary between KB and MB', () => {
    const justUnderMB = 1024 * 1024 - 1;
    const result = formatBytes(justUnderMB);
    expect(result).toContain('KB');

    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
});

describe('formatStarCount', () => {
  it('should return exact number for counts under 1000', () => {
    expect(formatStarCount(0)).toBe('0');
    expect(formatStarCount(1)).toBe('1');
    expect(formatStarCount(999)).toBe('999');
  });

  it('should format thousands with k suffix', () => {
    expect(formatStarCount(1000)).toBe('1.0k');
    expect(formatStarCount(1234)).toBe('1.2k');
    expect(formatStarCount(45678)).toBe('45.7k');
    expect(formatStarCount(999999)).toBe('1000.0k');
  });

  it('should format millions with M suffix', () => {
    expect(formatStarCount(1000000)).toBe('1.0M');
    expect(formatStarCount(1234567)).toBe('1.2M');
  });

  it('should handle edge case at boundary', () => {
    // Just under 1000 shows as plain number
    expect(formatStarCount(999)).toBe('999');
    // At 1000 shows k format
    expect(formatStarCount(1000)).toBe('1.0k');
  });
});
