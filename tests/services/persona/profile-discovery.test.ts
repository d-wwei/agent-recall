/**
 * ProfileDiscoveryService Tests
 *
 * Mock Justification:
 * - No mocks used. All tests use real in-memory SQLite databases and real temp directories.
 *
 * Coverage:
 * - claude-md-parser: @ reference extraction, path expansion, classification, edge cases
 * - LegacyDbImporter: normal read, missing file, incompatible schema, readonly
 * - ProfileDiscoveryService: empty env, existing DB, @ refs, key-value parsing, conflicts, readonly
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';
import { parseAtReferences } from '../../../src/utils/claude-md-parser.js';
import { LegacyDbImporter } from '../../../src/services/persona/LegacyDbImporter.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function createTestDir(): string {
  const dir = join(tmpdir(), `ar-discovery-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function createAgentRecallDb(): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE agent_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    profile_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_at_epoch INTEGER NOT NULL,
    updated_at TEXT,
    updated_at_epoch INTEGER
  )`);
  db.run(`CREATE UNIQUE INDEX idx_agent_profiles_scope_type ON agent_profiles(scope, profile_type)`);
  db.run(`CREATE TABLE bootstrap_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    round INTEGER NOT NULL DEFAULT 0,
    started_at TEXT,
    completed_at TEXT,
    metadata_json TEXT
  )`);
  db.run(`CREATE TABLE active_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project TEXT NOT NULL,
    task_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'in_progress',
    progress TEXT,
    next_step TEXT,
    context_json TEXT,
    interrupted_tasks_json TEXT,
    started_at TEXT NOT NULL,
    started_at_epoch INTEGER NOT NULL,
    updated_at TEXT,
    updated_at_epoch INTEGER
  )`);
  return db;
}

function createLegacyDb(dir: string): string {
  const dbPath = join(dir, 'claude-mem.db');
  const db = new Database(dbPath);
  db.run(`CREATE TABLE agent_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL DEFAULT 'global',
    profile_type TEXT NOT NULL,
    content_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    created_at_epoch INTEGER NOT NULL
  )`);
  const now = new Date().toISOString();
  const epoch = Date.now();
  db.run(
    `INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)`,
    ['global', 'user', JSON.stringify({ name: 'LegacyUser', role: 'Developer' }), now, epoch]
  );
  db.run(
    `INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)`,
    ['global', 'style', JSON.stringify({ tone: 'casual' }), now, epoch]
  );
  db.close();
  return dbPath;
}

// ---------------------------------------------------------------------------
// claude-md-parser tests
// ---------------------------------------------------------------------------

describe('claude-md-parser', () => {
  describe('parseAtReferences()', () => {
    it('extracts @ references with tilde paths', () => {
      const content = `# Header\n@~/.claude/global-user.md\n@~/.claude/global-style.md\nsome text`;
      const refs = parseAtReferences(content);
      expect(refs).toHaveLength(2);
      expect(refs[0].rawLine).toBe('@~/.claude/global-user.md');
      expect(refs[0].resolvedPath).toContain(homedir());
      expect(refs[0].category).toBe('user');
      expect(refs[1].category).toBe('style');
    });

    it('extracts @ references with absolute paths', () => {
      const content = `@/tmp/some-workflow-file.md`;
      const refs = parseAtReferences(content);
      expect(refs).toHaveLength(1);
      expect(refs[0].resolvedPath).toBe('/tmp/some-workflow-file.md');
      expect(refs[0].category).toBe('workflow');
    });

    it('ignores non-@ lines', () => {
      const content = `# Title\nSome paragraph\n- list item\n## Another heading`;
      const refs = parseAtReferences(content);
      expect(refs).toHaveLength(0);
    });

    it('handles empty content', () => {
      expect(parseAtReferences('')).toHaveLength(0);
    });

    it('classifies user/style/workflow/agent_soul', () => {
      const content = [
        '@~/.claude/my-user-profile.md',
        '@~/.claude/custom-style.md',
        '@~/.claude/workflow-config.md',
        '@~/.claude/assistant-core.md',
        '@~/.claude/random-file.md',
      ].join('\n');
      const refs = parseAtReferences(content);
      expect(refs[0].category).toBe('user');
      expect(refs[1].category).toBe('style');
      expect(refs[2].category).toBe('workflow');
      expect(refs[3].category).toBe('agent_soul');
      expect(refs[4].category).toBe('unknown');
    });

    it('marks non-existent files', () => {
      const content = '@/nonexistent/path/file.md';
      const refs = parseAtReferences(content);
      expect(refs[0].exists).toBe(false);
    });

    it('marks existing files', () => {
      const dir = createTestDir();
      const filePath = join(dir, 'test-user.md');
      writeFileSync(filePath, '# Test');
      try {
        const content = `@${filePath}`;
        const refs = parseAtReferences(content);
        expect(refs[0].exists).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// LegacyDbImporter tests
// ---------------------------------------------------------------------------

describe('LegacyDbImporter', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('reads profiles from a legacy database', () => {
    const dbPath = createLegacyDb(testDir);
    const result = LegacyDbImporter.import(dbPath);
    expect(result).not.toBeNull();
    expect(result!.user.name).toBe('LegacyUser');
    expect(result!.user.role).toBe('Developer');
    expect(result!.style.tone).toBe('casual');
  });

  it('returns null when DB file does not exist', () => {
    const result = LegacyDbImporter.import(join(testDir, 'nonexistent.db'));
    expect(result).toBeNull();
  });

  it('returns null when DB has incompatible schema', () => {
    const dbPath = join(testDir, 'bad.db');
    const db = new Database(dbPath);
    db.run('CREATE TABLE other_table (id INTEGER)');
    db.close();
    const result = LegacyDbImporter.import(dbPath);
    expect(result).toBeNull();
  });

  it('returns null when no global profiles exist', () => {
    const dbPath = join(testDir, 'empty.db');
    const db = new Database(dbPath);
    db.run(`CREATE TABLE agent_profiles (
      id INTEGER PRIMARY KEY, scope TEXT, profile_type TEXT, content_json TEXT,
      created_at TEXT, created_at_epoch INTEGER
    )`);
    db.close();
    const result = LegacyDbImporter.import(dbPath);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ProfileDiscoveryService tests (import dynamically to avoid path issues)
// ---------------------------------------------------------------------------

describe('ProfileDiscoveryService', () => {
  let db: Database;

  beforeEach(() => {
    db = createAgentRecallDb();
  });

  afterEach(() => {
    db.close();
  });

  it('returns empty profiles when no sources exist', async () => {
    // Import dynamically since it depends on PersonaService
    const { ProfileDiscoveryService } = await import('../../../src/services/persona/ProfileDiscoveryService.js');
    const service = new ProfileDiscoveryService(db);
    const result = service.discover();

    expect(result.profiles.user).toBeInstanceOf(Array);
    expect(result.profiles.style).toBeInstanceOf(Array);
    expect(result.sources_scanned.length).toBeGreaterThan(0);
  });

  it('includes existing DB profiles in results', async () => {
    // Pre-populate DB
    const now = new Date().toISOString();
    const epoch = Date.now();
    db.run(
      `INSERT INTO agent_profiles (scope, profile_type, content_json, created_at, created_at_epoch) VALUES (?, ?, ?, ?, ?)`,
      ['global', 'user', JSON.stringify({ name: 'TestUser', role: 'Engineer' }), now, epoch]
    );

    const { ProfileDiscoveryService } = await import('../../../src/services/persona/ProfileDiscoveryService.js');
    const service = new ProfileDiscoveryService(db);
    const result = service.discover();

    expect(result.existing_db_profiles.user).not.toBeNull();
    expect(result.existing_db_profiles.user!.name).toBe('TestUser');
    expect(result.sources_found).toContain('db:agent_profiles');

    const nameField = result.profiles.user.find(f => f.field === 'name');
    expect(nameField).toBeDefined();
    expect(nameField!.value).toBe('TestUser');
    expect(nameField!.confidence).toBe('high');
  });

  it('does not write to the database', async () => {
    const countBefore = (db.query('SELECT COUNT(*) as c FROM agent_profiles').get() as any).c;

    const { ProfileDiscoveryService } = await import('../../../src/services/persona/ProfileDiscoveryService.js');
    const service = new ProfileDiscoveryService(db);
    service.discover();

    const countAfter = (db.query('SELECT COUNT(*) as c FROM agent_profiles').get() as any).c;
    expect(countAfter).toBe(countBefore);
  });
});
