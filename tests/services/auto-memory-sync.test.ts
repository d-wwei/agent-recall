/**
 * Tests for AutoMemorySync — incremental sync of ~/.claude/memory/*.md files
 * into Agent Recall's database.
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual SQL
 * - Uses real temp directories for memory fixture files
 * - Tests full sync pipeline: scan, hash, parse, upsert, skip
 *
 * Value: Ensures Claude Code auto memory entries flow into Agent Recall on
 * each SessionStart without redundant re-imports.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AutoMemorySync } from '../../src/services/sync/AutoMemorySync.js';

// ---------------------------------------------------------------------------
// Helpers: minimal in-memory DB with required tables
// ---------------------------------------------------------------------------

function setupTestDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');

  // sync_state table (migration 31)
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_state (
      file_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL,
      source_type TEXT NOT NULL,
      last_sync_at TEXT NOT NULL
    )
  `);

  // agent_profiles table (migration 24)
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL DEFAULT 'global',
      profile_type TEXT NOT NULL,
      content_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT,
      updated_at_epoch INTEGER,
      UNIQUE(scope, profile_type)
    )
  `);

  // observations table (minimal required columns)
  db.run(`
    CREATE TABLE IF NOT EXISTS observations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT,
      project TEXT NOT NULL DEFAULT '',
      text TEXT,
      type TEXT NOT NULL DEFAULT 'note',
      title TEXT,
      subtitle TEXT,
      facts TEXT DEFAULT '[]',
      narrative TEXT,
      concepts TEXT DEFAULT '[]',
      files_read TEXT DEFAULT '[]',
      files_modified TEXT DEFAULT '[]',
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      content_hash TEXT,
      confidence TEXT DEFAULT 'medium',
      tags TEXT DEFAULT '[]',
      has_preference INTEGER DEFAULT 0,
      event_date TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    )
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Helpers: create memory fixture files
// ---------------------------------------------------------------------------

function writeMemoryFile(dir: string, filename: string, content: string): string {
  const filePath = join(dir, filename);
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function makeUserFile(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
type: user
---

${body}`;
}

function makeFeedbackFile(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
type: feedback
---

${body}`;
}

function makeProjectFile(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
type: project
---

${body}`;
}

function makeReferenceFile(name: string, description: string, body: string): string {
  return `---
name: ${name}
description: ${description}
type: reference
---

${body}`;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AutoMemorySync', () => {
  let db: Database;
  let memoryDir: string;

  beforeEach(() => {
    db = setupTestDb();
    memoryDir = mkdtempSync(join(tmpdir(), 'auto-memory-sync-test-'));
  });

  afterEach(() => {
    db.close();
    rmSync(memoryDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // syncIncremental — user type
  // -------------------------------------------------------------------------

  describe('syncIncremental() - user type', () => {
    it('syncs a user-type memory file to agent_profiles', () => {
      writeMemoryFile(
        memoryDir,
        'user-profile.md',
        makeUserFile('User Profile', 'Basic user info', 'Name: Eli\nRole: Product Owner')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Check agent_profiles row was created
      const row = db.prepare(
        "SELECT * FROM agent_profiles WHERE scope = 'global' AND profile_type = 'user'"
      ).get() as { content_json: string } | undefined;

      expect(row).toBeDefined();
      const content = JSON.parse(row!.content_json);
      expect(content.raw).toContain('Name: Eli');
    });

    it('upserts when user profile already exists', () => {
      const file = writeMemoryFile(
        memoryDir,
        'user-profile.md',
        makeUserFile('User Profile', 'Basic user info', 'Name: Eli')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      sync.syncIncremental();

      // Update file content
      writeFileSync(file, makeUserFile('User Profile', 'Updated info', 'Name: Eli\nLocation: Canada'), 'utf-8');

      const result = sync.syncIncremental();
      expect(result.imported).toBe(1);

      // Should have only one profile row (upserted)
      const rows = db.prepare(
        "SELECT * FROM agent_profiles WHERE scope = 'global' AND profile_type = 'user'"
      ).all() as any[];
      expect(rows).toHaveLength(1);
      const content = JSON.parse(rows[0].content_json);
      expect(content.raw).toContain('Location: Canada');
    });
  });

  // -------------------------------------------------------------------------
  // syncIncremental — feedback type
  // -------------------------------------------------------------------------

  describe('syncIncremental() - feedback type', () => {
    it('syncs a feedback-type memory file to observations', () => {
      writeMemoryFile(
        memoryDir,
        'feedback.md',
        makeFeedbackFile('Response Style', 'User prefers concise answers', 'Keep answers short. Avoid bullet lists.')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      // Check observation row was inserted
      const obs = db.prepare(
        "SELECT * FROM observations WHERE type = 'feedback'"
      ).get() as { narrative: string; confidence: string; title: string } | undefined;

      expect(obs).toBeDefined();
      expect(obs!.type ?? (obs as any).type).toBe('feedback');
      expect(obs!.confidence).toBe('high');
      expect(obs!.narrative).toContain('Keep answers short');
    });

    it('stores feedback title from frontmatter name field', () => {
      writeMemoryFile(
        memoryDir,
        'style-feedback.md',
        makeFeedbackFile('My Style Feedback', 'Preferred style notes', 'Use direct tone.')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      sync.syncIncremental();

      const obs = db.prepare(
        "SELECT title FROM observations WHERE type = 'feedback'"
      ).get() as { title: string } | undefined;

      expect(obs).toBeDefined();
      expect(obs!.title).toBe('My Style Feedback');
    });
  });

  // -------------------------------------------------------------------------
  // syncIncremental — project and reference types (skip)
  // -------------------------------------------------------------------------

  describe('syncIncremental() - skipped types', () => {
    it('skips project-type memory files', () => {
      writeMemoryFile(
        memoryDir,
        'my-project.md',
        makeProjectFile('My Project', 'Project context', 'In progress: feature X')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Nothing inserted into DB
      const profiles = db.prepare('SELECT COUNT(*) as c FROM agent_profiles').get() as { c: number };
      const obs = db.prepare('SELECT COUNT(*) as c FROM observations').get() as { c: number };
      expect(profiles.c).toBe(0);
      expect(obs.c).toBe(0);

      // sync_state should NOT record skipped files
      const state = db.prepare('SELECT COUNT(*) as c FROM sync_state').get() as { c: number };
      expect(state.c).toBe(0);
    });

    it('skips reference-type memory files', () => {
      writeMemoryFile(
        memoryDir,
        'reference.md',
        makeReferenceFile('API Reference', 'External API docs', '# API\nSome reference content')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('skips non-.md files', () => {
      writeFileSync(join(memoryDir, 'notes.txt'), 'some text', 'utf-8');
      writeFileSync(join(memoryDir, 'config.json'), '{}', 'utf-8');

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0); // Not even counted as "skipped"
    });
  });

  // -------------------------------------------------------------------------
  // syncIncremental — hash-based deduplication
  // -------------------------------------------------------------------------

  describe('syncIncremental() - hash deduplication', () => {
    it('skips already-synced unchanged files (same hash)', () => {
      const content = makeUserFile('Profile', 'desc', 'Name: Eli');
      writeMemoryFile(memoryDir, 'profile.md', content);

      const sync = new AutoMemorySync(db, memoryDir);

      // First sync
      const first = sync.syncIncremental();
      expect(first.imported).toBe(1);
      expect(first.skipped).toBe(0);

      // Second sync — same content, same hash → skip
      const second = sync.syncIncremental();
      expect(second.imported).toBe(0);
      expect(second.skipped).toBe(1);

      // Only one agent_profiles row total
      const rows = db.prepare('SELECT COUNT(*) as c FROM agent_profiles').get() as { c: number };
      expect(rows.c).toBe(1);
    });

    it('re-syncs when file content changes (different hash)', () => {
      const filePath = writeMemoryFile(
        memoryDir,
        'profile.md',
        makeUserFile('Profile', 'desc', 'Name: Eli')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      sync.syncIncremental();

      // Modify file
      writeFileSync(filePath, makeUserFile('Profile', 'desc', 'Name: Eli\nRole: PM'), 'utf-8');

      const result = sync.syncIncremental();
      expect(result.imported).toBe(1);
      expect(result.skipped).toBe(0);

      // Profile content should be updated
      const row = db.prepare(
        "SELECT content_json FROM agent_profiles WHERE scope = 'global' AND profile_type = 'user'"
      ).get() as { content_json: string };
      expect(JSON.parse(row.content_json).raw).toContain('Role: PM');
    });

    it('updates sync_state hash after re-sync', () => {
      const filePath = writeMemoryFile(
        memoryDir,
        'profile.md',
        makeUserFile('Profile', 'desc', 'v1 content')
      );

      const sync = new AutoMemorySync(db, memoryDir);
      sync.syncIncremental();

      const hashV1 = (db.prepare('SELECT content_hash FROM sync_state WHERE file_path = ?')
        .get(filePath) as { content_hash: string }).content_hash;

      writeFileSync(filePath, makeUserFile('Profile', 'desc', 'v2 content'), 'utf-8');
      sync.syncIncremental();

      const hashV2 = (db.prepare('SELECT content_hash FROM sync_state WHERE file_path = ?')
        .get(filePath) as { content_hash: string }).content_hash;

      expect(hashV1).toBeTruthy();
      expect(hashV2).toBeTruthy();
      expect(hashV1).not.toBe(hashV2);
    });
  });

  // -------------------------------------------------------------------------
  // fullImport
  // -------------------------------------------------------------------------

  describe('fullImport()', () => {
    it('clears sync_state and re-imports all files', () => {
      writeMemoryFile(
        memoryDir,
        'profile.md',
        makeUserFile('Profile', 'desc', 'Name: Eli')
      );

      const sync = new AutoMemorySync(db, memoryDir);

      // First import via syncIncremental
      const first = sync.syncIncremental();
      expect(first.imported).toBe(1);

      // Second incremental — should skip (same hash)
      const skip = sync.syncIncremental();
      expect(skip.skipped).toBe(1);

      // fullImport — should clear sync_state and re-import
      const full = sync.fullImport();
      expect(full.imported).toBe(1);
      expect(full.skipped).toBe(0);
    });

    it('re-imports all types even without content changes', () => {
      writeMemoryFile(memoryDir, 'user.md', makeUserFile('User', 'desc', 'Name: Eli'));
      writeMemoryFile(memoryDir, 'feedback.md', makeFeedbackFile('Feedback', 'desc', 'Be concise'));

      const sync = new AutoMemorySync(db, memoryDir);

      // Incremental first
      sync.syncIncremental();

      // fullImport → re-imports both
      const full = sync.fullImport();
      expect(full.imported).toBe(2);
      expect(full.skipped).toBe(0);
      expect(full.errors).toHaveLength(0);
    });

    it('fullImport clears sync_state table before scanning', () => {
      writeMemoryFile(memoryDir, 'user.md', makeUserFile('User', 'desc', 'Name: Eli'));

      const sync = new AutoMemorySync(db, memoryDir);
      sync.syncIncremental();

      // Manually check sync_state has 1 row
      const before = db.prepare('SELECT COUNT(*) as c FROM sync_state').get() as { c: number };
      expect(before.c).toBe(1);

      // fullImport clears and re-populates
      sync.fullImport();

      const after = db.prepare('SELECT COUNT(*) as c FROM sync_state').get() as { c: number };
      expect(after.c).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('returns empty result when memoryDir is empty', () => {
      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('returns empty result when memoryDir does not exist', () => {
      const nonExistentDir = join(tmpdir(), 'does-not-exist-' + Date.now());
      const sync = new AutoMemorySync(db, nonExistentDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('handles file with missing frontmatter gracefully', () => {
      writeMemoryFile(memoryDir, 'no-frontmatter.md', '# Just a heading\n\nSome content');

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      // No frontmatter means type is unknown → skip
      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('handles file with unknown type gracefully', () => {
      writeMemoryFile(
        memoryDir,
        'unknown.md',
        '---\nname: Test\ndescription: desc\ntype: custom_unknown\n---\n\nBody'
      );

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('handles multiple files of mixed types correctly', () => {
      writeMemoryFile(memoryDir, 'user.md', makeUserFile('User', 'desc', 'Name: Eli'));
      writeMemoryFile(memoryDir, 'feedback.md', makeFeedbackFile('Feedback', 'desc', 'Be concise'));
      writeMemoryFile(memoryDir, 'project.md', makeProjectFile('Project', 'desc', 'Some project'));
      writeMemoryFile(memoryDir, 'ref.md', makeReferenceFile('Ref', 'desc', 'Reference doc'));

      const sync = new AutoMemorySync(db, memoryDir);
      const result = sync.syncIncremental();

      expect(result.imported).toBe(2); // user + feedback
      expect(result.skipped).toBe(2);  // project + reference
      expect(result.errors).toHaveLength(0);
    });
  });
});
