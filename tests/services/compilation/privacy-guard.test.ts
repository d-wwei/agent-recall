/**
 * Tests for PrivacyGuard — compilation input filtering by <private> tag
 *
 * Mock Justification: NONE (0% mock code)
 * - Pure computation, no DB or I/O — tests run directly against the class.
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
 */

import { describe, it, expect } from 'bun:test';
import { PrivacyGuard } from '../../../src/services/compilation/PrivacyGuard.js';

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
// Tests
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

  // ── filterForCompilation ──────────────────────────────────────────────────

  describe('filterForCompilation', () => {
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
});
