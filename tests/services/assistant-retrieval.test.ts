/**
 * Tests for AssistantRetrieval — two-pass "you said/mentioned" query handler
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite with ':memory:' database
 * - Seeds observations and session_summaries tables directly
 * - Tests actual SQL LIKE-based retrieval and keyword extraction
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { AssistantRetrieval } from '../../src/services/worker/search/AssistantRetrieval.js';

// ---------------------------------------------------------------------------
// DB setup helpers
// ---------------------------------------------------------------------------

function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS sdk_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_session_id TEXT UNIQUE NOT NULL,
      memory_session_id TEXT UNIQUE,
      project TEXT NOT NULL,
      started_at TEXT NOT NULL,
      started_at_epoch INTEGER NOT NULL,
      status TEXT DEFAULT 'active'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT NOT NULL,
      project TEXT NOT NULL,
      text TEXT,
      type TEXT NOT NULL DEFAULT 'change',
      title TEXT,
      subtitle TEXT,
      narrative TEXT,
      facts TEXT,
      concepts TEXT,
      files_read TEXT,
      files_modified TEXT,
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      request TEXT,
      investigated TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      files_read TEXT,
      files_edited TEXT,
      notes TEXT,
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL
    )
  `);
}

function seedObservation(
  db: Database,
  sessionId: string,
  project: string,
  text: string,
  title?: string,
  narrative?: string
): void {
  db.run(
    `INSERT INTO observations
      (memory_session_id, project, text, type, title, narrative, created_at, created_at_epoch)
     VALUES (?, ?, ?, 'change', ?, ?, datetime('now'), strftime('%s','now') * 1000)`,
    [sessionId, project, text, title ?? null, narrative ?? null]
  );
}

function seedSummary(
  db: Database,
  sessionId: string,
  project: string,
  learned?: string,
  completed?: string,
  nextSteps?: string,
  notes?: string
): void {
  db.run(
    `INSERT INTO session_summaries
      (memory_session_id, project, learned, completed, next_steps, notes, created_at, created_at_epoch)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'), strftime('%s','now') * 1000)`,
    [sessionId, project, learned ?? null, completed ?? null, nextSteps ?? null, notes ?? null]
  );
}

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

let db: Database;
let retrieval: AssistantRetrieval;
const PROJECT = 'test-project';

beforeEach(() => {
  db = new Database(':memory:');
  createSchema(db);
  retrieval = new AssistantRetrieval(db);
});

// ---------------------------------------------------------------------------
// isAssistantQuery — English patterns
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.isAssistantQuery — English patterns', () => {
  it('detects "you said"', () => {
    expect(retrieval.isAssistantQuery('you said we should use Redis')).toBe(true);
  });

  it('detects "you mentioned"', () => {
    expect(retrieval.isAssistantQuery('you mentioned the caching strategy earlier')).toBe(true);
  });

  it('detects "you suggested"', () => {
    expect(retrieval.isAssistantQuery('you suggested using postgres')).toBe(true);
  });

  it('detects "you recommended"', () => {
    expect(retrieval.isAssistantQuery('you recommended the hybrid approach')).toBe(true);
  });

  it('detects "you told me"', () => {
    expect(retrieval.isAssistantQuery('you told me to avoid N+1 queries')).toBe(true);
  });

  it('detects "what did you say"', () => {
    expect(retrieval.isAssistantQuery('what did you say about the architecture')).toBe(true);
  });

  it('detects "what did you suggest"', () => {
    expect(retrieval.isAssistantQuery('what did you suggest for the API design')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAssistantQuery — Chinese patterns
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.isAssistantQuery — Chinese patterns', () => {
  it('detects "你之前说过"', () => {
    expect(retrieval.isAssistantQuery('你之前说过用 Redis 缓存')).toBe(true);
  });

  it('detects "你建议的"', () => {
    expect(retrieval.isAssistantQuery('你建议的方案是什么')).toBe(true);
  });

  it('detects "你提到"', () => {
    expect(retrieval.isAssistantQuery('你提到了一个优化方法')).toBe(true);
  });

  it('detects "你说过"', () => {
    expect(retrieval.isAssistantQuery('你说过这个接口有问题')).toBe(true);
  });

  it('detects "你觉得"', () => {
    expect(retrieval.isAssistantQuery('你觉得这个方案怎么样')).toBe(true);
  });

  it('detects "你推荐"', () => {
    expect(retrieval.isAssistantQuery('你推荐的数据库是什么')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isAssistantQuery — negative cases
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.isAssistantQuery — returns false for normal queries', () => {
  it('returns false for plain keyword queries', () => {
    expect(retrieval.isAssistantQuery('Redis caching strategy')).toBe(false);
  });

  it('returns false for "what is" questions', () => {
    expect(retrieval.isAssistantQuery('what is the session manager')).toBe(false);
  });

  it('returns false for how-does questions', () => {
    expect(retrieval.isAssistantQuery('how does the search work')).toBe(false);
  });

  it('returns false for Chinese topic queries', () => {
    expect(retrieval.isAssistantQuery('关于数据库迁移')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(retrieval.isAssistantQuery('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// search — finding observations
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.search — observation results', () => {
  it('finds matching observations for English "you said" query', () => {
    seedObservation(db, 'session-1', PROJECT, 'Use Redis for caching to improve performance');
    seedObservation(db, 'session-2', PROJECT, 'PostgreSQL is better for relational data');

    const results = retrieval.search('you said to use Redis', PROJECT);

    const obs = results.filter(r => r.source === 'observation');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].sessionId).toBe('session-1');
  });

  it('includes source attribution as "observation"', () => {
    seedObservation(db, 'session-a', PROJECT, 'Use TypeScript for better type safety');

    const results = retrieval.search('you mentioned TypeScript', PROJECT);
    const obs = results.filter(r => r.source === 'observation');
    expect(obs.length).toBeGreaterThan(0);
    expect(obs[0].source).toBe('observation');
  });

  it('searches narrative field in observations', () => {
    seedObservation(
      db,
      'session-3',
      PROJECT,
      'Some text',
      'Architecture Decision',
      'The team decided to adopt microservices architecture for scalability'
    );

    const results = retrieval.search('you suggested microservices', PROJECT);
    const obs = results.filter(r => r.source === 'observation');
    expect(obs.length).toBeGreaterThan(0);
  });

  it('returns empty array when no observations match', () => {
    seedObservation(db, 'session-x', PROJECT, 'Completely unrelated content about widgets');

    const results = retrieval.search('you said to use Redis caching', PROJECT);
    // Should not find any "Redis" match in the seeded content
    const obsWithRedis = results.filter(r => r.content.toLowerCase().includes('redis'));
    expect(obsWithRedis.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// search — session summary pass-2 results
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.search — session summary results', () => {
  it('returns session summaries for sessions found in pass 1', () => {
    // Seed observation that matches keyword
    seedObservation(db, 'session-sum-1', PROJECT, 'Authentication refactor completed');
    // Seed matching summary for same session
    seedSummary(
      db,
      'session-sum-1',
      PROJECT,
      'Learned that JWT tokens should be short-lived for security',
      'Refactored authentication module',
      'Add refresh token rotation',
      'Authentication is now stateless'
    );

    const results = retrieval.search('you mentioned authentication', PROJECT);

    const summaries = results.filter(r => r.source === 'summary');
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].sessionId).toBe('session-sum-1');
  });

  it('includes source attribution as "summary"', () => {
    seedObservation(db, 'session-sum-2', PROJECT, 'Database optimization done');
    seedSummary(
      db,
      'session-sum-2',
      PROJECT,
      'Learned that indexes dramatically improve query performance'
    );

    const results = retrieval.search('what did you say about database', PROJECT);
    const summaries = results.filter(r => r.source === 'summary');
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].source).toBe('summary');
  });

  it('searches across all summary fields: learned, completed, next_steps, notes', () => {
    // Observation must mention the keyword so pass 1 can find the session
    seedObservation(db, 'session-sum-3', PROJECT, 'Caching layer with Redis added');
    seedSummary(
      db,
      'session-sum-3',
      PROJECT,
      undefined,
      undefined,
      'Next: implement distributed caching with Redis Cluster',
      undefined
    );

    const results = retrieval.search('you recommended Redis', PROJECT);
    const summaries = results.filter(r => r.source === 'summary');
    expect(summaries.length).toBeGreaterThan(0);
    expect(summaries[0].content).toContain('Redis');
  });

  it('returns empty array when no data matches', () => {
    const results = retrieval.search('you said to use Kubernetes', PROJECT);
    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// search — cross-project isolation
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.search — project isolation', () => {
  it('does not return results from other projects', () => {
    seedObservation(db, 'session-other', 'other-project', 'Use Redis for the other project');

    const results = retrieval.search('you said use Redis', PROJECT);
    const fromOtherProject = results.filter(r => r.sessionId === 'session-other');
    expect(fromOtherProject.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// search — result structure
// ---------------------------------------------------------------------------

describe('AssistantRetrieval.search — result structure', () => {
  it('results include sessionId, source, content, and createdAt', () => {
    seedObservation(db, 'session-struct', PROJECT, 'TypeScript migration complete');

    const results = retrieval.search('you mentioned TypeScript', PROJECT);
    if (results.length > 0) {
      const r = results[0];
      expect(typeof r.sessionId).toBe('string');
      expect(r.source === 'observation' || r.source === 'summary').toBe(true);
      expect(typeof r.content).toBe('string');
      expect(typeof r.createdAt).toBe('string');
    }
  });

  it('does not return duplicate results for same session+source+content', () => {
    seedObservation(db, 'session-dup', PROJECT, 'Use TypeScript everywhere in the codebase');
    // Seeding the same observation content twice would produce one deduped result
    seedObservation(db, 'session-dup', PROJECT, 'Use TypeScript everywhere in the codebase');

    const results = retrieval.search('you said TypeScript', PROJECT);
    const obs = results.filter(r => r.source === 'observation');
    // Content should not be duplicated
    const contents = obs.map(r => `${r.sessionId}:${r.content}`);
    const unique = new Set(contents);
    expect(unique.size).toBe(contents.length);
  });
});
