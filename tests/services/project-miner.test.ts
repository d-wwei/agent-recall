/**
 * Tests for ProjectMiner
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real bun:sqlite in-memory DB with full schema migrations
 * - Uses real temp directories with mock files on disk
 * - Tests actual file system scanning and observation storage
 *
 * Value: Prevents regression on project file discovery and observation creation
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { ClaudeMemDatabase } from '../../src/services/sqlite/Database.js';
import { ProjectMiner, type MiningResult, type MinedFile } from '../../src/services/worker/ProjectMiner.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'project-miner-test-'));
}

function writeFile(dir: string, relPath: string, content: string): string {
  const abs = join(dir, relPath);
  // Ensure parent directories exist
  const parentParts = relPath.split('/');
  if (parentParts.length > 1) {
    mkdirSync(join(dir, ...parentParts.slice(0, -1)), { recursive: true });
  }
  writeFileSync(abs, content, 'utf-8');
  return abs;
}

function countObservations(db: Database, project: string): number {
  const row = db.prepare(
    `SELECT COUNT(*) as n FROM observations WHERE project = ?`
  ).get(project) as { n: number };
  return row.n;
}

function getObservationTitles(db: Database, project: string): string[] {
  const rows = db.prepare(
    `SELECT title FROM observations WHERE project = ? ORDER BY id`
  ).all(project) as Array<{ title: string }>;
  return rows.map(r => r.title);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('ProjectMiner', () => {
  let db: Database;
  let miner: ProjectMiner;
  let tmpDir: string;
  const PROJECT = 'test-project';

  beforeEach(() => {
    db = new ClaudeMemDatabase(':memory:').db;
    miner = new ProjectMiner(db);
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // -------------------------------------------------------------------------
  // getMinableFiles
  // -------------------------------------------------------------------------

  describe('getMinableFiles', () => {
    it('returns empty array for empty directory', () => {
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toEqual([]);
    });

    it('returns README.md when it exists', () => {
      writeFile(tmpDir, 'README.md', '# My Project');
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(join(tmpDir, 'README.md'));
    });

    it('returns CHANGELOG.md when it exists', () => {
      writeFile(tmpDir, 'CHANGELOG.md', '## v1.0.0');
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(join(tmpDir, 'CHANGELOG.md'));
    });

    it('returns multiple files when several exist', () => {
      writeFile(tmpDir, 'README.md', '# My Project');
      writeFile(tmpDir, 'CHANGELOG.md', '## v1.0.0');
      writeFile(tmpDir, 'package.json', '{"name":"test"}');
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toHaveLength(3);
    });

    it('returns docs/README.md when it exists', () => {
      writeFile(tmpDir, 'docs/README.md', '# Docs');
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(join(tmpDir, 'docs/README.md'));
    });

    it('returns CLAUDE.md when it exists', () => {
      writeFile(tmpDir, 'CLAUDE.md', '# Claude instructions');
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(join(tmpDir, 'CLAUDE.md'));
    });

    it('returns absolute paths', () => {
      writeFile(tmpDir, 'README.txt', 'readme');
      const files = miner.getMinableFiles(tmpDir);
      expect(files[0]).toMatch(/^\//);
    });

    it('skips files not in the candidate list', () => {
      writeFile(tmpDir, 'random-file.txt', 'data');
      writeFile(tmpDir, 'src/index.ts', 'export {}');
      const files = miner.getMinableFiles(tmpDir);
      expect(files).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // mine — MiningResult structure
  // -------------------------------------------------------------------------

  describe('mine — MiningResult', () => {
    it('returns zero counts for an empty directory', () => {
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.filesScanned).toBe(0);
      expect(result.filesFound).toBe(0);
      expect(result.observationsCreated).toBe(0);
      expect(result.files).toHaveLength(0);
    });

    it('counts scanned files correctly', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      writeFile(tmpDir, 'CHANGELOG.md', '## v1');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.filesScanned).toBe(2);
    });

    it('sets filesFound equal to files that were successfully read', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.filesFound).toBe(1);
    });

    it('observationsCreated matches filesFound for normal files', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      writeFile(tmpDir, 'CHANGELOG.md', '## v1');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.observationsCreated).toBe(result.filesFound);
    });
  });

  // -------------------------------------------------------------------------
  // mine — MinedFile contents
  // -------------------------------------------------------------------------

  describe('mine — MinedFile contents', () => {
    it('classifies README.md with type readme', () => {
      writeFile(tmpDir, 'README.md', '# Project');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].type).toBe('readme');
    });

    it('classifies CHANGELOG.md with type changelog', () => {
      writeFile(tmpDir, 'CHANGELOG.md', '## Changelog');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].type).toBe('changelog');
    });

    it('classifies CHANGES.md with type changelog', () => {
      writeFile(tmpDir, 'CHANGES.md', '## Changes');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].type).toBe('changelog');
    });

    it('classifies package.json with type config', () => {
      writeFile(tmpDir, 'package.json', '{"name":"test"}');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].type).toBe('config');
    });

    it('classifies CLAUDE.md with type docs', () => {
      writeFile(tmpDir, 'CLAUDE.md', '# Instructions');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].type).toBe('docs');
    });

    it('populates path as absolute path to the file', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].path).toBe(join(tmpDir, 'README.md'));
    });

    it('sets summary to first 200 chars of content', () => {
      const longContent = 'A'.repeat(500);
      writeFile(tmpDir, 'README.md', longContent);
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].summary).toHaveLength(200);
      expect(result.files[0].summary).toBe('A'.repeat(200));
    });

    it('sets summary to full content when content is shorter than 200 chars', () => {
      writeFile(tmpDir, 'README.md', 'Short readme');
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].summary).toBe('Short readme');
    });

    it('truncates content to 5000 chars in MinedFile.content', () => {
      const veryLong = 'B'.repeat(10_000);
      writeFile(tmpDir, 'README.md', veryLong);
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.files[0].content).toHaveLength(5_000);
    });

    it('extracts only name, description, scripts from package.json', () => {
      const pkg = JSON.stringify({
        name: 'my-pkg',
        version: '1.0.0',
        description: 'A package',
        scripts: { test: 'bun test' },
        dependencies: { lodash: '^4.0.0' },
      });
      writeFile(tmpDir, 'package.json', pkg);
      const result = miner.mine(tmpDir, PROJECT);
      const content = result.files[0].content;
      const parsed = JSON.parse(content);
      expect(parsed.name).toBe('my-pkg');
      expect(parsed.description).toBe('A package');
      expect(parsed.scripts).toEqual({ test: 'bun test' });
      // version and dependencies should not be present
      expect(parsed.version).toBeUndefined();
      expect(parsed.dependencies).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // mine — large file skipping
  // -------------------------------------------------------------------------

  describe('mine — large file skipping', () => {
    it('skips files larger than 50KB', () => {
      // Write a file just over the limit
      const bigContent = 'X'.repeat(51 * 1024);
      writeFile(tmpDir, 'README.md', bigContent);
      const result = miner.mine(tmpDir, PROJECT);
      // filesScanned counts the candidate that exists, but filesFound skips it
      expect(result.filesScanned).toBe(1);
      expect(result.filesFound).toBe(0);
      expect(result.observationsCreated).toBe(0);
    });

    it('includes files exactly at the 50KB boundary', () => {
      // Exactly 50KB should be allowed
      const exactContent = 'Y'.repeat(50 * 1024);
      writeFile(tmpDir, 'README.md', exactContent);
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.filesFound).toBe(1);
    });

    it('still mines other files when one is too large', () => {
      const bigContent = 'Z'.repeat(51 * 1024);
      writeFile(tmpDir, 'README.md', bigContent);       // too big
      writeFile(tmpDir, 'CHANGELOG.md', '## v1.0.0');  // fine
      const result = miner.mine(tmpDir, PROJECT);
      expect(result.filesScanned).toBe(2);
      expect(result.filesFound).toBe(1);
      expect(result.files[0].path).toBe(join(tmpDir, 'CHANGELOG.md'));
    });
  });

  // -------------------------------------------------------------------------
  // mine — database observations
  // -------------------------------------------------------------------------

  describe('mine — database observations', () => {
    it('creates one observation per mined file', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      writeFile(tmpDir, 'CHANGELOG.md', '## v1');
      miner.mine(tmpDir, PROJECT);
      expect(countObservations(db, PROJECT)).toBe(2);
    });

    it('stores observation with type discovery', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      miner.mine(tmpDir, PROJECT);
      const row = db.prepare(
        `SELECT type FROM observations WHERE project = ? LIMIT 1`
      ).get(PROJECT) as { type: string };
      expect(row.type).toBe('discovery');
    });

    it('stores observation with title containing the filename', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      miner.mine(tmpDir, PROJECT);
      const titles = getObservationTitles(db, PROJECT);
      expect(titles[0]).toBe('Project file: README.md');
    });

    it('stores observation narrative with file content', () => {
      writeFile(tmpDir, 'README.md', 'My project readme content');
      miner.mine(tmpDir, PROJECT);
      const row = db.prepare(
        `SELECT narrative FROM observations WHERE project = ? LIMIT 1`
      ).get(PROJECT) as { narrative: string };
      expect(row.narrative).toContain('My project readme content');
    });

    it('stores observation with project-setup in concepts', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      miner.mine(tmpDir, PROJECT);
      const row = db.prepare(
        `SELECT concepts FROM observations WHERE project = ? LIMIT 1`
      ).get(PROJECT) as { concepts: string };
      const concepts: string[] = JSON.parse(row.concepts);
      expect(concepts).toContain('project-setup');
    });

    it('stores observation with filename in concepts', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      miner.mine(tmpDir, PROJECT);
      const row = db.prepare(
        `SELECT concepts FROM observations WHERE project = ? LIMIT 1`
      ).get(PROJECT) as { concepts: string };
      const concepts: string[] = JSON.parse(row.concepts);
      expect(concepts).toContain('readme.md');
    });

    it('stores no observations when no candidate files exist', () => {
      miner.mine(tmpDir, PROJECT);
      expect(countObservations(db, PROJECT)).toBe(0);
    });

    it('stores correct observation titles for multiple files', () => {
      writeFile(tmpDir, 'README.md', '# Hello');
      writeFile(tmpDir, 'package.json', '{"name":"x"}');
      miner.mine(tmpDir, PROJECT);
      const titles = getObservationTitles(db, PROJECT);
      expect(titles).toContain('Project file: README.md');
      expect(titles).toContain('Project file: package.json');
    });
  });
});
