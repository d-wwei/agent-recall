/**
 * AutoMemorySync — incremental sync of ~/.claude/memory/*.md files
 * into Agent Recall's database on each SessionStart.
 *
 * Sync logic:
 *  1. Scan all .md files in memoryDir
 *  2. Compute SHA-256 hash of each file's content
 *  3. Check sync_state: if file_path exists with same hash → skip (unchanged)
 *  4. Parse YAML frontmatter to get `type`
 *  5. type=user   → upsert to agent_profiles (scope='global', profile_type='user')
 *  6. type=feedback → insert as observation (type='feedback', confidence='high')
 *  7. type=project or reference → skip (stays in auto memory only)
 *  8. Update sync_state with new hash and timestamp
 */

import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SyncResult {
  imported: number;
  skipped: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ParsedFrontmatter {
  name?: string;
  description?: string;
  type?: string;
}

interface ParsedMemoryFile {
  frontmatter: ParsedFrontmatter;
  body: string;
}

interface SyncStateRow {
  file_path: string;
  content_hash: string;
  source_type: string;
  last_sync_at: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 hex digest of the given string.
 */
function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Parse YAML frontmatter from a markdown file.
 *
 * Expects the file to begin with `---` on the first line, followed by
 * `key: value` pairs, terminated by another `---` line.
 * Returns { frontmatter, body } or null if frontmatter is absent/malformed.
 */
function parseMemoryFile(content: string): ParsedMemoryFile | null {
  const lines = content.split('\n');

  // Must start with ---
  if (lines[0]?.trim() !== '---') {
    return null;
  }

  // Find closing ---
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }

  if (closeIdx === -1) {
    return null;
  }

  const fmLines = lines.slice(1, closeIdx);
  const frontmatter: ParsedFrontmatter = {};

  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    if (key === 'name') frontmatter.name = value;
    else if (key === 'description') frontmatter.description = value;
    else if (key === 'type') frontmatter.type = value;
  }

  const body = lines.slice(closeIdx + 1).join('\n').trim();

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// AutoMemorySync
// ---------------------------------------------------------------------------

export class AutoMemorySync {
  constructor(
    private readonly db: Database,
    private readonly memoryDir: string
  ) {}

  /**
   * Scan memoryDir and sync only files whose content has changed since the
   * last sync (hash-based deduplication).
   */
  syncIncremental(): SyncResult {
    return this.runSync(false);
  }

  /**
   * Clear all sync_state records and re-import every file unconditionally.
   */
  fullImport(): SyncResult {
    this.db.prepare('DELETE FROM sync_state').run();
    return this.runSync(true);
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private runSync(force: boolean): SyncResult {
    const result: SyncResult = { imported: 0, skipped: 0, errors: [] };

    logger.debug(`AutoMemorySync.runSync: memoryDir=${this.memoryDir} force=${force}`);

    // Directory must exist
    if (!existsSync(this.memoryDir)) {
      return result;
    }

    let files: string[];
    try {
      files = readdirSync(this.memoryDir).filter(f => extname(f) === '.md');
    } catch (err) {
      result.errors.push(`Failed to read memoryDir: ${String(err)}`);
      return result;
    }

    for (const filename of files) {
      const filePath = join(this.memoryDir, filename);

      let content: string;
      try {
        content = readFileSync(filePath, 'utf-8');
      } catch (err) {
        result.errors.push(`Failed to read ${filename}: ${String(err)}`);
        continue;
      }

      const hash = sha256(content);

      // Check sync_state unless forcing a full import
      if (!force) {
        const existing = this.db.prepare(
          'SELECT content_hash FROM sync_state WHERE file_path = ?'
        ).get(filePath) as { content_hash: string } | null;

        if (existing && existing.content_hash === hash) {
          result.skipped++;
          continue;
        }
      }

      // Parse frontmatter
      const parsed = parseMemoryFile(content);
      if (!parsed) {
        result.skipped++;
        continue;
      }

      const { frontmatter, body } = parsed;
      const type = frontmatter.type;

      if (type === 'user') {
        try {
          this.upsertUserProfile(body);
          this.upsertSyncState(filePath, hash, 'user');
          result.imported++;
        } catch (err) {
          result.errors.push(`Failed to sync user file ${filename}: ${String(err)}`);
        }
      } else if (type === 'feedback') {
        try {
          this.insertFeedbackObservation(frontmatter.name, body);
          this.upsertSyncState(filePath, hash, 'feedback');
          result.imported++;
        } catch (err) {
          result.errors.push(`Failed to sync feedback file ${filename}: ${String(err)}`);
        }
      } else {
        // project, reference, unknown → skip without recording in sync_state
        result.skipped++;
      }
    }

    return result;
  }

  /**
   * Upsert the user profile into agent_profiles with scope='global'.
   * Stores raw markdown body as { raw: content }.
   */
  private upsertUserProfile(body: string): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    const contentJson = JSON.stringify({ raw: body });

    this.db.prepare(`
      INSERT INTO agent_profiles
        (scope, profile_type, content_json, created_at, created_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, profile_type) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = excluded.updated_at,
        updated_at_epoch = excluded.updated_at_epoch
    `).run('global', 'user', contentJson, now, nowEpoch, now, nowEpoch);
  }

  /**
   * Insert a feedback observation into observations table with confidence='high'.
   */
  /**
   * Ensure the synthetic 'auto-memory' session exists for FK compliance.
   */
  private ensureAutoMemorySession(): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO sdk_sessions
        (content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, status)
      VALUES ('auto-memory', 'auto-memory', 'system', 'Auto-imported memory files', datetime('now'), ?, 'completed')
    `).run(Date.now());
  }

  private insertFeedbackObservation(title: string | undefined, narrative: string): void {
    this.ensureAutoMemorySession();
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    this.db.prepare(`
      INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash,
         confidence, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'auto-memory',     // memory_session_id
      '',                // project (global feedback)
      'feedback',        // type
      title ?? null,     // title from frontmatter name
      null,              // subtitle
      '[]',              // facts
      narrative,         // narrative = file body
      '[]',              // concepts
      '[]',              // files_read
      '[]',              // files_modified
      null,              // prompt_number
      0,                 // discovery_tokens
      null,              // content_hash (not deduplicating via hash here)
      'high',            // confidence
      now,
      nowEpoch
    );
  }

  /**
   * Upsert sync_state record for a successfully processed file.
   */
  private upsertSyncState(filePath: string, hash: string, sourceType: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO sync_state (file_path, content_hash, source_type, last_sync_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        content_hash = excluded.content_hash,
        source_type = excluded.source_type,
        last_sync_at = excluded.last_sync_at
    `).run(filePath, hash, sourceType, now);
  }
}
