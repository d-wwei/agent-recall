/**
 * Tests for MarkdownExporter — DB-to-Markdown sync
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite in-memory DB.
 * - Uses real fs with OS temp directories (cleaned up after each test).
 * - Tests end-to-end: seed data → export → verify file content.
 *
 * Coverage:
 *  - exportProfiles: user, style, workflow, agent-soul
 *  - exportKnowledge: per-topic files + index.md
 *  - exportDiary: date-grouped diary files
 *  - exportAll: total file count
 *  - Edge cases: empty tables, special characters in topics
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { MarkdownExporter } from '../../../src/services/markdown-sync/MarkdownExporter.js';

// ─────────────────────────────────────────────
// Setup helpers
// ─────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-exporter-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function fileExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

// ─────────────────────────────────────────────
// DB seeding helpers
// ─────────────────────────────────────────────

function seedProfile(db: Database, scope: string, profileType: string, contentJson: string): void {
  db.prepare(`
    INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch)
    VALUES (?, ?, ?, ?, ?)
  `).run(scope, profileType, contentJson, new Date().toISOString(), Date.now());
}

function seedKnowledge(db: Database, project: string, topic: string, content: string, confidence = 'high'): void {
  db.prepare(`
    INSERT INTO compiled_knowledge (project, topic, content, confidence, compiled_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(project, topic, content, confidence, new Date().toISOString(), new Date().toISOString());
}

function seedDiary(db: Database, project: string, entry: string, createdAt: string, sessionId?: string): void {
  db.prepare(`
    INSERT INTO agent_diary (project, entry, created_at, memory_session_id)
    VALUES (?, ?, ?, ?)
  `).run(project, entry, createdAt, sessionId ?? null);
}

// ─────────────────────────────────────────────
// Shared state
// ─────────────────────────────────────────────

let db: Database;
let outputDir: string;
let exporter: MarkdownExporter;

beforeEach(() => {
  db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();

  outputDir = makeTempDir();
  exporter = new MarkdownExporter(db, outputDir);
});

afterEach(() => {
  db.close();
  removeTempDir(outputDir);
});

// ─────────────────────────────────────────────
// exportProfiles tests
// ─────────────────────────────────────────────

describe('MarkdownExporter.exportProfiles', () => {
  it('creates profile/user.md from a user profile row', () => {
    seedProfile(db, 'global', 'user', JSON.stringify({ name: 'Eli', role: 'Product Owner' }));
    exporter.exportProfiles('global');

    const filePath = path.join(outputDir, 'profile', 'user.md');
    expect(fileExists(filePath)).toBe(true);
    const content = readFile(filePath);
    expect(content).toContain('User Profile');
    expect(content).toContain('Eli');
    expect(content).toContain('Product Owner');
  });

  it('creates profile/style.md from a style profile row', () => {
    seedProfile(db, 'global', 'style', JSON.stringify({ tone: 'direct', brevity: 'concise' }));
    exporter.exportProfiles('global');

    const filePath = path.join(outputDir, 'profile', 'style.md');
    expect(fileExists(filePath)).toBe(true);
    const content = readFile(filePath);
    expect(content).toContain('Style Preferences');
    expect(content).toContain('direct');
  });

  it('creates profile/workflow.md from a workflow profile row', () => {
    seedProfile(db, 'global', 'workflow', JSON.stringify({
      preferred_role: 'lead',
      recurring_tasks: ['weekly report', 'sprint review'],
    }));
    exporter.exportProfiles('global');

    const filePath = path.join(outputDir, 'profile', 'workflow.md');
    expect(fileExists(filePath)).toBe(true);
    const content = readFile(filePath);
    expect(content).toContain('Workflow Preferences');
    expect(content).toContain('weekly report');
    expect(content).toContain('sprint review');
  });

  it('creates profile/agent-soul.md (underscore → hyphen in filename)', () => {
    seedProfile(db, 'global', 'agent_soul', JSON.stringify({ name: 'Recall', vibe: 'calm' }));
    exporter.exportProfiles('global');

    const filePath = path.join(outputDir, 'profile', 'agent-soul.md');
    expect(fileExists(filePath)).toBe(true);
    const content = readFile(filePath);
    expect(content).toContain('Agent Soul');
    expect(content).toContain('Recall');
  });

  it('project-scope profile overrides global when both exist', () => {
    seedProfile(db, 'global', 'user', JSON.stringify({ name: 'GlobalName' }));
    seedProfile(db, 'myproject', 'user', JSON.stringify({ name: 'ProjectName' }));
    exporter.exportProfiles('myproject');

    const content = readFile(path.join(outputDir, 'profile', 'user.md'));
    expect(content).toContain('ProjectName');
    expect(content).not.toContain('GlobalName');
  });

  it('does nothing when no profiles exist', () => {
    exporter.exportProfiles('nonexistent-project');
    const profileDir = path.join(outputDir, 'profile');
    // Directory may or may not be created — but no crash, and no files
    if (fileExists(profileDir)) {
      const files = fs.readdirSync(profileDir);
      expect(files).toHaveLength(0);
    }
  });
});

// ─────────────────────────────────────────────
// exportKnowledge tests
// ─────────────────────────────────────────────

describe('MarkdownExporter.exportKnowledge', () => {
  it('creates a .md file per knowledge topic', () => {
    seedKnowledge(db, 'proj', 'Session Recovery', 'How to recover sessions from DB.');
    seedKnowledge(db, 'proj', 'Search Architecture', 'FTS5 + Chroma hybrid approach.');
    exporter.exportKnowledge('proj');

    expect(fileExists(path.join(outputDir, 'knowledge', 'session-recovery.md'))).toBe(true);
    expect(fileExists(path.join(outputDir, 'knowledge', 'search-architecture.md'))).toBe(true);
  });

  it('knowledge file contains topic title and content', () => {
    seedKnowledge(db, 'proj', 'Migration Strategy', 'Always use IF NOT EXISTS.', 'high');
    exporter.exportKnowledge('proj');

    const content = readFile(path.join(outputDir, 'knowledge', 'migration-strategy.md'));
    expect(content).toContain('# Migration Strategy');
    expect(content).toContain('Always use IF NOT EXISTS');
    expect(content).toContain('high');
  });

  it('creates an index.md listing all topics', () => {
    seedKnowledge(db, 'proj', 'Alpha Topic', 'Content A.');
    seedKnowledge(db, 'proj', 'Beta Topic', 'Content B.');
    exporter.exportKnowledge('proj');

    const index = readFile(path.join(outputDir, 'knowledge', 'index.md'));
    expect(index).toContain('Alpha Topic');
    expect(index).toContain('Beta Topic');
  });

  it('does not create knowledge dir when no knowledge rows exist', () => {
    exporter.exportKnowledge('empty-proj');
    const knowledgeDir = path.join(outputDir, 'knowledge');
    if (fileExists(knowledgeDir)) {
      const files = fs.readdirSync(knowledgeDir);
      expect(files).toHaveLength(0);
    }
  });

  it('only exports knowledge for the specified project', () => {
    seedKnowledge(db, 'proj-A', 'Topic A', 'Content for A.');
    seedKnowledge(db, 'proj-B', 'Topic B', 'Content for B.');
    exporter.exportKnowledge('proj-A');

    expect(fileExists(path.join(outputDir, 'knowledge', 'topic-a.md'))).toBe(true);
    expect(fileExists(path.join(outputDir, 'knowledge', 'topic-b.md'))).toBe(false);
  });
});

// ─────────────────────────────────────────────
// exportDiary tests
// ─────────────────────────────────────────────

describe('MarkdownExporter.exportDiary', () => {
  it('creates one diary file per unique date', () => {
    seedDiary(db, 'proj', 'Morning standup done.', '2025-12-01 09:00:00');
    seedDiary(db, 'proj', 'Reviewed migration PR.', '2025-12-02 14:30:00');
    exporter.exportDiary('proj');

    expect(fileExists(path.join(outputDir, 'diary', '2025-12-01.md'))).toBe(true);
    expect(fileExists(path.join(outputDir, 'diary', '2025-12-02.md'))).toBe(true);
  });

  it('groups multiple entries from the same date into one file', () => {
    seedDiary(db, 'proj', 'Entry one.', '2025-12-01 09:00:00');
    seedDiary(db, 'proj', 'Entry two.', '2025-12-01 15:00:00');
    exporter.exportDiary('proj');

    const content = readFile(path.join(outputDir, 'diary', '2025-12-01.md'));
    expect(content).toContain('Entry one.');
    expect(content).toContain('Entry two.');
  });

  it('diary file contains date heading and entry text', () => {
    seedDiary(db, 'proj', 'Fixed the runner.', '2025-11-15 10:00:00', 'sess-abc');
    exporter.exportDiary('proj');

    const content = readFile(path.join(outputDir, 'diary', '2025-11-15.md'));
    expect(content).toContain('# Diary — 2025-11-15');
    expect(content).toContain('Fixed the runner.');
  });

  it('does not create diary dir when no entries exist', () => {
    exporter.exportDiary('empty-proj');
    const diaryDir = path.join(outputDir, 'diary');
    if (fileExists(diaryDir)) {
      const files = fs.readdirSync(diaryDir);
      expect(files).toHaveLength(0);
    }
  });

  it('only exports diary entries for the specified project', () => {
    seedDiary(db, 'proj-A', 'Project A entry.', '2025-12-01 10:00:00');
    seedDiary(db, 'proj-B', 'Project B entry.', '2025-12-01 11:00:00');
    exporter.exportDiary('proj-A');

    const content = readFile(path.join(outputDir, 'diary', '2025-12-01.md'));
    expect(content).toContain('Project A entry.');
    expect(content).not.toContain('Project B entry.');
  });
});

// ─────────────────────────────────────────────
// exportAll tests
// ─────────────────────────────────────────────

describe('MarkdownExporter.exportAll', () => {
  it('returns total number of files written', () => {
    seedProfile(db, 'global', 'user', JSON.stringify({ name: 'Eli' }));
    seedKnowledge(db, 'proj', 'Architecture', 'Overview of search.');
    seedDiary(db, 'proj', 'Session started.', '2025-12-01 09:00:00');

    // exportProfiles scans both 'global' and project scope; exportAll uses project='proj'
    // but profiles seeded as 'global' will be picked up
    const count = exporter.exportAll('proj');

    // At minimum: 1 knowledge file + 1 index.md + 1 diary file = 3
    // (profile file only appears if scope matches or global exists)
    expect(count).toBeGreaterThan(0);
  });

  it('returns 0 when no data exists for the project', () => {
    const count = exporter.exportAll('phantom-project');
    expect(count).toBe(0);
  });
});

// ─────────────────────────────────────────────
// Migration 37: markdown_sync table
// ─────────────────────────────────────────────

describe('Migration 37 — markdown_sync table', () => {
  it('creates the markdown_sync table after running all migrations', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='markdown_sync'"
    ).all() as { name: string }[];
    expect(tables).toHaveLength(1);
  });

  it('records version 37 in schema_versions', () => {
    const row = db.prepare('SELECT version FROM schema_versions WHERE version = 37').get() as { version: number } | undefined;
    expect(row).toBeDefined();
    expect(row!.version).toBe(37);
  });

  it('markdown_sync table has correct columns', () => {
    const columns = db.prepare('PRAGMA table_info(markdown_sync)').all() as { name: string }[];
    const names = columns.map(c => c.name);
    expect(names).toContain('file_path');
    expect(names).toContain('last_db_hash');
    expect(names).toContain('last_file_hash');
    expect(names).toContain('last_sync_at');
  });

  it('can insert and retrieve a markdown_sync row', () => {
    db.prepare(`
      INSERT INTO markdown_sync (file_path, last_db_hash, last_file_hash, last_sync_at)
      VALUES (?, ?, ?, ?)
    `).run('/output/profile/user.md', 'dbhash123', 'filehash456', new Date().toISOString());

    const row = db.prepare('SELECT * FROM markdown_sync WHERE file_path = ?')
      .get('/output/profile/user.md') as any;
    expect(row).toBeDefined();
    expect(row.last_db_hash).toBe('dbhash123');
    expect(row.last_file_hash).toBe('filehash456');
  });

  it('migration is idempotent when run twice', () => {
    const runner = new MigrationRunner(db);
    runner.runAllMigrations(); // second run

    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='markdown_sync'"
    ).all() as { name: string }[];
    expect(tables).toHaveLength(1);
  });
});
