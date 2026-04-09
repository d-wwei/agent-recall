/**
 * Tests for AssistantMigrator — .assistant/ directory to Agent Recall DB migration
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real SQLite with ':memory:' — tests actual migration SQL
 * - Uses real temp directories for .assistant/ fixture files
 * - Tests full migration pipeline: detect, migrate, archive
 *
 * Value: Ensures existing .assistant/ data is not lost when users upgrade to Agent Recall
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { AssistantMigrator } from '../../src/services/migration/AssistantMigrator.js';

// ---------------------------------------------------------------------------
// Helpers: create minimal table schema so the migrator can write to the DB
// ---------------------------------------------------------------------------

function setupTestDb(): Database {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');

  // agent_profiles table (matches actual schema)
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
      confidence REAL,
      tags TEXT DEFAULT '[]',
      has_preference INTEGER DEFAULT 0,
      event_date TEXT,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    )
  `);

  // session_summaries table (minimal required columns)
  db.run(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_session_id TEXT,
      project TEXT NOT NULL DEFAULT '',
      request TEXT,
      investigated TEXT,
      learned TEXT,
      completed TEXT,
      next_steps TEXT,
      notes TEXT,
      prompt_number INTEGER,
      discovery_tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      created_at_epoch INTEGER NOT NULL DEFAULT 0
    )
  `);

  return db;
}

// ---------------------------------------------------------------------------
// Helpers: create fixture .assistant/ directories
// ---------------------------------------------------------------------------

function createAssistantDir(baseDir: string, files: Record<string, string>): void {
  const assistantDir = join(baseDir, '.assistant');
  mkdirSync(assistantDir, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(assistantDir, relPath);
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    if (parentDir !== assistantDir) {
      mkdirSync(parentDir, { recursive: true });
    }
    writeFileSync(fullPath, content, 'utf-8');
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('AssistantMigrator', () => {
  let db: Database;
  let projectDir: string;

  beforeEach(() => {
    db = setupTestDb();
    projectDir = mkdtempSync(join(tmpdir(), 'assistant-migrator-test-'));
  });

  afterEach(() => {
    db.close();
    rmSync(projectDir, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // detect()
  // -------------------------------------------------------------------------

  describe('detect()', () => {
    it('returns true when .assistant/ exists and is not yet migrated', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      expect(migrator.detect()).toBe(true);
    });

    it('returns false when .assistant/ does not exist', () => {
      const migrator = new AssistantMigrator(db, projectDir);
      expect(migrator.detect()).toBe(false);
    });

    it('returns false when .assistant.migrated/ already exists (already migrated)', () => {
      // Create both dirs — simulate a previous migration
      mkdirSync(join(projectDir, '.assistant.migrated'), { recursive: true });
      createAssistantDir(projectDir, { 'USER.md': '# User\nEli' });

      const migrator = new AssistantMigrator(db, projectDir);
      // .assistant.migrated/ exists → already done
      expect(migrator.detect()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // migrate() — profiles
  // -------------------------------------------------------------------------

  describe('migrate() - agent_profiles', () => {
    it('migrates USER.md to agent_profiles with profile_type=user', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User Profile\n\nName: Eli\nRole: Developer',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.profiles).toBeGreaterThanOrEqual(1);
      expect(result.errors).toEqual([]);

      const row = db.prepare(
        "SELECT content_json FROM agent_profiles WHERE scope = 'test-project' AND profile_type = 'user'"
      ).get() as { content_json: string } | undefined;

      expect(row).toBeDefined();
      const content = JSON.parse(row!.content_json);
      expect(content.raw).toContain('Eli');
    });

    it('migrates STYLE.md to agent_profiles with profile_type=style', () => {
      createAssistantDir(projectDir, {
        'STYLE.md': '# Style\n\nTone: concise\nLanguage: English',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.profiles).toBeGreaterThanOrEqual(1);

      const row = db.prepare(
        "SELECT content_json FROM agent_profiles WHERE scope = 'test-project' AND profile_type = 'style'"
      ).get() as { content_json: string } | undefined;

      expect(row).toBeDefined();
      const content = JSON.parse(row!.content_json);
      expect(content.raw).toContain('concise');
    });

    it('migrates WORKFLOW.md to agent_profiles with profile_type=workflow', () => {
      createAssistantDir(projectDir, {
        'WORKFLOW.md': '# Workflow\n\nDaily standup at 9am\nWeekly reviews on Friday',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      const row = db.prepare(
        "SELECT content_json FROM agent_profiles WHERE scope = 'test-project' AND profile_type = 'workflow'"
      ).get() as { content_json: string } | undefined;

      expect(row).toBeDefined();
      const content = JSON.parse(row!.content_json);
      expect(content.raw).toContain('standup');
    });

    it('migrates all three profile files in one call', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
        'STYLE.md': '# Style\nConcise',
        'WORKFLOW.md': '# Workflow\nDaily standups',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.profiles).toBe(3);
    });

    it('skips profile files that do not exist', () => {
      // Only USER.md present
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      // Only 1 profile migrated, no errors
      expect(result.profiles).toBe(1);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // migrate() — MEMORY.md → observations (split by ## headings)
  // -------------------------------------------------------------------------

  describe('migrate() - MEMORY.md to observations', () => {
    it('splits MEMORY.md by ## headings and creates one observation per section', () => {
      createAssistantDir(projectDir, {
        'MEMORY.md': [
          '# Memory',
          '',
          '## Preferred tools',
          'Use bun for TypeScript.',
          'Use ripgrep for search.',
          '',
          '## Project goals',
          'Build a fast recall system.',
          'Support cross-session continuity.',
        ].join('\n'),
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      // 2 sections → 2 observations
      expect(result.observations).toBeGreaterThanOrEqual(2);
      expect(result.errors).toEqual([]);

      const rows = db.prepare(
        "SELECT title, narrative FROM observations WHERE project = 'test-project' ORDER BY id"
      ).all() as Array<{ title: string; narrative: string }>;

      const titles = rows.map(r => r.title);
      expect(titles).toContain('Preferred tools');
      expect(titles).toContain('Project goals');
    });

    it('stores section content in the narrative field', () => {
      createAssistantDir(projectDir, {
        'MEMORY.md': '## Key insight\nThis is the narrative content.',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      migrator.migrate('test-project');

      const row = db.prepare(
        "SELECT narrative FROM observations WHERE project = 'test-project'"
      ).get() as { narrative: string } | undefined;

      expect(row).toBeDefined();
      expect(row!.narrative).toContain('This is the narrative content.');
    });

    it('skips MEMORY.md if it does not exist', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.observations).toBe(0);
    });

    it('tags observations with the project name', () => {
      createAssistantDir(projectDir, {
        'MEMORY.md': '## Fact\nSome important fact.',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      migrator.migrate('test-project');

      const row = db.prepare(
        "SELECT project FROM observations WHERE project = 'test-project'"
      ).get() as { project: string } | undefined;

      expect(row).toBeDefined();
      expect(row!.project).toBe('test-project');
    });
  });

  // -------------------------------------------------------------------------
  // migrate() — memory/projects/*.md → observations
  // -------------------------------------------------------------------------

  describe('migrate() - memory/projects/*.md', () => {
    it('migrates each projects/*.md file as a single observation', () => {
      createAssistantDir(projectDir, {
        'memory/projects/alpha.md': '# Alpha project notes\nGoal: ship by Q2.',
        'memory/projects/beta.md': '# Beta project notes\nStatus: in progress.',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.observations).toBe(2);

      const rows = db.prepare(
        "SELECT title FROM observations WHERE project = 'test-project' ORDER BY title"
      ).all() as Array<{ title: string }>;

      const titles = rows.map(r => r.title);
      expect(titles).toContain('alpha');
      expect(titles).toContain('beta');
    });

    it('skips memory/projects/ if directory does not exist', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.observations).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // migrate() — daily logs are SKIPPED
  // -------------------------------------------------------------------------

  describe('migrate() - daily logs are skipped', () => {
    it('does not migrate memory/daily/*.md files', () => {
      createAssistantDir(projectDir, {
        'memory/daily/2026-04-01.md': '# Daily\nToday I did stuff.',
        'memory/daily/2026-04-02.md': '# Daily\nMore stuff.',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.observations).toBe(0);

      const count = db.prepare(
        "SELECT COUNT(*) as n FROM observations WHERE project = 'test-project'"
      ).get() as { n: number };
      expect(count.n).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // migrate() — runtime/last-session.md → session_summaries
  // -------------------------------------------------------------------------

  describe('migrate() - last-session.md to session_summaries', () => {
    it('migrates runtime/last-session.md as a session summary', () => {
      createAssistantDir(projectDir, {
        'runtime/last-session.md': [
          '# Last Session',
          '',
          'Date: 2026-04-01',
          'Summary: Fixed the broken auth flow.',
          'Next: Add integration tests.',
        ].join('\n'),
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.summaries).toBe(1);
      expect(result.errors).toEqual([]);

      const row = db.prepare(
        "SELECT notes FROM session_summaries WHERE project = 'test-project'"
      ).get() as { notes: string } | undefined;

      expect(row).toBeDefined();
      expect(row!.notes).toContain('Fixed the broken auth flow');
    });

    it('skips last-session.md if it does not exist', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.summaries).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Post-migration: rename .assistant/ → .assistant.migrated/
  // -------------------------------------------------------------------------

  describe('post-migration archiving', () => {
    it('renames .assistant/ to .assistant.migrated/ after migration', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      migrator.migrate('test-project');

      expect(existsSync(join(projectDir, '.assistant'))).toBe(false);
      expect(existsSync(join(projectDir, '.assistant.migrated'))).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency: detect() returns false after migration completes
  // -------------------------------------------------------------------------

  describe('idempotency', () => {
    it('detect() returns false after migration (already migrated)', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      expect(migrator.detect()).toBe(true);

      migrator.migrate('test-project');

      // After rename, detect should return false
      expect(migrator.detect()).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // MigrationResult shape
  // -------------------------------------------------------------------------

  describe('MigrationResult shape', () => {
    it('returns correct counts for a full migration', () => {
      createAssistantDir(projectDir, {
        'USER.md': '# User\nEli',
        'STYLE.md': '# Style\nConcise',
        'WORKFLOW.md': '# Workflow\nDaily standups',
        'MEMORY.md': '## Fact 1\nA.\n\n## Fact 2\nB.',
        'memory/projects/proj.md': '# Proj\nNotes.',
        'runtime/last-session.md': '# Last\nDone.',
      });

      const migrator = new AssistantMigrator(db, projectDir);
      const result = migrator.migrate('test-project');

      expect(result.profiles).toBe(3);       // USER + STYLE + WORKFLOW
      expect(result.observations).toBe(3);   // 2 from MEMORY.md + 1 from projects/
      expect(result.summaries).toBe(1);      // last-session.md
      expect(result.errors).toEqual([]);
    });
  });
});
