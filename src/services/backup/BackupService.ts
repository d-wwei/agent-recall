/**
 * BackupService — create, list, restore, and prune SQLite database backups.
 *
 * Backups are timestamped copies of the database file stored in a dedicated
 * backup directory. Supports pruning old backups by age and restoring any
 * backup to the live database path.
 */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';

export interface BackupInfo {
  path: string;
  sizeBytes: number;
  createdAt: string;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number, len = 2) => String(n).padStart(len, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}-${ms}`
  );
}

export class BackupService {
  constructor(
    private readonly dbPath: string,
    private readonly backupDir: string
  ) {
    mkdirSync(backupDir, { recursive: true });
  }

  /**
   * Create a timestamped copy of the current database file.
   * Returns metadata about the backup just created.
   */
  createBackup(): BackupInfo {
    if (!existsSync(this.dbPath)) {
      throw new Error(`Database file not found: ${this.dbPath}`);
    }

    const timestamp = formatTimestamp(new Date());
    const fileName = `agent-recall-${timestamp}.db`;
    const backupPath = join(this.backupDir, fileName);

    copyFileSync(this.dbPath, backupPath);

    const stat = statSync(backupPath);
    return {
      path: backupPath,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    };
  }

  /**
   * List all .db backup files in the backup directory, sorted newest first.
   */
  listBackups(): BackupInfo[] {
    if (!existsSync(this.backupDir)) return [];

    const files = readdirSync(this.backupDir).filter(f => f.endsWith('.db'));

    const infos: BackupInfo[] = files.map(file => {
      const fullPath = join(this.backupDir, file);
      const stat = statSync(fullPath);
      return {
        path: fullPath,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    });

    // Sort newest first by mtime
    infos.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    return infos;
  }

  /**
   * Restore a backup by copying it over the live database path.
   *
   * WARNING: This overwrites the current database.
   * The caller is responsible for stopping the worker before calling this.
   */
  restoreBackup(backupPath: string): void {
    if (!existsSync(backupPath)) {
      throw new Error(`Backup file not found: ${backupPath}`);
    }
    copyFileSync(backupPath, this.dbPath);
  }

  /**
   * Delete backup files older than keepDays days.
   * Returns the number of files deleted.
   */
  pruneOldBackups(keepDays: number = 7): number {
    if (!existsSync(this.backupDir)) return 0;

    const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    const files = readdirSync(this.backupDir).filter(f => f.endsWith('.db'));

    let deleted = 0;
    for (const file of files) {
      const fullPath = join(this.backupDir, file);
      const stat = statSync(fullPath);
      if (stat.mtime.getTime() < cutoff) {
        unlinkSync(fullPath);
        deleted++;
      }
    }
    return deleted;
  }

  /**
   * Return the most recent backup, or null if none exist.
   */
  getLatestBackup(): BackupInfo | null {
    const all = this.listBackups();
    return all.length > 0 ? all[0] : null;
  }
}
