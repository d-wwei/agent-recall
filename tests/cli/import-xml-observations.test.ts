/**
 * Tests for import-xml-observations CLI tool
 *
 * Mock Justification: NONE (0% mock code)
 * - All tested functions are pure XML/string parsers with no side effects
 * - No database, filesystem, or network access needed
 *
 * Value: Validates XML parsing logic that handles observation and summary
 * import from transcript XML files. Covers edge cases in tag extraction,
 * array parsing, timestamp conversion, and required-field validation.
 */
import { describe, it, expect } from 'bun:test';
import {
  extractTag,
  extractArrayTags,
  parseObservation,
  parseSummary,
  extractTimestamp,
} from '../../src/bin/import-xml-observations.js';

describe('import-xml-observations', () => {

  // ─── extractTag ────────────────────────────────────────────────────

  describe('extractTag', () => {
    it('should extract simple tag content', () => {
      const xml = '<type>discovery</type>';
      expect(extractTag(xml, 'type')).toBe('discovery');
    });

    it('should extract tag content with surrounding whitespace', () => {
      const xml = '<title>  Some Title  </title>';
      expect(extractTag(xml, 'title')).toBe('Some Title');
    });

    it('should extract multiline tag content', () => {
      const xml = `<narrative>
        This is a narrative
        that spans multiple lines
      </narrative>`;
      expect(extractTag(xml, 'narrative')).toBe(
        'This is a narrative\n        that spans multiple lines'
      );
    });

    it('should return empty string for missing tag', () => {
      const xml = '<type>discovery</type>';
      expect(extractTag(xml, 'title')).toBe('');
    });

    it('should return empty string for empty XML', () => {
      expect(extractTag('', 'type')).toBe('');
    });

    it('should be case-insensitive for tag names', () => {
      const xml = '<TYPE>discovery</TYPE>';
      expect(extractTag(xml, 'type')).toBe('discovery');
    });

    it('should extract first occurrence when multiple tags exist', () => {
      const xml = '<type>first</type><type>second</type>';
      expect(extractTag(xml, 'type')).toBe('first');
    });

    it('should handle tag content with special characters', () => {
      const xml = '<title>Fix &amp; improve "auth" module</title>';
      expect(extractTag(xml, 'title')).toBe('Fix &amp; improve "auth" module');
    });

    it('should handle nested XML without confusion', () => {
      const xml = '<observation><type>bugfix</type><title>Fix crash</title></observation>';
      expect(extractTag(xml, 'type')).toBe('bugfix');
      expect(extractTag(xml, 'title')).toBe('Fix crash');
    });
  });

  // ─── extractArrayTags ─────────────────────────────────────────────

  describe('extractArrayTags', () => {
    it('should extract items from a container tag', () => {
      const xml = `
        <facts>
          <fact>The module uses ESM imports</fact>
          <fact>Tests run with Bun</fact>
        </facts>
      `;
      const result = extractArrayTags(xml, 'facts', 'fact');
      expect(result).toEqual([
        'The module uses ESM imports',
        'Tests run with Bun',
      ]);
    });

    it('should return empty array when container tag is missing', () => {
      const xml = '<type>discovery</type>';
      expect(extractArrayTags(xml, 'facts', 'fact')).toEqual([]);
    });

    it('should return empty array when container has no items', () => {
      const xml = '<facts></facts>';
      expect(extractArrayTags(xml, 'facts', 'fact')).toEqual([]);
    });

    it('should handle single item', () => {
      const xml = '<concepts><concept>dependency injection</concept></concepts>';
      const result = extractArrayTags(xml, 'concepts', 'concept');
      expect(result).toEqual(['dependency injection']);
    });

    it('should trim whitespace from items', () => {
      const xml = `<facts>
        <fact>  fact with spaces  </fact>
      </facts>`;
      const result = extractArrayTags(xml, 'facts', 'fact');
      expect(result).toEqual(['fact with spaces']);
    });

    it('should handle files_read container', () => {
      const xml = `
        <files_read>
          <file>src/main.ts</file>
          <file>src/utils.ts</file>
          <file>package.json</file>
        </files_read>
      `;
      const result = extractArrayTags(xml, 'files_read', 'file');
      expect(result).toEqual(['src/main.ts', 'src/utils.ts', 'package.json']);
    });

    it('should handle files_modified container', () => {
      const xml = `
        <files_modified>
          <file>src/index.ts</file>
        </files_modified>
      `;
      const result = extractArrayTags(xml, 'files_modified', 'file');
      expect(result).toEqual(['src/index.ts']);
    });

    it('should return empty array for empty input', () => {
      expect(extractArrayTags('', 'facts', 'fact')).toEqual([]);
    });
  });

  // ─── parseObservation ─────────────────────────────────────────────

  describe('parseObservation', () => {
    const validObservationXml = `
      <observation>
        <type>discovery</type>
        <title>Found authentication module</title>
        <subtitle>OAuth2 implementation</subtitle>
        <facts>
          <fact>Uses JWT tokens</fact>
          <fact>Supports refresh tokens</fact>
        </facts>
        <narrative>Investigated the auth module and found a complete OAuth2 implementation.</narrative>
        <concepts>
          <concept>OAuth2</concept>
          <concept>JWT</concept>
        </concepts>
        <files_read>
          <file>src/auth/oauth.ts</file>
        </files_read>
        <files_modified>
        </files_modified>
      </observation>
    `;

    it('should parse a complete observation block', () => {
      const result = parseObservation(validObservationXml);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('discovery');
      expect(result!.title).toBe('Found authentication module');
      expect(result!.subtitle).toBe('OAuth2 implementation');
      expect(result!.facts).toEqual(['Uses JWT tokens', 'Supports refresh tokens']);
      expect(result!.narrative).toBe(
        'Investigated the auth module and found a complete OAuth2 implementation.'
      );
      expect(result!.concepts).toEqual(['OAuth2', 'JWT']);
      expect(result!.files_read).toEqual(['src/auth/oauth.ts']);
      expect(result!.files_modified).toEqual([]);
    });

    it('should return null for XML without observation tags', () => {
      expect(parseObservation('<type>discovery</type>')).toBeNull();
    });

    it('should return null for incomplete observation (no closing tag)', () => {
      expect(parseObservation('<observation><type>discovery</type>')).toBeNull();
    });

    it('should return null when type is missing', () => {
      const xml = `
        <observation>
          <title>Some title</title>
        </observation>
      `;
      expect(parseObservation(xml)).toBeNull();
    });

    it('should return null when title is missing', () => {
      const xml = `
        <observation>
          <type>discovery</type>
        </observation>
      `;
      expect(parseObservation(xml)).toBeNull();
    });

    it('should handle observation with minimal fields', () => {
      const xml = `
        <observation>
          <type>change</type>
          <title>Updated config</title>
        </observation>
      `;
      const result = parseObservation(xml);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('change');
      expect(result!.title).toBe('Updated config');
      expect(result!.subtitle).toBe('');
      expect(result!.facts).toEqual([]);
      expect(result!.narrative).toBe('');
      expect(result!.concepts).toEqual([]);
      expect(result!.files_read).toEqual([]);
      expect(result!.files_modified).toEqual([]);
    });

    it('should return null for empty string', () => {
      expect(parseObservation('')).toBeNull();
    });

    it('should handle all observation types', () => {
      for (const type of ['discovery', 'change', 'bugfix', 'feature', 'decision']) {
        const xml = `<observation><type>${type}</type><title>Test</title></observation>`;
        const result = parseObservation(xml);
        expect(result).not.toBeNull();
        expect(result!.type).toBe(type);
      }
    });
  });

  // ─── parseSummary ─────────────────────────────────────────────────

  describe('parseSummary', () => {
    const validSummaryXml = `
      <summary>
        <request>Implement user authentication</request>
        <investigated>Looked at existing auth patterns in the codebase</investigated>
        <learned>The project uses Passport.js for authentication</learned>
        <completed>Added OAuth2 provider configuration</completed>
        <next_steps>Implement token refresh logic</next_steps>
        <notes>Need to check rate limits</notes>
      </summary>
    `;

    it('should parse a complete summary block', () => {
      const result = parseSummary(validSummaryXml);
      expect(result).not.toBeNull();
      expect(result!.request).toBe('Implement user authentication');
      expect(result!.investigated).toBe('Looked at existing auth patterns in the codebase');
      expect(result!.learned).toBe('The project uses Passport.js for authentication');
      expect(result!.completed).toBe('Added OAuth2 provider configuration');
      expect(result!.next_steps).toBe('Implement token refresh logic');
      expect(result!.notes).toBe('Need to check rate limits');
    });

    it('should return null for XML without summary tags', () => {
      expect(parseSummary('<request>Something</request>')).toBeNull();
    });

    it('should return null for incomplete summary (no closing tag)', () => {
      expect(parseSummary('<summary><request>Something</request>')).toBeNull();
    });

    it('should return null when request is missing', () => {
      const xml = `
        <summary>
          <investigated>Looked at stuff</investigated>
          <completed>Did things</completed>
        </summary>
      `;
      expect(parseSummary(xml)).toBeNull();
    });

    it('should handle summary with notes as null when empty', () => {
      const xml = `
        <summary>
          <request>Fix the bug</request>
          <investigated>Checked logs</investigated>
          <learned>Found the root cause</learned>
          <completed>Applied fix</completed>
          <next_steps>Monitor for regressions</next_steps>
        </summary>
      `;
      const result = parseSummary(xml);
      expect(result).not.toBeNull();
      expect(result!.notes).toBeNull();
    });

    it('should handle summary with minimal fields', () => {
      const xml = `
        <summary>
          <request>Do something</request>
        </summary>
      `;
      const result = parseSummary(xml);
      expect(result).not.toBeNull();
      expect(result!.request).toBe('Do something');
      expect(result!.investigated).toBe('');
      expect(result!.learned).toBe('');
      expect(result!.completed).toBe('');
      expect(result!.next_steps).toBe('');
      expect(result!.notes).toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseSummary('')).toBeNull();
    });
  });

  // ─── extractTimestamp ─────────────────────────────────────────────

  describe('extractTimestamp', () => {
    it('should extract timestamp from valid block comment', () => {
      const comment = '<!-- Block 1 | 2025-10-19 03:03:23 UTC -->';
      const result = extractTimestamp(comment);
      expect(result).not.toBeNull();
      // Verify it produces a valid ISO string
      expect(result).toBe(new Date('2025-10-19T03:03:23Z').toISOString());
    });

    it('should handle various block numbers', () => {
      expect(extractTimestamp('<!-- Block 1 | 2025-10-19 03:03:23 UTC -->')).not.toBeNull();
      expect(extractTimestamp('<!-- Block 42 | 2025-10-19 03:03:23 UTC -->')).not.toBeNull();
      expect(extractTimestamp('<!-- Block 999 | 2025-10-19 03:03:23 UTC -->')).not.toBeNull();
    });

    it('should return null for non-block comment lines', () => {
      expect(extractTimestamp('<observation>')).toBeNull();
      expect(extractTimestamp('plain text')).toBeNull();
      expect(extractTimestamp('')).toBeNull();
    });

    it('should return null for malformed block comments', () => {
      expect(extractTimestamp('<!-- Block | 2025-10-19 03:03:23 UTC -->')).toBeNull();
      expect(extractTimestamp('<!-- Block abc | 2025-10-19 03:03:23 UTC -->')).toBeNull();
    });

    it('should preserve correct date in ISO format', () => {
      const comment = '<!-- Block 5 | 2025-12-25 14:30:00 UTC -->';
      const result = extractTimestamp(comment);
      const parsed = new Date(result!);
      expect(parsed.getUTCFullYear()).toBe(2025);
      expect(parsed.getUTCMonth()).toBe(11); // December = 11
      expect(parsed.getUTCDate()).toBe(25);
      expect(parsed.getUTCHours()).toBe(14);
      expect(parsed.getUTCMinutes()).toBe(30);
      expect(parsed.getUTCSeconds()).toBe(0);
    });

    it('should handle timestamps within a larger XML block', () => {
      const block = `<!-- Block 10 | 2025-11-01 08:15:45 UTC -->
<observation>
  <type>discovery</type>
  <title>Test</title>
</observation>`;
      const result = extractTimestamp(block);
      expect(result).not.toBeNull();
      expect(result).toBe(new Date('2025-11-01T08:15:45Z').toISOString());
    });
  });

  // ─── Integration: full XML block parsing ──────────────────────────

  describe('full block parsing integration', () => {
    it('should parse a realistic observation block with timestamp', () => {
      const block = `<!-- Block 42 | 2025-10-20 15:30:00 UTC -->
<observation>
  <type>bugfix</type>
  <title>Fix memory leak in event handler</title>
  <subtitle>EventEmitter cleanup</subtitle>
  <facts>
    <fact>Event listeners were not being removed on component unmount</fact>
    <fact>Memory grew by 2MB per hour under load</fact>
  </facts>
  <narrative>Traced a memory leak to orphaned event listeners in the session manager.</narrative>
  <concepts>
    <concept>memory management</concept>
    <concept>event-driven architecture</concept>
  </concepts>
  <files_read>
    <file>src/services/session-manager.ts</file>
    <file>src/hooks/lifecycle.ts</file>
  </files_read>
  <files_modified>
    <file>src/services/session-manager.ts</file>
  </files_modified>
</observation>`;

      const timestamp = extractTimestamp(block);
      expect(timestamp).toBe(new Date('2025-10-20T15:30:00Z').toISOString());

      const obs = parseObservation(block);
      expect(obs).not.toBeNull();
      expect(obs!.type).toBe('bugfix');
      expect(obs!.title).toBe('Fix memory leak in event handler');
      expect(obs!.facts).toHaveLength(2);
      expect(obs!.files_read).toHaveLength(2);
      expect(obs!.files_modified).toHaveLength(1);
    });

    it('should parse a realistic summary block with timestamp', () => {
      const block = `<!-- Block 100 | 2025-10-21 22:00:00 UTC -->
<summary>
  <request>Refactor database layer to use connection pooling</request>
  <investigated>Current SQLite usage patterns and connection lifecycle</investigated>
  <learned>SQLite in WAL mode supports concurrent reads but single writer</learned>
  <completed>Implemented connection pool with max 5 read connections</completed>
  <next_steps>Add connection timeout handling and retry logic</next_steps>
  <notes>Consider switching to better-sqlite3 for synchronous API</notes>
</summary>`;

      const timestamp = extractTimestamp(block);
      expect(timestamp).toBe(new Date('2025-10-21T22:00:00Z').toISOString());

      const summary = parseSummary(block);
      expect(summary).not.toBeNull();
      expect(summary!.request).toBe('Refactor database layer to use connection pooling');
      expect(summary!.notes).toBe('Consider switching to better-sqlite3 for synchronous API');
    });

    it('should correctly distinguish observation vs summary blocks', () => {
      const obsBlock = `<!-- Block 1 | 2025-10-19 03:03:23 UTC -->
<observation><type>discovery</type><title>Test</title></observation>`;

      const sumBlock = `<!-- Block 2 | 2025-10-19 04:00:00 UTC -->
<summary><request>Do something</request></summary>`;

      // Observation block should parse as observation, not summary
      expect(parseObservation(obsBlock)).not.toBeNull();
      expect(parseSummary(obsBlock)).toBeNull();

      // Summary block should parse as summary, not observation
      expect(parseSummary(sumBlock)).not.toBeNull();
      expect(parseObservation(sumBlock)).toBeNull();
    });
  });
});
