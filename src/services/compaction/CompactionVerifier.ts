/**
 * CompactionVerifier — pre-compact quality check for session summaries.
 *
 * Verifies that a session summary adequately covers the observations recorded
 * during that session. Reports which topics are missing from the summary so
 * that callers can decide whether to re-summarise or proceed.
 *
 * Algorithm:
 *   1. shouldSkipVerification: if a session has fewer than 3 observations,
 *      verification is skipped (not worth the overhead).
 *   2. verify: extract the "first concept" (topic) from each observation,
 *      then check whether each topic appears anywhere in the combined summary
 *      text (request + learned + completed). Return a coverage report.
 */

import { Database } from 'bun:sqlite';

export interface VerificationResult {
  isComplete: boolean;
  missingTopics: string[];
  observationsCovered: number;
  observationsTotal: number;
}

/** Minimum observation count before we bother verifying */
const MINIMUM_OBSERVATIONS = 3;

export class CompactionVerifier {
  constructor(private db: Database) {}

  /**
   * Determine whether verification should be skipped for a session.
   *
   * @param sessionId - memory_session_id to check
   * @returns true if the session has fewer than 3 observations
   */
  shouldSkipVerification(sessionId: string): boolean {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM observations WHERE memory_session_id = ?`
    ).get(sessionId) as { cnt: number };

    return row.cnt < MINIMUM_OBSERVATIONS;
  }

  /**
   * Verify that the session summary covers all observation topics.
   *
   * @param project   - Project name (used to scope observation lookup)
   * @param sessionId - memory_session_id of the session to verify
   * @returns Coverage report
   */
  verify(project: string, sessionId: string): VerificationResult {
    // Load observations for this session+project
    const observations = this.db.prepare(
      `SELECT concepts FROM observations
       WHERE memory_session_id = ? AND project = ?`
    ).all(sessionId, project) as Array<{ concepts: string | null }>;

    const total = observations.length;

    if (total === 0) {
      return {
        isComplete: true,
        missingTopics: [],
        observationsCovered: 0,
        observationsTotal: 0,
      };
    }

    // Extract one topic per observation (first concept)
    const topics = observations.map(obs => {
      try {
        const parsed = JSON.parse(obs.concepts || '[]');
        return Array.isArray(parsed) && parsed.length > 0 ? String(parsed[0]) : 'general';
      } catch {
        return 'general';
      }
    });

    // Load the summary for this session
    const summary = this._getSummaryText(sessionId);

    // Check which topics are mentioned in the summary
    const summaryLower = summary.toLowerCase();
    const missingTopics: string[] = [];
    let covered = 0;

    for (const topic of topics) {
      if (summaryLower.includes(topic.toLowerCase())) {
        covered++;
      } else {
        missingTopics.push(topic);
      }
    }

    // Deduplicate missing topics (multiple observations may share a topic)
    const uniqueMissing = Array.from(new Set(missingTopics));

    return {
      isComplete: uniqueMissing.length === 0,
      missingTopics: uniqueMissing,
      observationsCovered: covered,
      observationsTotal: total,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Concatenate all textual fields from a session summary into a single string
   * that can be searched for topic coverage.
   */
  private _getSummaryText(sessionId: string): string {
    const row = this.db.prepare(
      `SELECT request, investigated, learned, completed, next_steps, notes
       FROM session_summaries
       WHERE memory_session_id = ?
       ORDER BY created_at_epoch DESC
       LIMIT 1`
    ).get(sessionId) as {
      request: string | null;
      investigated: string | null;
      learned: string | null;
      completed: string | null;
      next_steps: string | null;
      notes: string | null;
    } | null;

    if (!row) return '';

    return [
      row.request,
      row.investigated,
      row.learned,
      row.completed,
      row.next_steps,
      row.notes,
    ]
      .filter(Boolean)
      .join(' ');
  }
}
