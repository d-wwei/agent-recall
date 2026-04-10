/**
 * Tests for BackupService — create/restore/prune lifecycle
 *
 * Mock Justification: NONE (0% mock code)
 * - Uses real filesystem with temporary directories
 * - Tests actual file copy, stat, and delete operations
 *
 * Value: Verifies backup creation, listing, restoration, pruning,
 *        and edge cases like missing files and empty directories.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync, readdirSync, utimesSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BackupService } from '../../../src/services/backup/BackupService.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTempDir(): string {
  const dir = join(tmpdir(), `backup-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFakeDb(path: string, content = 'SQLite format 3'): void {
  writeFileSync(path, content);
}

/**
 * Back-date a file's mtime to simulate an old backup.
 */
function backdateFile(filePath: string, daysAgo: number): void {
  const oldTime = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  utimesSync(filePath, oldTime, oldTime);
}

// ─── createBackup ─────────────────────────────────────────────────────────────

describe('createBackup()', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let service: BackupService;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, 'agent-recall.db');
    backupDir = join(tmpDir, 'backups');
    writeFakeDb(dbPath, 'test database content');
    service = new BackupService(dbPath, backupDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('creates a backup file in the backup directory', () => {
    service.createBackup();
    const files = readdirSync(backupDir).filter(f => f.endsWith('.db'));
    expect(files.length).toBe(1);
  });

  it('returns a BackupInfo with a valid path', () => {
    const info = service.createBackup();
    expect(existsSync(info.path)).toBe(true);
  });

  it('returns a positive sizeBytes', () => {
    const info = service.createBackup();
    expect(info.sizeBytes).toBeGreaterThan(0);
  });

  it('returns a valid ISO createdAt timestamp', () => {
    const info = service.createBackup();
    const date = new Date(info.createdAt);
    expect(date.toString()).not.toBe('Invalid Date');
  });

  it('names the backup with agent-recall prefix and .db extension', () => {
    const info = service.createBackup();
    const fileName = info.path.split('/').pop()!;
    expect(fileName.startsWith('agent-recall-')).toBe(true);
    expect(fileName.endsWith('.db')).toBe(true);
  });

  it('backup file content matches source database', () => {
    const info = service.createBackup();
    const content = require('fs').readFileSync(info.path, 'utf-8');
    expect(content).toBe('test database content');
  });

  it('creates multiple distinct backups on repeated calls', async () => {
    service.createBackup();
    await new Promise(r => setTimeout(r, 10));
    service.createBackup();
    const files = readdirSync(backupDir).filter(f => f.endsWith('.db'));
    expect(files.length).toBe(2);
  });

  it('throws when the database file does not exist', () => {
    const missingDbService = new BackupService(join(tmpDir, 'nonexistent.db'), backupDir);
    expect(() => missingDbService.createBackup()).toThrow('not found');
  });
});

// ─── listBackups ──────────────────────────────────────────────────────────────

describe('listBackups()', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let service: BackupService;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, 'agent-recall.db');
    backupDir = join(tmpDir, 'backups');
    writeFakeDb(dbPath);
    service = new BackupService(dbPath, backupDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns empty array when no backups exist', () => {
    const list = service.listBackups();
    expect(list).toHaveLength(0);
  });

  it('returns one entry after one backup', () => {
    service.createBackup();
    const list = service.listBackups();
    expect(list).toHaveLength(1);
  });

  it('returns entries sorted newest first', async () => {
    const b1 = service.createBackup();
    await new Promise(r => setTimeout(r, 10));
    const b2 = service.createBackup();
    const list = service.listBackups();
    // Newest backup should be first
    expect(list[0].path).toBe(b2.path);
    expect(list[1].path).toBe(b1.path);
  });

  it('each entry has a valid path, sizeBytes, and createdAt', () => {
    service.createBackup();
    const list = service.listBackups();
    const entry = list[0];
    expect(existsSync(entry.path)).toBe(true);
    expect(entry.sizeBytes).toBeGreaterThan(0);
    expect(new Date(entry.createdAt).toString()).not.toBe('Invalid Date');
  });
});

// ─── restoreBackup ────────────────────────────────────────────────────────────

describe('restoreBackup()', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let service: BackupService;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, 'agent-recall.db');
    backupDir = join(tmpDir, 'backups');
    writeFakeDb(dbPath, 'original content');
    service = new BackupService(dbPath, backupDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('restores the database from a backup', () => {
    const info = service.createBackup();
    writeFileSync(dbPath, 'modified content');
    service.restoreBackup(info.path);
    const restored = require('fs').readFileSync(dbPath, 'utf-8');
    expect(restored).toBe('original content');
  });

  it('overwrites the current database file', () => {
    const info = service.createBackup();
    writeFileSync(dbPath, 'totally different data');
    service.restoreBackup(info.path);
    const content = require('fs').readFileSync(dbPath, 'utf-8');
    expect(content).toBe('original content');
  });

  it('throws when the backup file does not exist', () => {
    expect(() => {
      service.restoreBackup(join(backupDir, 'nonexistent-backup.db'));
    }).toThrow('not found');
  });
});

// ─── pruneOldBackups ──────────────────────────────────────────────────────────

describe('pruneOldBackups()', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let service: BackupService;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, 'agent-recall.db');
    backupDir = join(tmpDir, 'backups');
    writeFakeDb(dbPath);
    service = new BackupService(dbPath, backupDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns 0 when no backups exist', () => {
    const count = service.pruneOldBackups(7);
    expect(count).toBe(0);
  });

  it('does not delete recent backups', () => {
    service.createBackup();
    const count = service.pruneOldBackups(7);
    expect(count).toBe(0);
    expect(service.listBackups()).toHaveLength(1);
  });

  it('deletes backups older than keepDays', () => {
    const info = service.createBackup();
    backdateFile(info.path, 10);
    const count = service.pruneOldBackups(7);
    expect(count).toBe(1);
    expect(existsSync(info.path)).toBe(false);
  });

  it('returns count of deleted files', async () => {
    const b1 = service.createBackup();
    backdateFile(b1.path, 10);
    await new Promise(r => setTimeout(r, 5));
    const b2 = service.createBackup();
    backdateFile(b2.path, 14);
    const count = service.pruneOldBackups(7);
    expect(count).toBe(2);
  });

  it('keeps backups within keepDays window', () => {
    const old = service.createBackup();
    backdateFile(old.path, 10);
    const recent = service.createBackup();
    service.pruneOldBackups(7);
    expect(existsSync(old.path)).toBe(false);
    expect(existsSync(recent.path)).toBe(true);
  });
});

// ─── getLatestBackup ──────────────────────────────────────────────────────────

describe('getLatestBackup()', () => {
  let tmpDir: string;
  let dbPath: string;
  let backupDir: string;
  let service: BackupService;

  beforeEach(() => {
    tmpDir = makeTempDir();
    dbPath = join(tmpDir, 'agent-recall.db');
    backupDir = join(tmpDir, 'backups');
    writeFakeDb(dbPath);
    service = new BackupService(dbPath, backupDir);
  });

  afterEach(() => rmSync(tmpDir, { recursive: true, force: true }));

  it('returns null when no backups exist', () => {
    expect(service.getLatestBackup()).toBeNull();
  });

  it('returns the most recent backup', async () => {
    const b1 = service.createBackup();
    await new Promise(r => setTimeout(r, 10));
    const b2 = service.createBackup();
    const latest = service.getLatestBackup();
    expect(latest?.path).toBe(b2.path);
  });

  it('returns a valid BackupInfo object', () => {
    service.createBackup();
    const latest = service.getLatestBackup();
    expect(latest).not.toBeNull();
    expect(latest!.sizeBytes).toBeGreaterThan(0);
    expect(new Date(latest!.createdAt).toString()).not.toBe('Invalid Date');
  });
});
