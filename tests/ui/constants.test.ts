/**
 * Tests for viewer UI constants
 *
 * Validates that all constant values are consistent and haven't drifted.
 * These are the foundation values used across hooks and components.
 */
import { describe, it, expect } from 'bun:test';
import { UI } from '../../src/ui/viewer/constants/ui';
import { API_ENDPOINTS } from '../../src/ui/viewer/constants/api';
import { TIMING } from '../../src/ui/viewer/constants/timing';
import { DEFAULT_SETTINGS } from '../../src/ui/viewer/constants/settings';

describe('UI constants', () => {
  it('should define PAGINATION_PAGE_SIZE', () => {
    expect(UI.PAGINATION_PAGE_SIZE).toBe(50);
    expect(typeof UI.PAGINATION_PAGE_SIZE).toBe('number');
  });

  it('should define LOAD_MORE_THRESHOLD between 0 and 1', () => {
    expect(UI.LOAD_MORE_THRESHOLD).toBeGreaterThan(0);
    expect(UI.LOAD_MORE_THRESHOLD).toBeLessThanOrEqual(1);
    expect(UI.LOAD_MORE_THRESHOLD).toBe(0.1);
  });
});

describe('API_ENDPOINTS constants', () => {
  it('should define all required endpoints', () => {
    expect(API_ENDPOINTS.OBSERVATIONS).toBe('/api/observations');
    expect(API_ENDPOINTS.SUMMARIES).toBe('/api/summaries');
    expect(API_ENDPOINTS.PROMPTS).toBe('/api/prompts');
    expect(API_ENDPOINTS.SETTINGS).toBe('/api/settings');
    expect(API_ENDPOINTS.STATS).toBe('/api/stats');
    expect(API_ENDPOINTS.PROCESSING_STATUS).toBe('/api/processing-status');
    expect(API_ENDPOINTS.STREAM).toBe('/stream');
  });

  it('should have all API endpoints start with /api/ except stream', () => {
    const apiEndpoints = Object.entries(API_ENDPOINTS).filter(([key]) => key !== 'STREAM');
    for (const [key, value] of apiEndpoints) {
      expect(value).toMatch(/^\/api\//);
    }
  });

  it('should have stream endpoint without /api/ prefix', () => {
    expect(API_ENDPOINTS.STREAM).toBe('/stream');
    expect(API_ENDPOINTS.STREAM).not.toMatch(/^\/api\//);
  });
});

describe('TIMING constants', () => {
  it('should have SSE reconnect delay of 3 seconds', () => {
    expect(TIMING.SSE_RECONNECT_DELAY_MS).toBe(3000);
  });

  it('should have stats refresh interval of 10 seconds', () => {
    expect(TIMING.STATS_REFRESH_INTERVAL_MS).toBe(10000);
  });

  it('should have save status display duration of 3 seconds', () => {
    expect(TIMING.SAVE_STATUS_DISPLAY_DURATION_MS).toBe(3000);
  });

  it('should have all timing values as positive numbers', () => {
    for (const [key, value] of Object.entries(TIMING)) {
      expect(value).toBeGreaterThan(0);
      expect(typeof value).toBe('number');
    }
  });
});

describe('DEFAULT_SETTINGS - completeness', () => {
  const requiredKeys = [
    'CLAUDE_MEM_MODEL',
    'CLAUDE_MEM_CONTEXT_OBSERVATIONS',
    'CLAUDE_MEM_WORKER_PORT',
    'CLAUDE_MEM_WORKER_HOST',
    'CLAUDE_MEM_PROVIDER',
    'CLAUDE_MEM_GEMINI_API_KEY',
    'CLAUDE_MEM_GEMINI_MODEL',
    'CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED',
    'CLAUDE_MEM_OPENROUTER_API_KEY',
    'CLAUDE_MEM_OPENROUTER_MODEL',
    'CLAUDE_MEM_OPENROUTER_SITE_URL',
    'CLAUDE_MEM_OPENROUTER_APP_NAME',
    'CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS',
    'CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS',
    'CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT',
    'CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT',
    'CLAUDE_MEM_CONTEXT_FULL_COUNT',
    'CLAUDE_MEM_CONTEXT_FULL_FIELD',
    'CLAUDE_MEM_CONTEXT_SESSION_COUNT',
    'CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY',
    'CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE',
  ];

  it('should have all required settings keys', () => {
    for (const key of requiredKeys) {
      expect(DEFAULT_SETTINGS).toHaveProperty(key);
    }
  });

  it('should have all settings values as strings', () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      expect(typeof value).toBe('string');
    }
  });

  it('should have boolean settings as "true" or "false" strings', () => {
    const booleanKeys = [
      'CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED',
      'CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS',
      'CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS',
      'CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT',
      'CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT',
      'CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY',
      'CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE',
    ] as const;

    for (const key of booleanKeys) {
      const value = (DEFAULT_SETTINGS as Record<string, string>)[key];
      expect(['true', 'false']).toContain(value);
    }
  });

  it('should have numeric settings as parseable number strings', () => {
    const numericKeys = [
      'CLAUDE_MEM_CONTEXT_OBSERVATIONS',
      'CLAUDE_MEM_WORKER_PORT',
      'CLAUDE_MEM_CONTEXT_FULL_COUNT',
      'CLAUDE_MEM_CONTEXT_SESSION_COUNT',
    ] as const;

    for (const key of numericKeys) {
      const value = (DEFAULT_SETTINGS as Record<string, string>)[key];
      const parsed = parseInt(value, 10);
      expect(isNaN(parsed)).toBe(false);
    }
  });

  it('should have worker port in valid range', () => {
    const port = parseInt(DEFAULT_SETTINGS.CLAUDE_MEM_WORKER_PORT, 10);
    expect(port).toBeGreaterThanOrEqual(1024);
    expect(port).toBeLessThanOrEqual(65535);
  });
});
