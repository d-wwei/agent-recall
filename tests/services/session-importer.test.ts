/**
 * Tests for SessionImporter
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite in-memory DB with full schema migrations
 * - Tests actual SQL queries and session/observation creation
 *
 * Value: Validates JSONL parsing, session splitting (30min gap), observation
 * extraction from assistant messages, and ImportResult counts.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import {
  SessionImporter,
  extractConcepts,
  type ImportRecord,
  type ImportResult,
} from '../../src/services/worker/SessionImporter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoOffset(baseIso: string, offsetMs: number): string {
  return new Date(new Date(baseIso).getTime() + offsetMs).toISOString();
}

function countRows(db: Database, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) as n FROM ${table}`).get() as { n: number };
  return row.n;
}

function getObservations(db: Database): Array<{ memory_session_id: string; title: string; narrative: string; type: string; concepts: string }> {
  return db.prepare(
    'SELECT memory_session_id, title, narrative, type, concepts FROM observations ORDER BY rowid'
  ).all() as Array<{ memory_session_id: string; title: string; narrative: string; type: string; concepts: string }>;
}

function getSessions(db: Database): Array<{ content_session_id: string; project: string }> {
  return db.prepare(
    'SELECT content_session_id, project FROM sdk_sessions ORDER BY rowid'
  ).all() as Array<{ content_session_id: string; project: string }>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SessionImporter', () => {
  let db: Database;
  let importer: SessionImporter;

  const PROJECT = 'test-project';
  const BASE_TS = '2026-04-01T10:00:00.000Z';

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    importer = new SessionImporter(db);
  });

  afterEach(() => {
    db.close();
  });

  // -------------------------------------------------------------------------
  // extractConcepts (pure utility)
  // -------------------------------------------------------------------------

  describe('extractConcepts', () => {
    it('returns words longer than 5 chars', () => {
      const concepts = extractConcepts('fix bug in authentication module');
      expect(concepts).toContain('authentication');
      expect(concepts).toContain('module');
    });

    it('excludes short words (<=5 chars)', () => {
      const concepts = extractConcepts('small five chars bug');
      expect(concepts).not.toContain('small'); // 5 chars exactly — excluded
      expect(concepts).not.toContain('five');
      expect(concepts).not.toContain('bug');
    });

    it('deduplicates repeated words', () => {
      const concepts = extractConcepts('authentication is about authentication');
      const count = concepts.filter((c) => c === 'authentication').length;
      expect(count).toBe(1);
    });

    it('lowercases all words', () => {
      const concepts = extractConcepts('Authentication Module');
      expect(concepts).toContain('authentication');
      expect(concepts).toContain('module');
    });

    it('returns empty array for empty string', () => {
      expect(extractConcepts('')).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // importConversation — basic
  // -------------------------------------------------------------------------

  describe('importConversation', () => {
    it('returns zero counts for empty records array', () => {
      const result = importer.importConversation([], PROJECT);
      expect(result.sessionsCreated).toBe(0);
      expect(result.observationsCreated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('creates one session for a single conversation', () => {
      const records: ImportRecord[] = [
        { role: 'user', content: 'How does auth work?', timestamp: BASE_TS },
        { role: 'assistant', content: 'Authentication uses JWT tokens stored in memory.', timestamp: isoOffset(BASE_TS, 30_000) },
      ];

      const result = importer.importConversation(records, PROJECT);
      expect(result.sessionsCreated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(countRows(db, 'sdk_sessions')).toBe(1);
    });

    it('creates observations only for assistant messages', () => {
      const records: ImportRecord[] = [
        { role: 'user', content: 'What is middleware?', timestamp: BASE_TS },
        { role: 'assistant', content: 'Middleware processes requests before they reach controllers.', timestamp: isoOffset(BASE_TS, 10_000) },
        { role: 'user', content: 'Can you show an example?', timestamp: isoOffset(BASE_TS, 20_000) },
        { role: 'assistant', content: 'Sure, here is an Express middleware example with callbacks.', timestamp: isoOffset(BASE_TS, 30_000) },
      ];

      const result = importer.importConversation(records, PROJECT);
      expect(result.sessionsCreated).toBe(1);
      expect(result.observationsCreated).toBe(2); // only 2 assistant messages
      expect(countRows(db, 'observations')).toBe(2);
    });

    it('skips user messages — no observations for them', () => {
      const records: ImportRecord[] = [
        { role: 'user', content: 'First question about routing configuration.' },
        { role: 'user', content: 'Second question about middleware setup.' },
      ];
      const result = importer.importConversation(records, PROJECT);
      expect(result.observationsCreated).toBe(0);
      expect(countRows(db, 'observations')).toBe(0);
    });

    it('uses forced sessionId when provided', () => {
      const records: ImportRecord[] = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hello back, welcome to the system!' },
      ];
      const result = importer.importConversation(records, PROJECT, 'my-custom-session');
      expect(result.sessionsCreated).toBe(1);
      const sessions = getSessions(db);
      expect(sessions[0].content_session_id).toBe('my-custom-session');
    });

    it('sets observation type to discovery', () => {
      const records: ImportRecord[] = [
        { role: 'assistant', content: 'Auth uses JWT tokens with refresh mechanism.', timestamp: BASE_TS },
      ];
      importer.importConversation(records, PROJECT);
      const obs = getObservations(db);
      expect(obs[0].type).toBe('discovery');
    });

    it('sets observation title to first 100 chars of content', () => {
      const longContent = 'A'.repeat(150);
      const records: ImportRecord[] = [
        { role: 'assistant', content: longContent, timestamp: BASE_TS },
      ];
      importer.importConversation(records, PROJECT);
      const obs = getObservations(db);
      expect(obs[0].title).toBe('A'.repeat(100));
    });

    it('stores full content as narrative', () => {
      const content = 'Auth uses JWT tokens stored in secure cookies with HttpOnly flag.';
      const records: ImportRecord[] = [
        { role: 'assistant', content, timestamp: BASE_TS },
      ];
      importer.importConversation(records, PROJECT);
      const obs = getObservations(db);
      expect(obs[0].narrative).toBe(content);
    });

    it('stores extracted concepts as JSON array', () => {
      const records: ImportRecord[] = [
        { role: 'assistant', content: 'Authentication requires tokens and verification.', timestamp: BASE_TS },
      ];
      importer.importConversation(records, PROJECT);
      const obs = getObservations(db);
      const concepts = JSON.parse(obs[0].concepts);
      expect(Array.isArray(concepts)).toBe(true);
      expect(concepts).toContain('authentication');
      expect(concepts).toContain('requires');
      expect(concepts).toContain('tokens');
      expect(concepts).toContain('verification');
    });
  });

  // -------------------------------------------------------------------------
  // importConversation — session splitting on 30-min gap
  // -------------------------------------------------------------------------

  describe('session splitting', () => {
    it('creates one session when all messages are within 30 minutes', () => {
      const records: ImportRecord[] = [
        { role: 'user', content: 'question one', timestamp: BASE_TS },
        { role: 'assistant', content: 'answer one with details', timestamp: isoOffset(BASE_TS, 10 * 60_000) },
        { role: 'user', content: 'question two', timestamp: isoOffset(BASE_TS, 20 * 60_000) },
        { role: 'assistant', content: 'answer two with explanation', timestamp: isoOffset(BASE_TS, 29 * 60_000) },
      ];

      const result = importer.importConversation(records, PROJECT);
      expect(result.sessionsCreated).toBe(1);
      expect(countRows(db, 'sdk_sessions')).toBe(1);
    });

    it('creates two sessions when gap exceeds 30 minutes', () => {
      const T1 = BASE_TS;
      // Last msg of session 1 is at T1+1min; T2 must be >30min after that,
      // so offset from BASE_TS must be > 31min. Use 32min to be safe.
      const T2 = isoOffset(BASE_TS, 32 * 60_000);

      const records: ImportRecord[] = [
        { role: 'user', content: 'first session question', timestamp: T1 },
        { role: 'assistant', content: 'first session answer with details', timestamp: isoOffset(T1, 1 * 60_000) },
        { role: 'user', content: 'second session question', timestamp: T2 },
        { role: 'assistant', content: 'second session answer with explanation', timestamp: isoOffset(T2, 1 * 60_000) },
      ];

      const result = importer.importConversation(records, PROJECT);
      expect(result.sessionsCreated).toBe(2);
      expect(result.observationsCreated).toBe(2);
      expect(countRows(db, 'sdk_sessions')).toBe(2);
    });

    it('does NOT split sessions when forced sessionId is provided', () => {
      const T1 = BASE_TS;
      const T2 = isoOffset(BASE_TS, 60 * 60_000); // 1 hour later

      const records: ImportRecord[] = [
        { role: 'user', content: 'first question', timestamp: T1 },
        { role: 'assistant', content: 'first answer with detail', timestamp: isoOffset(T1, 1_000) },
        { role: 'user', content: 'second question', timestamp: T2 },
        { role: 'assistant', content: 'second answer with detail', timestamp: isoOffset(T2, 1_000) },
      ];

      const result = importer.importConversation(records, PROJECT, 'forced-session-id');
      expect(result.sessionsCreated).toBe(1);
      expect(countRows(db, 'sdk_sessions')).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // importJsonl
  // -------------------------------------------------------------------------

  describe('importJsonl', () => {
    it('returns zero counts for empty string', () => {
      const result = importer.importJsonl('', PROJECT);
      expect(result.sessionsCreated).toBe(0);
      expect(result.observationsCreated).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('returns zero counts for whitespace-only string', () => {
      const result = importer.importJsonl('   \n  \n  ', PROJECT);
      expect(result.sessionsCreated).toBe(0);
      expect(result.observationsCreated).toBe(0);
    });

    it('parses valid JSONL and creates sessions + observations', () => {
      const jsonl = [
        JSON.stringify({ role: 'user', content: 'How does routing work?', timestamp: BASE_TS }),
        JSON.stringify({ role: 'assistant', content: 'Routing maps URLs to controllers.', timestamp: isoOffset(BASE_TS, 30_000) }),
      ].join('\n');

      const result = importer.importJsonl(jsonl, PROJECT);
      expect(result.sessionsCreated).toBe(1);
      expect(result.observationsCreated).toBe(1);
      expect(result.errors).toHaveLength(0);
    });

    it('skips malformed JSON lines and records error', () => {
      const jsonl = [
        JSON.stringify({ role: 'user', content: 'valid question', timestamp: BASE_TS }),
        'not valid json {{{',
        JSON.stringify({ role: 'assistant', content: 'valid answer here.', timestamp: isoOffset(BASE_TS, 10_000) }),
      ].join('\n');

      const result = importer.importJsonl(jsonl, PROJECT);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/invalid JSON/i);
      // Valid lines still processed
      expect(result.sessionsCreated).toBe(1);
      expect(result.observationsCreated).toBe(1);
    });

    it('skips lines with invalid role and records error', () => {
      const jsonl = [
        JSON.stringify({ role: 'system', content: 'you are helpful', timestamp: BASE_TS }),
        JSON.stringify({ role: 'assistant', content: 'hello there, how can I assist you.', timestamp: isoOffset(BASE_TS, 5_000) }),
      ].join('\n');

      const result = importer.importJsonl(jsonl, PROJECT);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/invalid role/i);
      // Assistant message still processed
      expect(result.observationsCreated).toBe(1);
    });

    it('handles multiple JSONL sessions split by 30-min gap', () => {
      const T1 = BASE_TS;
      // Session 1 last msg at T1+1min; T2 must be >30min after that → use 32min
      const T2 = isoOffset(BASE_TS, 32 * 60_000);

      const jsonl = [
        JSON.stringify({ role: 'user', content: 'session one question', timestamp: T1 }),
        JSON.stringify({ role: 'assistant', content: 'session one answer detail.', timestamp: isoOffset(T1, 60_000) }),
        JSON.stringify({ role: 'user', content: 'session two question', timestamp: T2 }),
        JSON.stringify({ role: 'assistant', content: 'session two answer detail.', timestamp: isoOffset(T2, 60_000) }),
      ].join('\n');

      const result = importer.importJsonl(jsonl, PROJECT);
      expect(result.sessionsCreated).toBe(2);
      expect(result.observationsCreated).toBe(2);
      expect(result.errors).toHaveLength(0);
    });

    it('generated session IDs start with import-', () => {
      const jsonl = JSON.stringify({ role: 'user', content: 'test question here', timestamp: BASE_TS });
      importer.importJsonl(jsonl, PROJECT);
      const sessions = getSessions(db);
      expect(sessions[0].content_session_id).toMatch(/^import-/);
    });

    it('stores the correct project on sessions', () => {
      const jsonl = JSON.stringify({ role: 'user', content: 'question', timestamp: BASE_TS });
      importer.importJsonl(jsonl, 'my-project');
      const sessions = getSessions(db);
      expect(sessions[0].project).toBe('my-project');
    });
  });
});
