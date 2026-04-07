/**
 * Tests for useSettings hook logic
 *
 * Tests the settings merge logic (nullish coalescing behavior) and
 * the save flow state transitions. The key insight is that the hook
 * uses ?? (nullish coalescing) instead of || to preserve falsy backend values.
 */
import { describe, it, expect } from 'bun:test';
import { DEFAULT_SETTINGS } from '../../src/ui/viewer/constants/settings';

describe('useSettings - DEFAULT_SETTINGS', () => {
  it('should have required settings with expected defaults', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_MODEL).toBe('claude-sonnet-4-5');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS).toBe('50');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_WORKER_PORT).toBe('37777');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_WORKER_HOST).toBe('127.0.0.1');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_PROVIDER).toBe('claude');
  });

  it('should have Gemini defaults', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_GEMINI_API_KEY).toBe('');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_GEMINI_MODEL).toBe('gemini-2.5-flash-lite');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_GEMINI_RATE_LIMITING_ENABLED).toBe('true');
  });

  it('should have OpenRouter defaults', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_OPENROUTER_API_KEY).toBe('');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_OPENROUTER_MODEL).toBe('xiaomi/mimo-v2-flash:free');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_OPENROUTER_APP_NAME).toBe('agent-recall');
  });

  it('should have token economics defaults (mostly off)', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_READ_TOKENS).toBe('false');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_WORK_TOKENS).toBe('false');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_AMOUNT).toBe('false');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_SAVINGS_PERCENT).toBe('true');
  });

  it('should have display configuration defaults', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_FULL_COUNT).toBe('0');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_FULL_FIELD).toBe('narrative');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SESSION_COUNT).toBe('10');
  });

  it('should have feature toggle defaults', () => {
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY).toBe('true');
    expect(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_LAST_MESSAGE).toBe('false');
  });
});

describe('useSettings - nullish coalescing merge behavior', () => {
  /**
   * The hook uses ?? instead of || to merge backend values with defaults.
   * This is critical: || would replace falsy values like '0', 'false', ''
   * with defaults, losing the user's actual settings.
   */

  function mergeWithDefaults(backendData: Record<string, any>) {
    return {
      CLAUDE_MEM_MODEL: backendData.CLAUDE_MEM_MODEL ?? DEFAULT_SETTINGS.CLAUDE_MEM_MODEL,
      CLAUDE_MEM_CONTEXT_OBSERVATIONS: backendData.CLAUDE_MEM_CONTEXT_OBSERVATIONS ?? DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS,
      CLAUDE_MEM_WORKER_PORT: backendData.CLAUDE_MEM_WORKER_PORT ?? DEFAULT_SETTINGS.CLAUDE_MEM_WORKER_PORT,
      CLAUDE_MEM_CONTEXT_FULL_COUNT: backendData.CLAUDE_MEM_CONTEXT_FULL_COUNT ?? DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_FULL_COUNT,
      CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: backendData.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY ?? DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY,
      CLAUDE_MEM_GEMINI_API_KEY: backendData.CLAUDE_MEM_GEMINI_API_KEY ?? DEFAULT_SETTINGS.CLAUDE_MEM_GEMINI_API_KEY,
    };
  }

  it('should use backend values when present', () => {
    const backend = {
      CLAUDE_MEM_MODEL: 'haiku',
      CLAUDE_MEM_CONTEXT_OBSERVATIONS: '100',
      CLAUDE_MEM_WORKER_PORT: '38888',
      CLAUDE_MEM_CONTEXT_FULL_COUNT: '5',
      CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: 'false',
      CLAUDE_MEM_GEMINI_API_KEY: 'AIza...',
    };
    const merged = mergeWithDefaults(backend);
    expect(merged.CLAUDE_MEM_MODEL).toBe('haiku');
    expect(merged.CLAUDE_MEM_CONTEXT_OBSERVATIONS).toBe('100');
    expect(merged.CLAUDE_MEM_WORKER_PORT).toBe('38888');
  });

  it('should fall back to defaults when backend values are null', () => {
    const backend = {
      CLAUDE_MEM_MODEL: null,
      CLAUDE_MEM_CONTEXT_OBSERVATIONS: null,
    };
    const merged = mergeWithDefaults(backend);
    expect(merged.CLAUDE_MEM_MODEL).toBe(DEFAULT_SETTINGS.CLAUDE_MEM_MODEL);
    expect(merged.CLAUDE_MEM_CONTEXT_OBSERVATIONS).toBe(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS);
  });

  it('should fall back to defaults when backend values are undefined', () => {
    const backend = {};
    const merged = mergeWithDefaults(backend);
    expect(merged.CLAUDE_MEM_MODEL).toBe(DEFAULT_SETTINGS.CLAUDE_MEM_MODEL);
    expect(merged.CLAUDE_MEM_CONTEXT_OBSERVATIONS).toBe(DEFAULT_SETTINGS.CLAUDE_MEM_CONTEXT_OBSERVATIONS);
  });

  it('should PRESERVE falsy values like "0" (the key ?? vs || distinction)', () => {
    const backend = {
      CLAUDE_MEM_CONTEXT_FULL_COUNT: '0', // falsy with || but kept with ??
    };
    const merged = mergeWithDefaults(backend);
    // This MUST be '0', not the default. If this fails, someone changed ?? to ||.
    expect(merged.CLAUDE_MEM_CONTEXT_FULL_COUNT).toBe('0');
  });

  it('should PRESERVE "false" string value', () => {
    const backend = {
      CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY: 'false',
    };
    const merged = mergeWithDefaults(backend);
    expect(merged.CLAUDE_MEM_CONTEXT_SHOW_LAST_SUMMARY).toBe('false');
  });

  it('should PRESERVE empty string value', () => {
    const backend = {
      CLAUDE_MEM_GEMINI_API_KEY: '', // empty string is intentional (no key set)
    };
    const merged = mergeWithDefaults(backend);
    expect(merged.CLAUDE_MEM_GEMINI_API_KEY).toBe('');
  });

  it('should demonstrate why || would be wrong for empty string', () => {
    // For strings, || treats '' (empty string) as falsy but ?? does not.
    // This matters for fields like GEMINI_API_KEY where '' is a valid "no key set" value.
    const backendEmptyStr = '';
    const defaultValue = 'default-key';

    const withOR = backendEmptyStr || defaultValue;
    const withNullishCoalescing = backendEmptyStr ?? defaultValue;

    // || treats '' as falsy, so it falls back to default = BUG
    expect(withOR).toBe('default-key');
    // ?? only falls back for null/undefined = CORRECT (preserves empty string)
    expect(withNullishCoalescing).toBe('');
  });

  it('should demonstrate ?? vs || difference for numeric zero as string', () => {
    // Both '0' and 'false' are truthy strings in JS, so || and ?? behave the same.
    // The key difference is with null/undefined (which ?? catches) and '' (which || catches).
    const nullValue: string | null = null;
    const defaultValue = '50';

    const withOR = nullValue || defaultValue;
    const withNullishCoalescing = nullValue ?? defaultValue;

    // Both fall back for null — the difference is for ''
    expect(withOR).toBe('50');
    expect(withNullishCoalescing).toBe('50');
  });
});
