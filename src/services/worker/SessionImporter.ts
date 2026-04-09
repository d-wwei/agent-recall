/**
 * SessionImporter - Import conversation history from JSONL or structured records
 *
 * Supports:
 *   - JSONL files (one JSON object per line)
 *   - Structured ImportRecord arrays
 *
 * Session splitting: new session when gap > 30 minutes between consecutive messages.
 * Observation extraction: assistant messages become 'discovery' type observations.
 */

import type { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { storeObservation } from '../sqlite/observations/store.js';

/** 30-minute gap threshold for session splitting (ms) */
const SESSION_GAP_MS = 30 * 60 * 1000;

export interface ImportRecord {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string; // ISO date
  session_id?: string; // optional explicit session grouping
}

export interface ImportResult {
  sessionsCreated: number;
  observationsCreated: number;
  errors: string[];
}

/** Internal record with resolved epoch for sorting/splitting */
interface NormalizedRecord extends ImportRecord {
  epochMs: number;
}

/**
 * Extract simple keywords from text:
 * words longer than 5 chars, lowercased, deduplicated, sorted.
 */
export function extractConcepts(text: string): string[] {
  const words = text
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter((w) => w.length > 5);

  return [...new Set(words)].sort();
}

export class SessionImporter {
  constructor(private db: Database) {}

  /**
   * Parse JSONL content and import as sessions.
   * Malformed lines are skipped with error messages in result.
   */
  importJsonl(jsonlContent: string, project: string): ImportResult {
    const result: ImportResult = {
      sessionsCreated: 0,
      observationsCreated: 0,
      errors: [],
    };

    if (!jsonlContent || !jsonlContent.trim()) {
      return result;
    }

    const lines = jsonlContent.split('\n').filter((l) => l.trim().length > 0);
    const records: ImportRecord[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      try {
        const obj = JSON.parse(line);
        if (obj.role !== 'user' && obj.role !== 'assistant') {
          result.errors.push(`Line ${i + 1}: invalid role "${obj.role}"`);
          continue;
        }
        if (typeof obj.content !== 'string') {
          result.errors.push(`Line ${i + 1}: content must be a string`);
          continue;
        }
        records.push({
          role: obj.role,
          content: obj.content,
          timestamp: typeof obj.timestamp === 'string' ? obj.timestamp : undefined,
          session_id: typeof obj.session_id === 'string' ? obj.session_id : undefined,
        });
      } catch {
        result.errors.push(`Line ${i + 1}: invalid JSON`);
      }
    }

    if (records.length === 0) {
      return result;
    }

    const sub = this._importRecords(records, project);
    result.sessionsCreated += sub.sessionsCreated;
    result.observationsCreated += sub.observationsCreated;
    result.errors.push(...sub.errors);

    return result;
  }

  /**
   * Import a single conversation array as one or more sessions.
   * If sessionId is provided, all records are forced into that single session
   * (no time-based splitting).
   */
  importConversation(
    records: ImportRecord[],
    project: string,
    sessionId?: string
  ): ImportResult {
    const result: ImportResult = {
      sessionsCreated: 0,
      observationsCreated: 0,
      errors: [],
    };

    if (!records || records.length === 0) {
      return result;
    }

    if (sessionId) {
      // Single forced session — no gap splitting
      const sub = this._processSession(records, project, sessionId);
      result.sessionsCreated += sub.sessionsCreated;
      result.observationsCreated += sub.observationsCreated;
      result.errors.push(...sub.errors);
    } else {
      const sub = this._importRecords(records, project);
      result.sessionsCreated += sub.sessionsCreated;
      result.observationsCreated += sub.observationsCreated;
      result.errors.push(...sub.errors);
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Normalize records (assign epoch), sort by timestamp, split into sessions
   * based on time gaps or session_id changes, then process each group.
   */
  private _importRecords(records: ImportRecord[], project: string): ImportResult {
    const result: ImportResult = {
      sessionsCreated: 0,
      observationsCreated: 0,
      errors: [],
    };

    // Normalize: assign epoch (fallback to insertion order for records without timestamps)
    const normalized: NormalizedRecord[] = records.map((r, i) => ({
      ...r,
      epochMs: r.timestamp ? new Date(r.timestamp).getTime() : i,
    }));

    // Sort by epoch
    normalized.sort((a, b) => a.epochMs - b.epochMs);

    // Split into groups by time gap or explicit session_id change
    const groups: NormalizedRecord[][] = [];
    let current: NormalizedRecord[] = [];
    let prevEpoch: number | null = null;
    let prevSessionId: string | undefined = undefined;

    for (const rec of normalized) {
      const hasTimestamp = rec.timestamp != null;
      const explicitSessionChange =
        rec.session_id !== undefined && rec.session_id !== prevSessionId && current.length > 0;

      const timeGap =
        prevEpoch !== null && hasTimestamp && rec.epochMs - prevEpoch > SESSION_GAP_MS;

      if (current.length > 0 && (explicitSessionChange || timeGap)) {
        groups.push(current);
        current = [];
      }

      current.push(rec);
      prevEpoch = hasTimestamp ? rec.epochMs : prevEpoch;
      prevSessionId = rec.session_id;
    }

    if (current.length > 0) {
      groups.push(current);
    }

    // Process each group
    for (const group of groups) {
      // Generate a session ID from the earliest timestamp in the group
      const earliest = group[0];
      const ts =
        earliest.timestamp
          ? new Date(earliest.timestamp).getTime()
          : Date.now();
      const generatedSessionId = `import-${ts}`;

      const sub = this._processSession(group, project, generatedSessionId);
      result.sessionsCreated += sub.sessionsCreated;
      result.observationsCreated += sub.observationsCreated;
      result.errors.push(...sub.errors);
    }

    return result;
  }

  /**
   * Create one SDK session from a group of records and extract observations
   * from assistant messages.
   */
  private _processSession(
    records: ImportRecord[],
    project: string,
    sessionId: string
  ): ImportResult {
    const result: ImportResult = {
      sessionsCreated: 0,
      observationsCreated: 0,
      errors: [],
    };

    try {
      // Find the first user message to use as the session prompt
      const firstUser = records.find((r) => r.role === 'user');
      const userPrompt = firstUser
        ? firstUser.content.slice(0, 200)
        : '(imported conversation)';

      // For imported sessions we set memory_session_id = content_session_id.
      // Unlike live SDK sessions (where memory_session_id starts NULL and is
      // populated by SDKAgent on first response), imported sessions have no
      // live SDK session to capture from.  The FK on observations requires
      // memory_session_id to be non-null and to exist in sdk_sessions, so we
      // use the same value for both columns.
      const now = new Date();
      const nowIso = now.toISOString();
      const nowEpoch = now.getTime();

      const existing = this.db.prepare(
        'SELECT id FROM sdk_sessions WHERE content_session_id = ?'
      ).get(sessionId) as { id: number } | undefined;

      if (!existing) {
        this.db.prepare(`
          INSERT INTO sdk_sessions
          (content_session_id, memory_session_id, project, user_prompt, started_at, started_at_epoch, status)
          VALUES (?, ?, ?, ?, ?, ?, 'completed')
        `).run(sessionId, sessionId, project, userPrompt, nowIso, nowEpoch);
      }

      result.sessionsCreated = 1;

      // Extract observations from assistant messages
      for (const rec of records) {
        if (rec.role !== 'assistant') continue;

        const title = rec.content.slice(0, 100);
        const concepts = extractConcepts(rec.content);

        const timestampEpoch = rec.timestamp
          ? new Date(rec.timestamp).getTime()
          : undefined;

        storeObservation(
          this.db,
          sessionId,
          project,
          {
            type: 'discovery',
            title,
            subtitle: null,
            facts: [],
            narrative: rec.content,
            concepts,
            files_read: [],
            files_modified: [],
          },
          undefined,
          0,
          timestampEpoch
        );

        result.observationsCreated++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('WORKER', `SessionImporter: failed to process session ${sessionId}`, {}, msg);
      result.errors.push(`Session ${sessionId}: ${msg}`);
    }

    return result;
  }
}
