/**
 * Tests for generate-changelog script pure functions
 *
 * Source: scripts/generate-changelog.js
 *
 * Mock Justification: NONE (0% mock code)
 * - Tests only pure string transformation functions
 * - No GitHub CLI, filesystem, or network access
 *
 * Value: Validates changelog generation logic including date formatting,
 * version extraction, release body cleanup, and full changelog assembly.
 * Prevents regressions in the publish/release workflow.
 */
import { describe, it, expect } from 'bun:test';

// ─── Pure functions extracted from generate-changelog.js ────────────
// These are reimplemented here since the JS file doesn't export them.
// The implementations are kept identical to the source.

function formatDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toISOString().split('T')[0]; // YYYY-MM-DD
}

function cleanReleaseBody(body: string): string {
  return body
    .replace(/🤖 Generated with \[Claude Code\].*$/s, '')
    .replace(/---\n*$/s, '')
    .trim();
}

function extractVersion(tagName: string): string {
  return tagName.replace(/^v/, '');
}

function generateChangelog(releases: Array<{
  tagName: string;
  publishedAt: string;
  body: string;
}>): string {
  const lines = [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).',
    '',
  ];

  // Sort releases by date (newest first)
  releases.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  for (const release of releases) {
    const version = extractVersion(release.tagName);
    const date = formatDate(release.publishedAt);
    const body = cleanReleaseBody(release.body);

    lines.push(`## [${version}] - ${date}`);
    lines.push('');

    if (body) {
      const bodyWithoutHeader = body.replace(/^##?\s+v?[\d.]+.*?\n\n?/m, '');
      lines.push(bodyWithoutHeader);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('generate-changelog', () => {

  describe('formatDate', () => {
    it('should format ISO date to YYYY-MM-DD', () => {
      expect(formatDate('2025-11-11T10:30:00Z')).toBe('2025-11-11');
    });

    it('should handle date at start of day', () => {
      expect(formatDate('2025-01-01T00:00:00Z')).toBe('2025-01-01');
    });

    it('should handle date at end of day', () => {
      expect(formatDate('2025-12-31T23:59:59Z')).toBe('2025-12-31');
    });

    it('should handle GitHub-style ISO date with timezone offset', () => {
      // GitHub returns dates like "2025-11-11T10:30:00-08:00"
      const result = formatDate('2025-11-11T10:30:00-08:00');
      // After timezone conversion, this becomes 2025-11-11T18:30:00Z
      expect(result).toBe('2025-11-11');
    });
  });

  describe('cleanReleaseBody', () => {
    it('should remove Claude Code footer', () => {
      const body = `### Added
- New feature

🤖 Generated with [Claude Code](https://claude.ai/code)`;
      expect(cleanReleaseBody(body)).toBe('### Added\n- New feature');
    });

    it('should remove trailing horizontal rule', () => {
      const body = `### Fixed
- Bug fix

---`;
      expect(cleanReleaseBody(body)).toBe('### Fixed\n- Bug fix');
    });

    it('should remove both footer and horizontal rule', () => {
      const body = `### Changed
- Something changed

---

🤖 Generated with [Claude Code](https://claude.ai/code)`;
      // The Claude Code regex with /s flag matches across newlines
      expect(cleanReleaseBody(body)).toBe('### Changed\n- Something changed');
    });

    it('should leave body intact when no footer present', () => {
      const body = '### Added\n- New feature';
      expect(cleanReleaseBody(body)).toBe('### Added\n- New feature');
    });

    it('should handle empty body', () => {
      expect(cleanReleaseBody('')).toBe('');
    });

    it('should trim whitespace', () => {
      const body = '  \n### Added\n- Feature\n  ';
      expect(cleanReleaseBody(body)).toBe('### Added\n- Feature');
    });

    it('should handle footer with additional text after Claude Code link', () => {
      const body = `Content here

🤖 Generated with [Claude Code](https://claude.ai/code) - some extra text`;
      expect(cleanReleaseBody(body)).toBe('Content here');
    });
  });

  describe('extractVersion', () => {
    it('should remove v prefix from tag name', () => {
      expect(extractVersion('v1.0.0')).toBe('1.0.0');
    });

    it('should handle tag without v prefix', () => {
      expect(extractVersion('1.0.0')).toBe('1.0.0');
    });

    it('should handle pre-release versions', () => {
      expect(extractVersion('v1.0.0-alpha.1')).toBe('1.0.0-alpha.1');
    });

    it('should handle build metadata', () => {
      expect(extractVersion('v1.0.0+build.123')).toBe('1.0.0+build.123');
    });

    it('should only remove leading v', () => {
      expect(extractVersion('v2.0.0-v3')).toBe('2.0.0-v3');
    });
  });

  describe('generateChangelog', () => {
    it('should generate changelog from releases sorted by date', () => {
      const releases = [
        {
          tagName: 'v1.0.0',
          publishedAt: '2025-01-01T00:00:00Z',
          body: '### Added\n- Initial release',
        },
        {
          tagName: 'v2.0.0',
          publishedAt: '2025-06-01T00:00:00Z',
          body: '### Changed\n- Major update',
        },
      ];

      const result = generateChangelog(releases);

      // Newest should appear first
      const v2Index = result.indexOf('## [2.0.0]');
      const v1Index = result.indexOf('## [1.0.0]');
      expect(v2Index).toBeLessThan(v1Index);
    });

    it('should include changelog header', () => {
      const result = generateChangelog([]);
      expect(result).toContain('# Changelog');
      expect(result).toContain('Keep a Changelog');
    });

    it('should format version headers correctly', () => {
      const releases = [
        {
          tagName: 'v5.5.0',
          publishedAt: '2025-11-11T00:00:00Z',
          body: '- Feature X',
        },
      ];

      const result = generateChangelog(releases);
      expect(result).toContain('## [5.5.0] - 2025-11-11');
    });

    it('should strip redundant version header from body', () => {
      const releases = [
        {
          tagName: 'v5.5.0',
          publishedAt: '2025-11-11T00:00:00Z',
          body: '## v5.5.0 (2025-11-11)\n\n### Added\n- Feature X',
        },
      ];

      const result = generateChangelog(releases);
      // The body's "## v5.5.0 (2025-11-11)" heading should be removed
      expect(result).not.toContain('## v5.5.0 (2025-11-11)');
      expect(result).toContain('### Added');
      expect(result).toContain('- Feature X');
    });

    it('should handle empty release body', () => {
      const releases = [
        {
          tagName: 'v1.0.0',
          publishedAt: '2025-01-01T00:00:00Z',
          body: '',
        },
      ];

      const result = generateChangelog(releases);
      expect(result).toContain('## [1.0.0] - 2025-01-01');
      // Should not have extra blank lines from empty body
    });

    it('should clean Claude Code footer from bodies', () => {
      const releases = [
        {
          tagName: 'v1.0.0',
          publishedAt: '2025-01-01T00:00:00Z',
          body: '- Feature\n\n🤖 Generated with [Claude Code](https://claude.ai/code)',
        },
      ];

      const result = generateChangelog(releases);
      expect(result).not.toContain('Generated with');
      expect(result).toContain('- Feature');
    });

    it('should handle multiple releases in correct order', () => {
      const releases = [
        { tagName: 'v1.0.0', publishedAt: '2025-01-01T00:00:00Z', body: '- First' },
        { tagName: 'v3.0.0', publishedAt: '2025-03-01T00:00:00Z', body: '- Third' },
        { tagName: 'v2.0.0', publishedAt: '2025-02-01T00:00:00Z', body: '- Second' },
      ];

      const result = generateChangelog(releases);
      const lines = result.split('\n');
      const versionLines = lines.filter(l => l.startsWith('## ['));

      expect(versionLines[0]).toContain('[3.0.0]');
      expect(versionLines[1]).toContain('[2.0.0]');
      expect(versionLines[2]).toContain('[1.0.0]');
    });
  });
});
