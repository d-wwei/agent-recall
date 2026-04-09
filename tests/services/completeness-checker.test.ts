/**
 * Tests for CompletenessChecker — persona completeness and stale detection
 *
 * Mock Justification: NONE (0% mock code)
 * - Pure computation, no DB or I/O — tests run directly against the class.
 *
 * Coverage:
 * - Empty persona → 0%
 * - Fully populated persona → 100%
 * - Partially populated → proportional %
 * - Gap detection (profile types with no data)
 * - Missing required field detection
 * - Staleness detection (> 90 days)
 * - Staleness boundary (exactly 90 days vs 91 days)
 * - Null profile values treated as empty
 * - Array fields (core_values, recurring_tasks) filled vs empty
 * - Multiple stale fields detected simultaneously
 */

import { describe, it, expect } from 'bun:test';
import { CompletenessChecker } from '../../src/services/persona/CompletenessChecker.js';
import type { MergedPersona } from '../../src/services/persona/PersonaTypes.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function emptyPersona(): MergedPersona {
  return {
    agent_soul: null as any,
    user: null as any,
    style: null as any,
    workflow: null as any,
  };
}

function fullPersona(): MergedPersona {
  return {
    agent_soul: {
      name: 'Recall',
      self_description: 'A helpful memory agent',
      core_values: ['accuracy', 'brevity'],
      vibe: 'calm',
    },
    user: {
      name: 'Eli',
      role: 'Product Owner',
      language: 'zh',
      timezone: 'America/Toronto',
      profession: 'Software Engineer',
    },
    style: {
      tone: 'direct',
      brevity: 'concise',
      formatting: 'markdown',
      output_structure: 'conclusion-first',
    },
    workflow: {
      preferred_role: 'reviewer',
      decision_style: 'pragmatic',
      recurring_tasks: ['weekly review', 'standup'],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CompletenessChecker', () => {
  const checker = new CompletenessChecker();

  // -------------------------------------------------------------------------
  // check() — percentage
  // -------------------------------------------------------------------------

  it('returns 0% for a completely empty persona', () => {
    const report = checker.check(emptyPersona());
    expect(report.percentage).toBe(0);
  });

  it('returns 100% for a fully populated persona', () => {
    const report = checker.check(fullPersona());
    expect(report.percentage).toBe(100);
  });

  it('returns proportional % for a partial persona', () => {
    const persona = emptyPersona();
    // Fill only user.name and user.role (2 out of 16 total fields)
    persona.user = { name: 'Eli', role: 'PM' };

    const report = checker.check(persona);
    // Total fields: agent_soul=4, user=5, style=4, workflow=3 → 16
    // Filled: 2 (name + role)
    expect(report.percentage).toBe(Math.round((2 / 16) * 100));
    expect(report.percentage).toBeGreaterThan(0);
    expect(report.percentage).toBeLessThan(100);
  });

  it('counts recommended fields toward percentage', () => {
    const persona = emptyPersona();
    // Only fill the required user fields
    persona.user = { name: 'Eli', role: 'PM' };
    const reportRequired = checker.check(persona);

    // Now add recommended user fields too
    persona.user = {
      name: 'Eli',
      role: 'PM',
      language: 'en',
      timezone: 'UTC',
      profession: 'Engineer',
    };
    const reportFull = checker.check(persona);

    expect(reportFull.percentage).toBeGreaterThan(reportRequired.percentage);
  });

  // -------------------------------------------------------------------------
  // check() — gaps
  // -------------------------------------------------------------------------

  it('identifies all 4 types as gaps when persona is empty', () => {
    const report = checker.check(emptyPersona());
    expect(report.gaps).toContain('agent_soul');
    expect(report.gaps).toContain('user');
    expect(report.gaps).toContain('style');
    expect(report.gaps).toContain('workflow');
    expect(report.gaps).toHaveLength(4);
  });

  it('does not report a gap for a populated profile type', () => {
    const persona = emptyPersona();
    persona.user = { name: 'Eli' };
    const report = checker.check(persona);
    expect(report.gaps).not.toContain('user');
    expect(report.gaps).toContain('agent_soul');
    expect(report.gaps).toContain('style');
    expect(report.gaps).toContain('workflow');
  });

  it('reports no gaps for a fully populated persona', () => {
    const report = checker.check(fullPersona());
    expect(report.gaps).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // check() — missingFields
  // -------------------------------------------------------------------------

  it('lists all required fields as missing when persona is empty', () => {
    const report = checker.check(emptyPersona());
    expect(report.missingFields).toContain('agent_soul.name');
    expect(report.missingFields).toContain('user.name');
    expect(report.missingFields).toContain('user.role');
    expect(report.missingFields).toContain('style.tone');
    expect(report.missingFields).toContain('workflow.preferred_role');
  });

  it('does not list a required field as missing when it is filled', () => {
    const persona = emptyPersona();
    persona.user = { name: 'Eli', role: 'PM' };
    const report = checker.check(persona);
    expect(report.missingFields).not.toContain('user.name');
    expect(report.missingFields).not.toContain('user.role');
  });

  it('does not list recommended fields in missingFields', () => {
    const persona = emptyPersona();
    // user has name+role (required) but no language/timezone/profession (recommended)
    persona.user = { name: 'Eli', role: 'PM' };
    const report = checker.check(persona);
    expect(report.missingFields).not.toContain('user.language');
    expect(report.missingFields).not.toContain('user.timezone');
    expect(report.missingFields).not.toContain('user.profession');
  });

  it('returns no missingFields for a fully populated persona', () => {
    const report = checker.check(fullPersona());
    expect(report.missingFields).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // check() — edge cases
  // -------------------------------------------------------------------------

  it('treats an empty object the same as null for gap detection', () => {
    const persona = emptyPersona();
    persona.user = {} as any;
    const report = checker.check(persona);
    expect(report.gaps).toContain('user');
  });

  it('handles empty array values (core_values) as unfilled', () => {
    const persona = emptyPersona();
    persona.agent_soul = { name: 'Recall', core_values: [] };
    const report = checker.check(persona);
    // core_values is recommended; it should not be in missingFields but should
    // not count toward the filled tally — percentage should reflect this
    const filledWithEmptyArray = report.percentage;

    const persona2 = emptyPersona();
    persona2.agent_soul = { name: 'Recall', core_values: ['accuracy'] };
    const report2 = checker.check(persona2);

    expect(report2.percentage).toBeGreaterThan(filledWithEmptyArray);
  });

  // -------------------------------------------------------------------------
  // checkStaleness()
  // -------------------------------------------------------------------------

  it('detects a profile as stale when last updated > 90 days ago', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const staleDate = new Date(now.getTime() - 91 * 24 * 60 * 60 * 1000).toISOString();
    const report = checker.checkStaleness({ user: staleDate }, now);
    expect(report.staleFields).toContain('user');
  });

  it('does not flag a profile as stale when updated exactly 90 days ago', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const exactDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const report = checker.checkStaleness({ user: exactDate }, now);
    expect(report.staleFields).not.toContain('user');
  });

  it('does not flag a recently updated profile as stale', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const recentDate = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const report = checker.checkStaleness({ style: recentDate }, now);
    expect(report.staleFields).not.toContain('style');
  });

  it('detects multiple stale fields simultaneously', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const stale = new Date(now.getTime() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const report = checker.checkStaleness(
      { user: stale, style: stale, workflow: stale },
      now
    );
    expect(report.staleFields).toContain('user');
    expect(report.staleFields).toContain('style');
    expect(report.staleFields).toContain('workflow');
    expect(report.staleFields).toHaveLength(3);
  });

  it('returns empty staleFields when updatedAtMap is empty', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const report = checker.checkStaleness({}, now);
    expect(report.staleFields).toHaveLength(0);
  });

  it('ignores invalid date strings in updatedAtMap', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const report = checker.checkStaleness({ user: 'not-a-date' }, now);
    expect(report.staleFields).not.toContain('user');
  });
});
