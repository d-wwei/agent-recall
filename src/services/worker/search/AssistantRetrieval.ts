/**
 * AssistantRetrieval - Two-pass search for "you said/mentioned" queries
 *
 * Detects queries asking what the assistant previously said, then runs:
 * Pass 1: Search observations via LIKE for relevant sessions
 * Pass 2: Search session_summaries for those sessions' learned/next_steps/notes fields
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';

export interface AssistantSearchResult {
  sessionId: string;
  source: 'observation' | 'summary';
  content: string;
  createdAt: string;
}

/**
 * Patterns that indicate the user is asking about something the assistant previously said
 */
const ASSISTANT_QUERY_PATTERNS = [
  /你之前说过|你建议的?|你提到|你说过|你觉得|你推荐/,
  /you\s+(said|mentioned|suggested|recommended|told\s+me|advised)/i,
  /what\s+did\s+you\s+(say|suggest|recommend|advise)/i,
];

/**
 * Prefixes to strip from the query before searching for keywords.
 * After stripping these, the remaining words are used as search keywords.
 */
const PREFIX_STRIP_PATTERNS = [
  /^你之前说过\s*/,
  /^你建议的?\s*/,
  /^你提到\s*/,
  /^你说过\s*/,
  /^你觉得\s*/,
  /^你推荐\s*/,
  /^you\s+(said|mentioned|suggested|recommended|told\s+me|advised)\s*/i,
  /^what\s+did\s+you\s+(say|suggest|recommend|advise)\s*(about|regarding|on)?\s*/i,
];

export class AssistantRetrieval {
  constructor(private db: Database) {}

  /**
   * Detect whether a query is asking what the assistant previously said/suggested
   */
  isAssistantQuery(query: string): boolean {
    return ASSISTANT_QUERY_PATTERNS.some(pattern => pattern.test(query));
  }

  /**
   * Two-pass search:
   * Pass 1 — Strip the "you said/mentioned" prefix, search observations for remaining keywords
   * Pass 2 — For each matched session, search session_summaries' learned/completed/next_steps/notes
   */
  search(query: string, project: string): AssistantSearchResult[] {
    const keywords = this.extractKeywords(query);
    logger.debug(`AssistantRetrieval.search: keywords=${keywords.join(',')} project=${project}`);
    if (keywords.length === 0) {
      return [];
    }

    // Pass 1: find relevant sessions from observations
    const sessionIds = this.searchObservationsForSessions(keywords, project);

    const results: AssistantSearchResult[] = [];

    // Collect observation-level results as well
    const observationResults = this.fetchMatchingObservations(keywords, project);
    results.push(...observationResults);

    // Pass 2: for each session found in pass 1, search session_summaries
    if (sessionIds.length > 0) {
      const summaryResults = this.searchSessionSummaries(sessionIds, keywords, project);
      results.push(...summaryResults);
    }

    // Deduplicate by sessionId + source + content
    return this.deduplicateResults(results);
  }

  /**
   * Strip the "you said" prefix and return remaining keywords
   */
  private extractKeywords(query: string): string[] {
    let stripped = query.trim();

    for (const pattern of PREFIX_STRIP_PATTERNS) {
      stripped = stripped.replace(pattern, '').trim();
    }

    // Split on whitespace and filter out empty/very short tokens
    return stripped
      .split(/\s+/)
      .map(t => t.replace(/[^\w\u4e00-\u9fff]/g, '').trim())
      .filter(t => t.length >= 2);
  }

  /**
   * Pass 1: search observations using LIKE for keyword matches, return unique session IDs
   */
  private searchObservationsForSessions(keywords: string[], project: string): string[] {
    if (keywords.length === 0) return [];

    const likeClauses = keywords
      .map(() => `(o.text LIKE ? OR o.title LIKE ? OR o.narrative LIKE ? OR o.facts LIKE ?)`)
      .join(' OR ');

    const params: string[] = [];
    for (const kw of keywords) {
      const pattern = `%${kw}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    params.push(project);

    const sql = `
      SELECT DISTINCT o.memory_session_id
      FROM observations o
      WHERE (${likeClauses})
        AND o.project = ?
      LIMIT 50
    `;

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{ memory_session_id: string }>;
      return rows.map(r => r.memory_session_id).filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Pass 1b: fetch matching observation rows for content attribution
   */
  private fetchMatchingObservations(keywords: string[], project: string): AssistantSearchResult[] {
    if (keywords.length === 0) return [];

    const likeClauses = keywords
      .map(() => `(o.text LIKE ? OR o.title LIKE ? OR o.narrative LIKE ? OR o.facts LIKE ?)`)
      .join(' OR ');

    const params: string[] = [];
    for (const kw of keywords) {
      const pattern = `%${kw}%`;
      params.push(pattern, pattern, pattern, pattern);
    }
    params.push(project);

    const sql = `
      SELECT o.memory_session_id, o.text, o.title, o.narrative, o.created_at
      FROM observations o
      WHERE (${likeClauses})
        AND o.project = ?
      ORDER BY o.created_at_epoch DESC
      LIMIT 20
    `;

    try {
      const rows = this.db.prepare(sql).all(...params) as Array<{
        memory_session_id: string;
        text: string | null;
        title: string | null;
        narrative: string | null;
        created_at: string;
      }>;

      return rows
        .filter(r => r.memory_session_id)
        .map(r => ({
          sessionId: r.memory_session_id,
          source: 'observation' as const,
          content: r.narrative || r.text || r.title || '',
          createdAt: r.created_at,
        }))
        .filter(r => r.content.length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Pass 2: for the given session IDs, fetch session_summaries and return
   * all non-null learned, completed, next_steps, and notes fields.
   *
   * The session was already identified as relevant in pass 1 (observation match),
   * so all summary fields for that session are relevant context about what the
   * assistant said/recommended.
   */
  private searchSessionSummaries(
    sessionIds: string[],
    _keywords: string[],
    project: string
  ): AssistantSearchResult[] {
    if (sessionIds.length === 0) return [];

    const placeholders = sessionIds.map(() => '?').join(', ');
    const sql = `
      SELECT s.memory_session_id, s.learned, s.completed, s.next_steps, s.notes, s.created_at
      FROM session_summaries s
      WHERE s.memory_session_id IN (${placeholders})
        AND s.project = ?
      ORDER BY s.created_at_epoch DESC
      LIMIT 50
    `;

    try {
      const rows = this.db.prepare(sql).all(...sessionIds, project) as Array<{
        memory_session_id: string;
        learned: string | null;
        completed: string | null;
        next_steps: string | null;
        notes: string | null;
        created_at: string;
      }>;

      const results: AssistantSearchResult[] = [];

      for (const row of rows) {
        const fields: Array<string | null> = [
          row.learned,
          row.completed,
          row.next_steps,
          row.notes,
        ];

        for (const fieldText of fields) {
          if (!fieldText) continue;
          results.push({
            sessionId: row.memory_session_id,
            source: 'summary',
            content: fieldText,
            createdAt: row.created_at,
          });
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  /**
   * Deduplicate results — same sessionId + source + content should not repeat
   */
  private deduplicateResults(results: AssistantSearchResult[]): AssistantSearchResult[] {
    const seen = new Set<string>();
    return results.filter(r => {
      const key = `${r.sessionId}:${r.source}:${r.content}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
