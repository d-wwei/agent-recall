/**
 * MarkdownImporter — detects and imports user edits to exported markdown files.
 *
 * Compares file hashes against the markdown_sync table to find files that were
 * modified by the user outside of the normal export flow. When changes are
 * detected, parses the markdown back into structured data and updates the
 * corresponding database records.
 *
 * Part of the bidirectional sync system:
 *   MarkdownExporter: DB -> files (export)
 *   MarkdownImporter: files -> DB (import)
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import * as path from 'path';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImportChange {
  filePath: string;
  type: 'profile' | 'knowledge';
  action: 'updated' | 'conflict';
}

interface SyncRow {
  file_path: string;
  last_db_hash: string;
  last_file_hash: string;
  last_sync_at: string;
}

// ─── MarkdownImporter ────────────────────────────────────────────────────────

export class MarkdownImporter {
  constructor(
    private db: Database,
    private readableDir: string
  ) {}

  /**
   * Compare file hashes against markdown_sync.last_file_hash.
   * Returns list of files that were edited by the user after export.
   */
  checkForChanges(): ImportChange[] {
    const changes: ImportChange[] = [];

    // Get all tracked files from markdown_sync
    let rows: SyncRow[];
    try {
      rows = this.db.prepare('SELECT file_path, last_db_hash, last_file_hash, last_sync_at FROM markdown_sync').all() as SyncRow[];
    } catch {
      // Table may not exist yet
      return [];
    }

    for (const row of rows) {
      const fullPath = this.resolveFilePath(row.file_path);
      if (!existsSync(fullPath)) continue;

      const currentHash = this.hashFile(fullPath);
      if (currentHash === row.last_file_hash) continue;

      // File was modified since last export
      const type = this.classifyFile(row.file_path);
      if (!type) continue;

      // Check for conflict: DB changed too (last_db_hash != last_file_hash means
      // DB was updated after export but before user edited file)
      const action: 'updated' | 'conflict' =
        row.last_db_hash !== row.last_file_hash ? 'conflict' : 'updated';

      changes.push({ filePath: row.file_path, type, action });
    }

    return changes;
  }

  /**
   * Import changes from modified markdown files back into the database.
   *
   * For profile changes: parse markdown back into JSON, update agent_profiles.
   * For knowledge changes: update compiled_knowledge content.
   * Updates markdown_sync hashes after import.
   *
   * @returns Count of successfully imported changes
   */
  importChanges(changes: ImportChange[]): number {
    let imported = 0;

    for (const change of changes) {
      // Skip conflicts — they need manual resolution
      if (change.action === 'conflict') continue;

      const fullPath = this.resolveFilePath(change.filePath);
      if (!existsSync(fullPath)) continue;

      const content = readFileSync(fullPath, 'utf8');
      const hash = this.hashContent(content);

      try {
        if (change.type === 'profile') {
          this.importProfile(change.filePath, content);
        } else if (change.type === 'knowledge') {
          this.importKnowledge(change.filePath, content);
        }

        // Update sync hashes
        this.db.prepare(
          'UPDATE markdown_sync SET last_db_hash = ?, last_file_hash = ?, last_sync_at = ? WHERE file_path = ?'
        ).run(hash, hash, new Date().toISOString(), change.filePath);

        imported++;
      } catch {
        // Skip failed imports silently — don't block the pipeline
      }
    }

    return imported;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /**
   * Import a profile markdown file back into agent_profiles.
   * Parses ## sections as key-value pairs in the JSON content.
   */
  private importProfile(filePath: string, content: string): void {
    // Extract profile type from filename: profile/user.md -> user
    const basename = path.basename(filePath, '.md');
    const profileType = basename.replace(/-/g, '_');

    // Parse markdown sections into a JSON object
    const parsed: Record<string, string | string[]> = {};
    let currentKey: string | null = null;
    let currentValues: string[] = [];

    for (const line of content.split('\n')) {
      // Skip title (# ...) and metadata lines (> ...)
      if (line.startsWith('# ') || line.startsWith('> ')) continue;

      if (line.startsWith('## ')) {
        // Save previous section
        if (currentKey !== null) {
          parsed[currentKey] = currentValues.length === 1
            ? currentValues[0]
            : currentValues;
        }
        currentKey = line.substring(3).trim().toLowerCase().replace(/\s+/g, '_');
        currentValues = [];
      } else if (line.startsWith('- ') && currentKey) {
        currentValues.push(line.substring(2).trim());
      } else if (line.trim() && currentKey && !line.startsWith('#')) {
        currentValues.push(line.trim());
      }
    }

    // Save last section
    if (currentKey !== null) {
      parsed[currentKey] = currentValues.length === 1
        ? currentValues[0]
        : currentValues;
    }

    if (Object.keys(parsed).length === 0) return;

    // Determine scope from the file's metadata line if present, otherwise use 'global'
    const scopeMatch = content.match(/Scope:\s*`([^`]+)`/);
    const scope = scopeMatch ? scopeMatch[1] : 'global';

    const contentJson = JSON.stringify(parsed);

    // Upsert into agent_profiles
    this.db.prepare(`
      UPDATE agent_profiles SET content_json = ?, updated_at = ?
      WHERE scope = ? AND profile_type = ?
    `).run(contentJson, new Date().toISOString(), scope, profileType);
  }

  /**
   * Import a knowledge markdown file back into compiled_knowledge.
   * Extracts the topic from the filename and updates the content.
   */
  private importKnowledge(filePath: string, content: string): void {
    // Extract topic from filename: knowledge/session-recovery.md
    // We need to look it up in the DB since the filename is a slugified version
    const basename = path.basename(filePath, '.md');
    if (basename === 'index') return; // Skip index files

    // Find the matching compiled_knowledge row by file_path in markdown_sync
    // The content itself contains the topic as # heading
    const topicMatch = content.match(/^#\s+(.+)/m);
    if (!topicMatch) return;
    const topic = topicMatch[1].trim();

    // Extract the actual knowledge content (skip the header and metadata)
    const lines = content.split('\n');
    const contentLines: string[] = [];
    let pastHeader = false;

    for (const line of lines) {
      if (line.startsWith('# ') && !pastHeader) {
        pastHeader = true;
        continue;
      }
      if (line.startsWith('> ') && !contentLines.length) continue; // skip metadata
      if (pastHeader) {
        contentLines.push(line);
      }
    }

    const knowledgeContent = contentLines.join('\n').trim();
    if (!knowledgeContent) return;

    // Update compiled_knowledge
    this.db.prepare(`
      UPDATE compiled_knowledge SET content = ?, compiled_at = ?
      WHERE topic = ?
    `).run(knowledgeContent, new Date().toISOString(), topic);
  }

  /** Classify a file path as profile or knowledge based on directory. */
  private classifyFile(filePath: string): 'profile' | 'knowledge' | null {
    if (filePath.includes('/profile/') || filePath.includes('\\profile\\')) return 'profile';
    if (filePath.includes('/knowledge/') || filePath.includes('\\knowledge\\')) return 'knowledge';
    return null;
  }

  /** Resolve a potentially relative file path against the readableDir. */
  private resolveFilePath(filePath: string): string {
    if (path.isAbsolute(filePath)) return filePath;
    return path.join(this.readableDir, filePath);
  }

  /** Compute SHA-256 hash of a file's contents. */
  private hashFile(filePath: string): string {
    const content = readFileSync(filePath, 'utf8');
    return this.hashContent(content);
  }

  /** Compute SHA-256 hash of a string. */
  hashContent(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}
