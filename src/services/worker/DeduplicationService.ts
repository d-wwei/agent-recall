/**
 * DeduplicationService - Idempotent deduplication for observations
 *
 * Provides two-level deduplication:
 *   Level 1 (checkPostToolUse): same session + same file + same tool within 5-minute window
 *                               using Jaccard word-level similarity
 *   Level 2 (checkWriteTime):   exact content_hash match across all projects
 */

import { Database } from 'bun:sqlite';
import { createHash } from 'crypto';
import { logger } from '../../utils/logger.js';

export interface DeduplicationResult {
  isDuplicate: boolean;
  existingId?: number;     // ID of the matching observation
  similarity?: number;     // 0-1 similarity score
  action: 'insert' | 'merge' | 'skip';
}

export class DeduplicationService {
  constructor(private db: Database) {}

  /**
   * Level 1 check: same session + same tool within 5-minute window.
   * If a file is provided, also verifies that file appears in files_modified
   * of the recent observation. Computes Jaccard similarity on narratives;
   * returns 'merge' when similarity > 0.9.
   */
  checkPostToolUse(
    sessionId: string,
    file: string | null,
    toolName: string,
    narrative: string
  ): DeduplicationResult {
    logger.debug(`DeduplicationService.checkPostToolUse: session=${sessionId} tool=${toolName}`);
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    // Find the most recent observation matching session + tool within 5-min window.
    // Note: tool_name column does not exist on observations; toolName is used as
    // a logical grouping key stored externally. We match on session + time window only
    // and let the caller differentiate by tool if needed.
    const recent = this.db.prepare(`
      SELECT id, narrative, files_modified FROM observations
      WHERE memory_session_id = ? AND created_at_epoch > ?
      ORDER BY created_at_epoch DESC LIMIT 1
    `).get(sessionId, fiveMinAgo) as { id: number; narrative: string | null; files_modified: string | null } | null;

    if (!recent) {
      return { isDuplicate: false, action: 'insert' };
    }

    // If file is provided, verify it appears in the existing observation's files_modified.
    if (file) {
      let filesModified: string[] = [];
      try {
        filesModified = JSON.parse(recent.files_modified || '[]');
      } catch {
        filesModified = [];
      }
      if (!filesModified.includes(file)) {
        return { isDuplicate: false, action: 'insert' };
      }
    }

    const similarity = DeduplicationService.calculateSimilarity(
      narrative,
      recent.narrative ?? ''
    );

    if (similarity > 0.9) {
      return { isDuplicate: true, existingId: recent.id, similarity, action: 'merge' };
    }

    return { isDuplicate: false, similarity, action: 'insert' };
  }

  /**
   * Level 2 check: exact content_hash duplicate across the given project.
   * Computes SHA-256 of the narrative and looks for an existing match.
   * Returns 'skip' if an exact hash match is found.
   */
  checkWriteTime(narrative: string, project: string): DeduplicationResult {
    const contentHash = createHash('sha256')
      .update(narrative || '')
      .digest('hex')
      .slice(0, 16);

    const existing = this.db.prepare(`
      SELECT id FROM observations
      WHERE content_hash = ? AND project = ?
      LIMIT 1
    `).get(contentHash, project) as { id: number } | null;

    if (existing) {
      return { isDuplicate: true, existingId: existing.id, similarity: 1, action: 'skip' };
    }

    return { isDuplicate: false, action: 'insert' };
  }

  /**
   * Simple word-level Jaccard similarity.
   * Words shorter than 3 characters are excluded.
   * Returns a value in [0, 1].
   */
  static calculateSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;

    let intersection = 0;
    for (const w of wordsA) if (wordsB.has(w)) intersection++;

    const union = new Set([...wordsA, ...wordsB]).size;
    return intersection / union;
  }
}
