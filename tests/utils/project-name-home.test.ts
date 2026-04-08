/**
 * Home Directory Detection Tests
 *
 * Tests the isHomeDirectory utility used for Global Quick Mode.
 * Source: src/utils/project-name.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import path from 'path';
import { isHomeDirectory } from '../../src/utils/project-name.js';

describe('isHomeDirectory', () => {
  const originalHome = process.env.HOME;
  const originalUserProfile = process.env.USERPROFILE;

  afterEach(() => {
    // Restore original env vars
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }
    if (originalUserProfile !== undefined) {
      process.env.USERPROFILE = originalUserProfile;
    } else {
      delete process.env.USERPROFILE;
    }
  });

  it('returns true for actual HOME directory', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    expect(home).not.toBe(''); // Sanity check
    expect(isHomeDirectory(home)).toBe(true);
  });

  it('returns true for HOME with trailing slash', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    expect(isHomeDirectory(home + '/')).toBe(true);
  });

  it('returns false for subdirectories of HOME', () => {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    expect(isHomeDirectory(path.join(home, 'Documents'))).toBe(false);
    expect(isHomeDirectory(path.join(home, 'Projects', 'my-app'))).toBe(false);
    expect(isHomeDirectory(path.join(home, '.claude'))).toBe(false);
  });

  it('returns false for unrelated paths', () => {
    expect(isHomeDirectory('/tmp')).toBe(false);
    expect(isHomeDirectory('/var/log')).toBe(false);
    expect(isHomeDirectory('/usr/local/bin')).toBe(false);
  });

  it('returns false for root directory', () => {
    expect(isHomeDirectory('/')).toBe(false);
  });

  it('handles missing HOME env var gracefully', () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    expect(isHomeDirectory('/Users/someone')).toBe(false);
  });

  it('uses USERPROFILE when HOME is not set (Windows cross-platform)', () => {
    delete process.env.HOME;
    process.env.USERPROFILE = '/mock/windows/user';
    expect(isHomeDirectory('/mock/windows/user')).toBe(true);
    expect(isHomeDirectory('/mock/windows/user/Documents')).toBe(false);
  });

  it('prefers HOME over USERPROFILE when both are set', () => {
    process.env.HOME = '/unix/home';
    process.env.USERPROFILE = '/windows/home';
    expect(isHomeDirectory('/unix/home')).toBe(true);
    expect(isHomeDirectory('/windows/home')).toBe(false);
  });
});
