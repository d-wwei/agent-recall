/**
 * Tests for PrivacyGuard — compilation input filtering by <private> tag
 *
 * Mock Justification: NONE (0% mock code)
 * - Pure computation, no DB or I/O for tag-level tests.
 * - In-memory SQLite for session-level and markSessionPrivate tests.
 *
 * Coverage:
 * 1. Non-private observation passes through
 * 2. Narrative containing <private> is filtered
 * 3. Title containing <private> is filtered
 * 4. Fact (in JSON string array) containing <private> is filtered
 * 5. Mixed batch — only private ones removed
 * 6. Empty array returns empty
 * 7. Case-insensitive matching (<PRIVATE>, <Private>)
 * 8. Observation with no narrative/title/facts passes through
 * 9. Facts as a parsed array (not JSON string)
 * 10. Closing tag only (<\/private>) does NOT trigger — only opening tag matters
 * 11. Multiple private fields — still filtered once
 * 12. Malformed JSON in facts does not throw
 * 13. Session-level filtering: private observation removes all session observations
 * 14. Session-level filtering: different sessions are independent
 * 15. Session-level filtering: observations without session_id are filtered only by tag
 * 16. markSessionPrivate: marks session in database
 * 17. isSessionPrivate: reads session flag from database
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { PrivacyGuard } from '../../../src/services/compilation/PrivacyGuard.js';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function obs(overrides: Record<string, any> = {}) {
  return {
    id: 1,
    type: 'change',
    project: 'test-project',
    concepts: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests — tag-level filtering (no DB required)
// ---------------------------------------------------------------------------

describe('PrivacyGuard', () => {
  const guard = new PrivacyGuard();

  // ── isPrivate ─────────────────────────────────────────────────────────────

  describe('isPrivate', () => {
    it('returns false for a clean observation with narrative and title', () => {
      const o = obs({ narrative: 'Fixed the login bug', title: 'Login Fix' });
      expect(guard.isPrivate(o)).toBe(false);
    });

    it('returns true when narrative contains <private>', () => {
      const o = obs({ narrative: 'Fixed <private>secret token</private> leak' });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('returns true when title contains <private>', () => {
      const o = obs({ title: '<private>confidential</private>' });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('returns true when a fact in the JSON-string array contains <private>', () => {
      const o = obs({ facts: JSON.stringify(['normal fact', '<private>secret</private>']) });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('returns false when all facts are clean (JSON string)', () => {
      const o = obs({ facts: JSON.stringify(['fact one', 'fact two']) });
      expect(guard.isPrivate(o)).toBe(false);
    });

    it('returns false when observation has no narrative, title, or facts', () => {
      const o = obs();
      expect(guard.isPrivate(o)).toBe(false);
    });

    it('matches <PRIVATE> (uppercase) case-insensitively', () => {
      const o = obs({ narrative: 'Contains <PRIVATE> marker' });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('matches <Private> (mixed case) case-insensitively', () => {
      const o = obs({ title: 'Has <Private>data</private>' });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('accepts facts as a pre-parsed array (not a JSON string)', () => {
      const o = obs({ facts: ['clean fact', '<private>hidden</private>'] });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('returns false when facts is a pre-parsed array with no private content', () => {
      const o = obs({ facts: ['fact a', 'fact b'] });
      expect(guard.isPrivate(o)).toBe(false);
    });

    it('does not throw on malformed JSON in facts — returns false', () => {
      const o = obs({ facts: '{not valid json' });
      expect(() => guard.isPrivate(o)).not.toThrow();
      expect(guard.isPrivate(o)).toBe(false);
    });

    it('returns true even when only the opening tag appears (no closing tag)', () => {
      const o = obs({ narrative: 'This is <private> content without closing' });
      expect(guard.isPrivate(o)).toBe(true);
    });

    it('returns true when multiple fields are private — still counts as one private observation', () => {
      const o = obs({
        narrative: '<private>secret narrative</private>',
        title: '<private>secret title</private>',
      });
      expect(guard.isPrivate(o)).toBe(true);
    });
  });

  // ── filterForCompilation (tag-level only) ─────────────────────────────────

  describe('filterForCompilation (tag-level)', () => {
    it('returns all observations when none are private', () => {
      const observations = [
        obs({ id: 1, narrative: 'Added feature A', title: 'Feature A' }),
        obs({ id: 2, narrative: 'Fixed bug B', title: 'Bug B' }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(2);
    });

    it('removes observations with private narrative', () => {
      const observations = [
        obs({ id: 1, narrative: 'Public change' }),
        obs({ id: 2, narrative: '<private>secret work</private>' }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('removes observations with private title', () => {
      const observations = [
        obs({ id: 1, title: 'Normal title' }),
        obs({ id: 2, title: '<private>Hidden title</private>' }),
        obs({ id: 3, title: 'Another normal title' }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(2);
      expect(result.map((o: any) => o.id)).toEqual([1, 3]);
    });

    it('removes observations with a private fact', () => {
      const observations = [
        obs({ id: 1, facts: JSON.stringify(['fact 1', 'fact 2']) }),
        obs({ id: 2, facts: JSON.stringify(['fact 1', '<private>secret fact</private>']) }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });

    it('handles mixed batch — keeps only non-private observations', () => {
      const observations = [
        obs({ id: 1, narrative: 'Public feature' }),
        obs({ id: 2, narrative: '<private>confidential</private>' }),
        obs({ id: 3, title: 'Normal title' }),
        obs({ id: 4, facts: JSON.stringify(['<private>hidden</private>']) }),
        obs({ id: 5, narrative: 'Another public change' }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(3);
      expect(result.map((o: any) => o.id)).toEqual([1, 3, 5]);
    });

    it('returns empty array for empty input', () => {
      expect(guard.filterForCompilation([])).toEqual([]);
    });

    it('preserves the original observation objects (no mutation)', () => {
      const original = obs({ id: 1, narrative: 'unchanged narrative' });
      const result = guard.filterForCompilation([original]);
      expect(result[0]).toBe(original);
    });
  });

  // ── filterForCompilation (session-level propagation) ──────────────────────

  describe('filterForCompilation (session-level propagation)', () => {
    it('removes ALL observations from a session when one is private', () => {
      const observations = [
        obs({ id: 1, memory_session_id: 'sess-A', narrative: 'Public from session A' }),
        obs({ id: 2, memory_session_id: 'sess-A', narrative: '<private>secret</private>' }),
        obs({ id: 3, memory_session_id: 'sess-A', narrative: 'Also public from session A' }),
        obs({ id: 4, memory_session_id: 'sess-B', narrative: 'Public from session B' }),
      ];
      const result = guard.filterForCompilation(observations);
      // All sess-A observations should be removed (id 1, 2, 3)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(4);
    });

    it('different sessions are independent — private in A does not affect B', () => {
      const observations = [
        obs({ id: 1, memory_session_id: 'sess-A', narrative: '<private>secret</private>' }),
        obs({ id: 2, memory_session_id: 'sess-B', narrative: 'Clean observation B' }),
        obs({ id: 3, memory_session_id: 'sess-C', narrative: 'Clean observation C' }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(2);
      expect(result.map((o: any) => o.id)).toEqual([2, 3]);
    });

    it('observations without memory_session_id are filtered only by tag', () => {
      const observations = [
        obs({ id: 1, narrative: 'Public, no session' }),
        obs({ id: 2, narrative: '<private>tagged private, no session</private>' }),
        obs({ id: 3, memory_session_id: 'sess-A', narrative: 'Public from A' }),
      ];
      const result = guard.filterForCompilation(observations);
      // id 1 passes (no tag, no session), id 2 removed (tag), id 3 passes
      expect(result).toHaveLength(2);
      expect(result.map((o: any) => o.id)).toEqual([1, 3]);
    });

    it('multiple private observations in same session do not cause double-filtering', () => {
      const observations = [
        obs({ id: 1, memory_session_id: 'sess-X', narrative: '<private>first secret</private>' }),
        obs({ id: 2, memory_session_id: 'sess-X', narrative: '<private>second secret</private>' }),
        obs({ id: 3, memory_session_id: 'sess-X', narrative: 'Public but tainted by session' }),
        obs({ id: 4, memory_session_id: 'sess-Y', narrative: 'Safe observation' }),
      ];
      const result = guard.filterForCompilation(observations);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(4);
    });

    it('empty or missing session IDs do not trigger session-level propagation', () => {
      const observations = [
        obs({ id: 1, memory_session_id: '', narrative: '<private>secret</private>' }),
        obs({ id: 2, memory_session_id: '', narrative: 'Also empty session ID' }),
      ];
      const result = guard.filterForCompilation(observations);
      // Empty string session ID is falsy — no session propagation, only tag filtering
      // id 1 is removed (tag), id 2 passes (no tag, no session propagation)
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });
  });
});

// ---------------------------------------------------------------------------
// Tests — markSessionPrivate and isSessionPrivate (DB required)
// ---------------------------------------------------------------------------

describe('PrivacyGuard (database integration)', () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.run('PRAGMA journal_mode = WAL');
    const runner = new MigrationRunner(db);
    runner.runAllMigrations();
  });

  afterEach(() => {
    db.close();
  });

  it('markSessionPrivate sets has_private_content flag on session', () => {
    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run('content-1', 'mem-1', 'test', new Date().toISOString(), Date.now());

    const guard = new PrivacyGuard(db);
    guard.markSessionPrivate('mem-1');

    const row = db.prepare('SELECT has_private_content FROM sdk_sessions WHERE memory_session_id = ?')
      .get('mem-1') as { has_private_content: number };
    expect(row.has_private_content).toBe(1);
  });

  it('markSessionPrivate works with content_session_id', () => {
    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, project, started_at, started_at_epoch)
      VALUES (?, ?, ?, ?)
    `).run('content-2', 'test', new Date().toISOString(), Date.now());

    const guard = new PrivacyGuard(db);
    guard.markSessionPrivate('content-2');

    const row = db.prepare('SELECT has_private_content FROM sdk_sessions WHERE content_session_id = ?')
      .get('content-2') as { has_private_content: number };
    expect(row.has_private_content).toBe(1);
  });

  it('isSessionPrivate returns true for marked sessions', () => {
    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run('content-3', 'mem-3', 'test', new Date().toISOString(), Date.now());

    const guard = new PrivacyGuard(db);
    expect(guard.isSessionPrivate('mem-3')).toBe(false);

    guard.markSessionPrivate('mem-3');
    expect(guard.isSessionPrivate('mem-3')).toBe(true);
  });

  it('isSessionPrivate returns false for unmarked sessions', () => {
    db.prepare(`
      INSERT INTO sdk_sessions (content_session_id, memory_session_id, project, started_at, started_at_epoch)
      VALUES (?, ?, ?, ?, ?)
    `).run('content-4', 'mem-4', 'test', new Date().toISOString(), Date.now());

    const guard = new PrivacyGuard(db);
    expect(guard.isSessionPrivate('mem-4')).toBe(false);
  });

  it('isSessionPrivate returns false for non-existent sessions', () => {
    const guard = new PrivacyGuard(db);
    expect(guard.isSessionPrivate('does-not-exist')).toBe(false);
  });

  it('markSessionPrivate is safe without DB', () => {
    const guard = new PrivacyGuard();
    // Should not throw
    expect(() => guard.markSessionPrivate('some-id')).not.toThrow();
  });

  it('isSessionPrivate is safe without DB', () => {
    const guard = new PrivacyGuard();
    expect(guard.isSessionPrivate('some-id')).toBe(false);
  });

  it('migration 39 creates has_private_content column', () => {
    const columns = db.prepare('PRAGMA table_info(sdk_sessions)').all() as { name: string }[];
    const hasColumn = columns.some(c => c.name === 'has_private_content');
    expect(hasColumn).toBe(true);
  });

  it('migration 39 records version in schema_versions', () => {
    const row = db.prepare('SELECT version FROM schema_versions WHERE version = 39')
      .get() as { version: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.version).toBe(39);
  });

  it('migration 39 is idempotent', () => {
    const runner = new MigrationRunner(db);
    runner.runAllMigrations(); // second run
    const columns = db.prepare('PRAGMA table_info(sdk_sessions)').all() as { name: string }[];
    const count = columns.filter(c => c.name === 'has_private_content').length;
    expect(count).toBe(1);
  });
});
