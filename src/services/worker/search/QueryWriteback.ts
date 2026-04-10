/**
 * QueryWriteback — persists synthesized query results as observations
 * with anti-feedback-loop protections.
 *
 * Anti-feedback-loop protections:
 *   1. type = 'synthesis'    — marked so FusionRanker applies reduced weight
 *   2. SYNTHESIS_WEIGHT      — 0.7x multiplier applied by FusionRanker TYPE_WEIGHTS
 *   3. TTL_DAYS = 90         — valid_until set to now + 90 days
 *   4. Excluded from compile — GatherStage skips type = 'synthesis' rows
 *   5. confidence = 'medium' — always medium, never high
 */

import { createHash } from 'crypto';
import type { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';

export interface WritebackResult {
  observationId: number | null;
  written: boolean;
  reason?: string;
}

export class QueryWriteback {
  /** Weight applied by FusionRanker for synthesis-type observations (0.7x). */
  static readonly SYNTHESIS_WEIGHT = 0.7;

  /** TTL in days: valid_until = now + 90 days. */
  static readonly TTL_DAYS = 90;

  constructor(private db: Database) {}

  /**
   * Write a synthesis observation to the database.
   *
   * The observation is tagged as type='synthesis' and has:
   *   - valid_until = now + 90 days (TTL)
   *   - confidence = 'medium'
   *   - tags = '["synthesis"]'
   *   - concepts = '["synthesis"]'
   *   - content_hash = SHA-256 of the synthesis text
   *
   * These attributes ensure the FusionRanker applies a reduced weight
   * and the GatherStage skips synthesis observations during compilation,
   * preventing feedback loops.
   */
  write(project: string, query: string, synthesis: string): WritebackResult {
    logger.debug(`QueryWriteback.write: project=${project} query=${query.substring(0, 50)}`);
    const now = new Date();
    const validUntil = new Date(now.getTime() + QueryWriteback.TTL_DAYS * 24 * 60 * 60 * 1000);

    const contentHash = createHash('sha256').update(synthesis).digest('hex');
    const memorySessionId = `synthesis-${now.getTime()}`;
    const title = `Synthesis: ${query.substring(0, 100)}`;

    const result = this.db.prepare(`
      INSERT INTO observations
      (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
       files_read, files_modified, prompt_number, discovery_tokens, content_hash,
       confidence, tags, has_preference, valid_until,
       created_at, created_at_epoch)
      VALUES (?, ?, 'synthesis', ?, 'Query synthesis', '[]', ?, '["synthesis"]',
       '[]', '[]', 0, 0, ?, 'medium', '["synthesis"]', 0, ?, ?, ?)
    `).run(
      memorySessionId,
      project,
      title,
      synthesis,
      contentHash,
      validUntil.toISOString(),
      now.toISOString(),
      now.getTime(),
    );

    return {
      observationId: Number(result.lastInsertRowid),
      written: true,
    };
  }
}
