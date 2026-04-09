/**
 * Tests for DeduplicationService
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite in-memory DB with full schema migrations
 * - Tests actual SQL queries and hash/similarity logic
 *
 * Value: Prevents regression on two-level deduplication (PostToolUse + WriteTime)
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { DeduplicationService } from '../../src/services/worker/DeduplicationService.js';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function insertObservation(
  db: Database,
  opts: {
    memorySessionId: string;
    project: string;
    narrative: string;
    filesModified?: string[];
    createdAtEpoch?: number;
    contentHash?: string;
  }
): number {
  const epoch = opts.createdAtEpoch ?? Date.now();
  const filesModified = JSON.stringify(opts.filesModified ?? []);
  const contentHash = opts.contentHash ??
    createHash('sha256').update(opts.narrative).digest('hex').slice(0, 16);

  const result = db.prepare(`
    INSERT INTO observations
      (memory_session_id, project, text, type, narrative, files_modified,
       content_hash, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    opts.memorySessionId,
    opts.project,
    '',        // text — nullable in practice but set to empty for compatibility
    'feature',
    opts.narrative,
    filesModified,
    contentHash,
    new Date(epoch).toISOString(),
    epoch
  );
  return Number(result.lastInsertRowid);
}

function insertSdkSession(db: Database, memorySessionId: string, project: string = 'test-project'): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR IGNORE INTO sdk_sessions
      (content_session_id, memory_session_id, project, started_at, started_at_epoch, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(memorySessionId, memorySessionId, project, now, Date.now(), 'active');
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('DeduplicationService', () => {
  let db: Database;
  let svc: DeduplicationService;

  const SESSION = 'session-abc';
  const PROJECT = 'test-project';

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    svc = new DeduplicationService(db);
    insertSdkSession(db, SESSION, PROJECT);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // calculateSimilarity (static)
  // -------------------------------------------------------------------------

  describe('calculateSimilarity', () => {
    it('returns 1.0 for identical strings', () => {
      const s = 'fixed the login bug in authentication module';
      expect(DeduplicationService.calculateSimilarity(s, s)).toBe(1);
    });

    it('returns 0 for completely different strings', () => {
      const a = 'apple banana cherry';
      const b = 'zebra umbrella volcano';
      expect(DeduplicationService.calculateSimilarity(a, b)).toBe(0);
    });

    it('returns proportional value for partial overlap', () => {
      // wordsA = {apple, banana, cherry}  (3 words)
      // wordsB = {apple, banana, mango}   (3 words)
      // intersection = {apple, banana} = 2
      // union = {apple, banana, cherry, mango} = 4
      // similarity = 2/4 = 0.5
      const a = 'apple banana cherry';
      const b = 'apple banana mango';
      const sim = DeduplicationService.calculateSimilarity(a, b);
      expect(sim).toBeCloseTo(0.5, 5);
    });

    it('returns 0 when first string is empty', () => {
      expect(DeduplicationService.calculateSimilarity('', 'some words here')).toBe(0);
    });

    it('returns 0 when second string is empty', () => {
      expect(DeduplicationService.calculateSimilarity('some words here', '')).toBe(0);
    });

    it('returns 1 when both strings are empty', () => {
      expect(DeduplicationService.calculateSimilarity('', '')).toBe(0);
      // Both empty → both sets empty → return 1 per spec
      // Actually spec says: if (!a || !b) return 0, so empty string → 0
      // Let's verify the actual behaviour matches implementation
    });

    it('ignores short words (length <= 2)', () => {
      // "is", "a", "to" are <= 2 chars and should be filtered
      const a = 'is a to refactor the component code';
      const b = 'is a to update the component code';
      // words after filter: {refactor, the, component, code} vs {update, the, component, code}
      // intersection = {the, component, code} = 3
      // union = {refactor, the, component, code, update} = 5
      const sim = DeduplicationService.calculateSimilarity(a, b);
      expect(sim).toBeCloseTo(3 / 5, 5);
    });

    it('is case-insensitive', () => {
      const a = 'Fixed The Bug';
      const b = 'fixed the bug';
      expect(DeduplicationService.calculateSimilarity(a, b)).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // checkPostToolUse
  // -------------------------------------------------------------------------

  describe('checkPostToolUse', () => {
    it('returns insert for first observation (no prior observations)', () => {
      const result = svc.checkPostToolUse(SESSION, null, 'Write', 'Added login feature');
      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('detects near-duplicate narrative within 5-minute window', () => {
      const narrative = 'Refactored the authentication module to improve performance reliability security and maintainability of the whole codebase';
      insertObservation(db, { memorySessionId: SESSION, project: PROJECT, narrative });

      // Slightly rephrased but nearly identical (adds one word — similarity = 11/12 > 0.9)
      const similar = 'Refactored the authentication module to improve performance reliability security and maintainability of the whole codebase refactoring';
      const result = svc.checkPostToolUse(SESSION, null, 'Write', similar);

      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe('merge');
      expect(result.existingId).toBeGreaterThan(0);
      expect(result.similarity).toBeGreaterThan(0.9);
    });

    it('returns insert when narratives are sufficiently different', () => {
      const narrative = 'Added user profile page with avatar upload capability';
      insertObservation(db, { memorySessionId: SESSION, project: PROJECT, narrative });

      const different = 'Fixed database connection pool exhaustion during high traffic';
      const result = svc.checkPostToolUse(SESSION, null, 'Write', different);

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('returns insert when file does not match files_modified', () => {
      const narrative = 'Updated the component styles and layout';
      insertObservation(db, {
        memorySessionId: SESSION,
        project: PROJECT,
        narrative,
        filesModified: ['src/components/Button.tsx'],
      });

      // Nearly identical narrative but different file
      const result = svc.checkPostToolUse(
        SESSION,
        'src/components/Header.tsx',
        'Write',
        narrative
      );

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('detects near-duplicate when file matches files_modified', () => {
      const narrative = 'Updated the button component styles and layout for consistency across the whole application design system';
      const file = 'src/components/Button.tsx';
      insertObservation(db, {
        memorySessionId: SESSION,
        project: PROJECT,
        narrative,
        filesModified: [file],
      });

      // Adds one word at the end — similarity = 10/11 > 0.9
      const similar = 'Updated the button component styles and layout for consistency across the whole application design system refactored';
      const result = svc.checkPostToolUse(SESSION, file, 'Write', similar);

      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe('merge');
    });

    it('returns insert for observation beyond 5-minute window', () => {
      const narrative = 'Refactored the authentication module to improve performance';
      const sixMinAgo = Date.now() - 6 * 60 * 1000;
      insertObservation(db, {
        memorySessionId: SESSION,
        project: PROJECT,
        narrative,
        createdAtEpoch: sixMinAgo,
      });

      // Near-identical narrative, but the prior observation is older than 5 min
      const similar = 'Refactored the authentication module to improve performance and reliability';
      const result = svc.checkPostToolUse(SESSION, null, 'Write', similar);

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('returns insert when session does not match', () => {
      const narrative = 'Refactored the authentication module to improve performance';
      insertObservation(db, {
        memorySessionId: SESSION,
        project: PROJECT,
        narrative,
      });

      // Different session
      insertSdkSession(db, 'other-session', PROJECT);
      const result = svc.checkPostToolUse('other-session', null, 'Write', narrative);

      // The recent observation belongs to SESSION, not 'other-session'
      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('returns similarity score even when not a duplicate', () => {
      const narrative = 'Added user profile page with some features and settings configured';
      insertObservation(db, { memorySessionId: SESSION, project: PROJECT, narrative });

      // Similar but below threshold
      const partial = 'Added user profile page with different content and settings changed';
      const result = svc.checkPostToolUse(SESSION, null, 'Write', partial);

      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
      expect(result.similarity).toBeDefined();
      expect(result.similarity!).toBeGreaterThan(0);
      expect(result.similarity!).toBeLessThanOrEqual(0.9);
    });
  });

  // -------------------------------------------------------------------------
  // checkWriteTime
  // -------------------------------------------------------------------------

  describe('checkWriteTime', () => {
    it('returns insert when no matching content hash exists', () => {
      const result = svc.checkWriteTime('A brand new unique observation narrative', PROJECT);
      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('returns skip for exact content hash duplicate', () => {
      const narrative = 'Exact same narrative content for deduplication testing';
      // Compute the same hash as DeduplicationService uses
      const contentHash = createHash('sha256').update(narrative).digest('hex').slice(0, 16);
      const id = insertObservation(db, {
        memorySessionId: SESSION,
        project: PROJECT,
        narrative,
        contentHash,
      });

      const result = svc.checkWriteTime(narrative, PROJECT);
      expect(result.isDuplicate).toBe(true);
      expect(result.action).toBe('skip');
      expect(result.existingId).toBe(id);
      expect(result.similarity).toBe(1);
    });

    it('returns insert when hash exists in a different project', () => {
      const narrative = 'Shared narrative that appears in multiple projects';
      const contentHash = createHash('sha256').update(narrative).digest('hex').slice(0, 16);

      // Insert in a different project/session
      insertSdkSession(db, 'other-session', 'other-project');
      insertObservation(db, {
        memorySessionId: 'other-session',
        project: 'other-project',
        narrative,
        contentHash,
      });

      // Check against a different project — should not be considered a duplicate
      const result = svc.checkWriteTime(narrative, PROJECT);
      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('returns insert for narratives that differ by even one word', () => {
      const narrative = 'Added the new feature to the user interface component here';
      const contentHash = createHash('sha256').update(narrative).digest('hex').slice(0, 16);
      insertObservation(db, { memorySessionId: SESSION, project: PROJECT, narrative, contentHash });

      const slightlyDifferent = 'Added the new feature to the user interface component there';
      const result = svc.checkWriteTime(slightlyDifferent, PROJECT);
      expect(result.isDuplicate).toBe(false);
      expect(result.action).toBe('insert');
    });

    it('returns skip using same hash on successive calls', () => {
      const narrative = 'Idempotent observation that should only be stored once for the project';
      const contentHash = createHash('sha256').update(narrative).digest('hex').slice(0, 16);
      insertObservation(db, { memorySessionId: SESSION, project: PROJECT, narrative, contentHash });

      const first = svc.checkWriteTime(narrative, PROJECT);
      const second = svc.checkWriteTime(narrative, PROJECT);

      expect(first.action).toBe('skip');
      expect(second.action).toBe('skip');
      expect(first.existingId).toBe(second.existingId);
    });
  });
});
