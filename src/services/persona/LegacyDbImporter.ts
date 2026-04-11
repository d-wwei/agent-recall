/**
 * LegacyDbImporter — Read persona profiles from old claude-mem database
 *
 * Opens ~/.claude-mem/claude-mem.db in READONLY mode and extracts
 * agent_profiles data. Never modifies the legacy database.
 */

import { existsSync } from 'fs';
import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export class LegacyDbImporter {
  /**
   * Import global profiles from a legacy claude-mem database.
   * Returns a map of profile_type → parsed content, or null if unavailable.
   */
  static import(legacyDbPath: string): Record<string, Record<string, any>> | null {
    if (!existsSync(legacyDbPath)) {
      return null;
    }

    let db: Database | null = null;
    try {
      db = new Database(legacyDbPath, { readonly: true });

      // Verify agent_profiles table exists
      const tableCheck = db.query(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_profiles'"
      ).get() as { name: string } | null;

      if (!tableCheck) {
        logger.debug('LEGACY', 'Legacy DB has no agent_profiles table', { path: legacyDbPath });
        return null;
      }

      const rows = db.query(
        "SELECT profile_type, content_json FROM agent_profiles WHERE scope = 'global'"
      ).all() as Array<{ profile_type: string; content_json: string }>;

      if (rows.length === 0) return null;

      const result: Record<string, Record<string, any>> = {};
      for (const row of rows) {
        try {
          result[row.profile_type] = JSON.parse(row.content_json);
        } catch {
          logger.warn('LEGACY', `Failed to parse content_json for ${row.profile_type}`, { path: legacyDbPath });
        }
      }

      return Object.keys(result).length > 0 ? result : null;
    } catch (err) {
      logger.warn('LEGACY', 'Failed to read legacy database', { path: legacyDbPath }, err as Error);
      return null;
    } finally {
      db?.close();
    }
  }
}
