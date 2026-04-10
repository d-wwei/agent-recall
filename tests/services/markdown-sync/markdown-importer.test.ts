/**
 * Tests for MarkdownImporter — Markdown-to-DB bidirectional sync
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite in-memory DB with full migration runner.
 * - Uses real fs with OS temp directories (cleaned up after each test).
 * - Tests end-to-end: export -> user edit -> detect -> import -> verify DB.
 *
 * Coverage:
 *  1. No changes detected when files match sync hashes
 *  2. Detects changes when file hash differs from last_file_hash
 *  3. Marks changes as 'conflict' when last_db_hash != last_file_hash
 *  4. Classifies profile files correctly
 *  5. Classifies knowledge files correctly
 *  6. importChanges updates agent_profiles for profile edits
 *  7. importChanges updates compiled_knowledge for knowledge edits
 *  8. importChanges skips conflict changes
 *  9. importChanges updates markdown_sync hashes after import
 * 10. hashContent produces consistent SHA-256 hashes
 * 11. Handles missing files gracefully
 * 12. Returns empty changes when markdown_sync table is empty
 * 13. End-to-end: export -> edit -> detect -> import cycle
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createHash } from 'crypto';
import { MigrationRunner } from '../../../src/services/sqlite/migrations/runner.js';
import { MarkdownImporter } from '../../../src/services/markdown-sync/MarkdownImporter.js';
import { MarkdownExporter } from '../../../src/services/markdown-sync/MarkdownExporter.js';

// ─── Setup helpers ───────────────────────────────────────────────────────────

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-importer-test-'));
}

function removeTempDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

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

function insertSyncRow(db: Database, filePath: string, dbHash: string, fileHash: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO markdown_sync (file_path, last_db_hash, last_file_hash, last_sync_at)
    VALUES (?, ?, ?, ?)
  `).run(filePath, dbHash, fileHash, new Date().toISOString());
}

// ─── Shared state ────────────────────────────────────────────────────────────

let db: Database;
let outputDir: string;

beforeEach(() => {
  db = new Database(':memory:');
  db.run('PRAGMA journal_mode = WAL');
  const runner = new MigrationRunner(db);
  runner.runAllMigrations();
  outputDir = makeTempDir();
});

afterEach(() => {
  db.close();
  removeTempDir(outputDir);
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MarkdownImporter.checkForChanges', () => {
  it('returns empty when no files are tracked in markdown_sync', () => {
    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(0);
  });

  it('returns empty when tracked files match their sync hashes', () => {
    const content = '# Test Content\nSome text';
    const filePath = path.join(outputDir, 'profile', 'user.md');
    fs.mkdirSync(path.join(outputDir, 'profile'), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');

    insertSyncRow(db, filePath, sha256(content), sha256(content));

    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(0);
  });

  it('detects changes when file hash differs from last_file_hash', () => {
    const originalContent = '# User Profile\n\n## Name\nEli';
    const editedContent = '# User Profile\n\n## Name\nEli Updated';
    const filePath = path.join(outputDir, 'profile', 'user.md');
    fs.mkdirSync(path.join(outputDir, 'profile'), { recursive: true });
    fs.writeFileSync(filePath, editedContent, 'utf8');

    insertSyncRow(db, filePath, sha256(originalContent), sha256(originalContent));

    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('profile');
    expect(changes[0].action).toBe('updated');
  });

  it('marks changes as conflict when last_db_hash != last_file_hash', () => {
    const content = '# Knowledge\nSome knowledge';
    const filePath = path.join(outputDir, 'knowledge', 'auth.md');
    fs.mkdirSync(path.join(outputDir, 'knowledge'), { recursive: true });
    fs.writeFileSync(filePath, content + '\nUser edited', 'utf8');

    // DB hash differs from file hash — simulates DB was updated after export
    insertSyncRow(db, filePath, 'different-db-hash', sha256(content));

    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe('conflict');
  });

  it('classifies profile/ files as profile type', () => {
    const filePath = path.join(outputDir, 'profile', 'style.md');
    fs.mkdirSync(path.join(outputDir, 'profile'), { recursive: true });
    fs.writeFileSync(filePath, '# Style\n\n## Tone\ndirect', 'utf8');

    insertSyncRow(db, filePath, sha256('old content'), sha256('old content'));

    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('profile');
  });

  it('classifies knowledge/ files as knowledge type', () => {
    const filePath = path.join(outputDir, 'knowledge', 'auth.md');
    fs.mkdirSync(path.join(outputDir, 'knowledge'), { recursive: true });
    fs.writeFileSync(filePath, '# Auth\nNew content', 'utf8');

    insertSyncRow(db, filePath, sha256('old'), sha256('old'));

    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].type).toBe('knowledge');
  });

  it('ignores tracked files that no longer exist on disk', () => {
    insertSyncRow(db, path.join(outputDir, 'profile', 'deleted.md'), 'hash1', 'hash1');

    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(0);
  });
});

describe('MarkdownImporter.importChanges', () => {
  it('updates agent_profiles when a profile file is edited', () => {
    seedProfile(db, 'global', 'user', JSON.stringify({ name: 'Eli', role: 'PM' }));

    const filePath = path.join(outputDir, 'profile', 'user.md');
    fs.mkdirSync(path.join(outputDir, 'profile'), { recursive: true });
    const editedContent = '# User Profile\n\n> Scope: `global`\n\n## Name\nEli Updated\n\n## Role\nLead PM\n';
    fs.writeFileSync(filePath, editedContent, 'utf8');

    const importer = new MarkdownImporter(db, outputDir);
    const changes = [{ filePath, type: 'profile' as const, action: 'updated' as const }];
    const imported = importer.importChanges(changes);

    expect(imported).toBe(1);

    const row = db.prepare('SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = ?')
      .get('global', 'user') as { content_json: string };
    const parsed = JSON.parse(row.content_json);
    expect(parsed.name).toBe('Eli Updated');
    expect(parsed.role).toBe('Lead PM');
  });

  it('updates compiled_knowledge when a knowledge file is edited', () => {
    seedKnowledge(db, 'proj', 'Auth', '## Auth\n\nOld knowledge content');

    const filePath = path.join(outputDir, 'knowledge', 'auth.md');
    fs.mkdirSync(path.join(outputDir, 'knowledge'), { recursive: true });
    const editedContent = '# Auth\n\n> Confidence: **high**\n\n## Auth\n\nUpdated knowledge about auth patterns\n';
    fs.writeFileSync(filePath, editedContent, 'utf8');

    const importer = new MarkdownImporter(db, outputDir);
    const changes = [{ filePath, type: 'knowledge' as const, action: 'updated' as const }];
    const imported = importer.importChanges(changes);

    expect(imported).toBe(1);

    const row = db.prepare('SELECT content FROM compiled_knowledge WHERE topic = ?')
      .get('Auth') as { content: string };
    expect(row.content).toContain('Updated knowledge about auth patterns');
  });

  it('skips conflict changes without importing', () => {
    const filePath = path.join(outputDir, 'profile', 'user.md');
    fs.mkdirSync(path.join(outputDir, 'profile'), { recursive: true });
    fs.writeFileSync(filePath, '# User\n\n## Name\nConflicted', 'utf8');

    const importer = new MarkdownImporter(db, outputDir);
    const changes = [{ filePath, type: 'profile' as const, action: 'conflict' as const }];
    const imported = importer.importChanges(changes);

    expect(imported).toBe(0);
  });

  it('updates markdown_sync hashes after successful import', () => {
    seedProfile(db, 'global', 'style', JSON.stringify({ tone: 'direct' }));

    const filePath = path.join(outputDir, 'profile', 'style.md');
    fs.mkdirSync(path.join(outputDir, 'profile'), { recursive: true });
    const editedContent = '# Style Preferences\n\n> Scope: `global`\n\n## Tone\nrelaxed\n';
    fs.writeFileSync(filePath, editedContent, 'utf8');

    insertSyncRow(db, filePath, sha256('old'), sha256('old'));

    const importer = new MarkdownImporter(db, outputDir);
    const changes = [{ filePath, type: 'profile' as const, action: 'updated' as const }];
    importer.importChanges(changes);

    const row = db.prepare('SELECT last_db_hash, last_file_hash FROM markdown_sync WHERE file_path = ?')
      .get(filePath) as { last_db_hash: string; last_file_hash: string };

    const expectedHash = sha256(editedContent);
    expect(row.last_db_hash).toBe(expectedHash);
    expect(row.last_file_hash).toBe(expectedHash);
  });

  it('returns 0 when given an empty changes array', () => {
    const importer = new MarkdownImporter(db, outputDir);
    expect(importer.importChanges([])).toBe(0);
  });

  it('handles missing files gracefully during import', () => {
    const importer = new MarkdownImporter(db, outputDir);
    const changes = [{
      filePath: path.join(outputDir, 'profile', 'nonexistent.md'),
      type: 'profile' as const,
      action: 'updated' as const,
    }];
    const imported = importer.importChanges(changes);
    expect(imported).toBe(0);
  });
});

describe('MarkdownImporter.hashContent', () => {
  it('produces consistent SHA-256 hashes', () => {
    const importer = new MarkdownImporter(db, outputDir);
    const content = 'Hello, world!';
    const hash1 = importer.hashContent(content);
    const hash2 = importer.hashContent(content);
    expect(hash1).toBe(hash2);
    expect(hash1).toBe(sha256(content));
  });

  it('produces different hashes for different content', () => {
    const importer = new MarkdownImporter(db, outputDir);
    const hash1 = importer.hashContent('Content A');
    const hash2 = importer.hashContent('Content B');
    expect(hash1).not.toBe(hash2);
  });
});

describe('MarkdownExporter hash tracking integration', () => {
  it('records sync hashes in markdown_sync after export', () => {
    seedProfile(db, 'global', 'user', JSON.stringify({ name: 'Eli' }));
    const exporter = new MarkdownExporter(db, outputDir);
    exporter.exportProfiles('global');

    const rows = db.prepare('SELECT * FROM markdown_sync').all() as any[];
    expect(rows.length).toBeGreaterThan(0);

    const profileRow = rows.find((r: any) => r.file_path.includes('user.md'));
    expect(profileRow).toBeDefined();
    expect(profileRow.last_db_hash).toBeTruthy();
    expect(profileRow.last_file_hash).toBeTruthy();
    expect(profileRow.last_db_hash).toBe(profileRow.last_file_hash);
  });

  it('records sync hashes for knowledge files after export', () => {
    seedKnowledge(db, 'proj', 'Auth', 'Auth knowledge content');
    const exporter = new MarkdownExporter(db, outputDir);
    exporter.exportKnowledge('proj');

    const rows = db.prepare('SELECT * FROM markdown_sync').all() as any[];
    // Should have: auth.md + index.md = 2 entries
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it('end-to-end: export -> edit -> detect -> import cycle', () => {
    // Step 1: Seed and export
    seedProfile(db, 'global', 'user', JSON.stringify({ name: 'Eli', role: 'PM' }));
    const exporter = new MarkdownExporter(db, outputDir);
    exporter.exportProfiles('global');

    // Step 2: Verify file was exported
    const filePath = path.join(outputDir, 'profile', 'user.md');
    expect(fs.existsSync(filePath)).toBe(true);

    // Step 3: Simulate user edit
    const edited = '# User Profile\n\n> Scope: `global`\n\n## Name\nEli Edited\n\n## Role\nSenior PM\n';
    fs.writeFileSync(filePath, edited, 'utf8');

    // Step 4: Detect changes
    const importer = new MarkdownImporter(db, outputDir);
    const changes = importer.checkForChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0].action).toBe('updated');

    // Step 5: Import changes
    const imported = importer.importChanges(changes);
    expect(imported).toBe(1);

    // Step 6: Verify DB was updated
    const row = db.prepare('SELECT content_json FROM agent_profiles WHERE scope = ? AND profile_type = ?')
      .get('global', 'user') as { content_json: string };
    const parsed = JSON.parse(row.content_json);
    expect(parsed.name).toBe('Eli Edited');
    expect(parsed.role).toBe('Senior PM');

    // Step 7: No more changes detected after import
    const changes2 = importer.checkForChanges();
    expect(changes2).toHaveLength(0);
  });
});
