/**
 * Tests for platform detection module
 *
 * Validates that:
 * - PLATFORMS exports exactly 5 platform definitions
 * - Each platform has required shape: id, name, detect, getHooksTarget, getHooksSource
 * - detectPlatforms() returns only detected platforms
 * - getPlatformById() returns correct platform or undefined
 */
import { describe, it, expect } from 'bun:test';
import {
  PLATFORMS,
  detectPlatforms,
  getPlatformById,
  type Platform,
} from '../../../src/cli/installer/lib/platform-detect.js';

describe('PLATFORMS constant', () => {
  it('should export exactly 5 platform definitions', () => {
    expect(PLATFORMS).toHaveLength(5);
  });

  it('should include all expected platform IDs', () => {
    const ids = PLATFORMS.map((p) => p.id);
    expect(ids).toContain('claude-code');
    expect(ids).toContain('cursor');
    expect(ids).toContain('codex');
    expect(ids).toContain('gemini');
    expect(ids).toContain('opencode');
  });

  describe('each platform shape', () => {
    it.each(PLATFORMS.map((p) => [p.id, p] as [string, Platform]))(
      '%s has required fields with correct types',
      (_id, platform) => {
        expect(typeof platform.id).toBe('string');
        expect(platform.id.length).toBeGreaterThan(0);

        expect(typeof platform.name).toBe('string');
        expect(platform.name.length).toBeGreaterThan(0);

        expect(typeof platform.detect).toBe('function');
        expect(typeof platform.getHooksTarget).toBe('function');
        expect(typeof platform.getHooksSource).toBe('function');
      }
    );

    it.each(PLATFORMS.map((p) => [p.id, p] as [string, Platform]))(
      '%s.detect() returns a boolean',
      (_id, platform) => {
        const result = platform.detect();
        expect(typeof result).toBe('boolean');
      }
    );

    it.each(PLATFORMS.map((p) => [p.id, p] as [string, Platform]))(
      '%s.getHooksTarget() returns a non-empty string path',
      (_id, platform) => {
        const target = platform.getHooksTarget('/fake/root');
        expect(typeof target).toBe('string');
        expect(target.length).toBeGreaterThan(0);
      }
    );

    it.each(PLATFORMS.map((p) => [p.id, p] as [string, Platform]))(
      '%s.getHooksSource() returns a non-empty string path',
      (_id, platform) => {
        const source = platform.getHooksSource('/fake/root');
        expect(typeof source).toBe('string');
        expect(source.length).toBeGreaterThan(0);
      }
    );
  });
});

describe('getHooksTarget paths', () => {
  it('claude-code hooks target includes ~/.claude/plugins/marketplaces/agent-recall', () => {
    const platform = getPlatformById('claude-code')!;
    const target = platform.getHooksTarget('/any/root');
    expect(target).toContain('.claude');
    expect(target).toContain('agent-recall');
    expect(target).toContain('hooks.json');
  });

  it('cursor hooks target includes ~/.cursor/hooks', () => {
    const platform = getPlatformById('cursor')!;
    const target = platform.getHooksTarget('/any/root');
    expect(target).toContain('.cursor');
    expect(target).toContain('agent-recall.json');
  });

  it('codex hooks target includes ~/.codex/hooks.json', () => {
    const platform = getPlatformById('codex')!;
    const target = platform.getHooksTarget('/any/root');
    expect(target).toContain('.codex');
    expect(target).toContain('hooks.json');
  });

  it('gemini hooks target includes ~/.gemini/hooks', () => {
    const platform = getPlatformById('gemini')!;
    const target = platform.getHooksTarget('/any/root');
    expect(target).toContain('.gemini');
    expect(target).toContain('agent-recall.json');
  });

  it('opencode hooks target includes opencode path with index.ts', () => {
    const platform = getPlatformById('opencode')!;
    const target = platform.getHooksTarget('/any/root');
    expect(target).toContain('opencode');
    expect(target).toContain('index.ts');
  });
});

describe('getHooksSource paths', () => {
  const root = '/test/agent-recall-root';

  it('claude-code hooks source is <root>/plugin/hooks/hooks.json', () => {
    const platform = getPlatformById('claude-code')!;
    expect(platform.getHooksSource(root)).toBe(`${root}/plugin/hooks/hooks.json`);
  });

  it('cursor hooks source is <root>/cursor-hooks/hooks.json', () => {
    const platform = getPlatformById('cursor')!;
    expect(platform.getHooksSource(root)).toBe(`${root}/cursor-hooks/hooks.json`);
  });

  it('codex hooks source is <root>/codex-hooks/hooks.json', () => {
    const platform = getPlatformById('codex')!;
    expect(platform.getHooksSource(root)).toBe(`${root}/codex-hooks/hooks.json`);
  });

  it('gemini hooks source is <root>/gemini-hooks/hooks.json', () => {
    const platform = getPlatformById('gemini')!;
    expect(platform.getHooksSource(root)).toBe(`${root}/gemini-hooks/hooks.json`);
  });

  it('opencode hooks source is <root>/opencode-plugin/index.ts', () => {
    const platform = getPlatformById('opencode')!;
    expect(platform.getHooksSource(root)).toBe(`${root}/opencode-plugin/index.ts`);
  });
});

describe('detectPlatforms()', () => {
  it('returns an array', () => {
    const result = detectPlatforms();
    expect(Array.isArray(result)).toBe(true);
  });

  it('returns only platforms whose detect() returns true', () => {
    const result = detectPlatforms();
    for (const platform of result) {
      expect(platform.detect()).toBe(true);
    }
  });

  it('detected platforms are a subset of PLATFORMS', () => {
    const result = detectPlatforms();
    const allIds = PLATFORMS.map((p) => p.id);
    for (const platform of result) {
      expect(allIds).toContain(platform.id);
    }
  });
});

describe('getPlatformById()', () => {
  it('returns the correct platform for a known id', () => {
    const platform = getPlatformById('claude-code');
    expect(platform).toBeDefined();
    expect(platform!.id).toBe('claude-code');
    expect(platform!.name).toBeTruthy();
  });

  it('returns correct platform for each known id', () => {
    const ids = ['claude-code', 'cursor', 'codex', 'gemini', 'opencode'] as const;
    for (const id of ids) {
      const platform = getPlatformById(id);
      expect(platform).toBeDefined();
      expect(platform!.id).toBe(id);
    }
  });

  it('returns undefined for unknown id', () => {
    const platform = getPlatformById('unknown-platform');
    expect(platform).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    const platform = getPlatformById('');
    expect(platform).toBeUndefined();
  });
});
