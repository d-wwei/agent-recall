/**
 * PrivacyGuard — filters observations containing <private> tags before compilation.
 *
 * Any observation whose narrative, title, or any fact contains a `<private>` tag
 * (case-insensitive) is excluded from the compilation pipeline.
 *
 * Session-level propagation: when ANY observation in a session is private,
 * ALL observations from that session are excluded. This prevents information
 * leakage through correlated non-tagged observations in the same session.
 */

import { Database } from 'bun:sqlite';

export interface ObservationRecord {
  id: number;
  memory_session_id?: string;
  narrative?: string | null;
  title?: string | null;
  facts?: string | string[] | null;
  type?: string;
  concepts?: string[];
  project?: string;
}

export class PrivacyGuard {
  private db: Database | null;

  constructor(db?: Database) {
    this.db = db ?? null;
  }

  /**
   * Filter observations for compilation, applying both tag-level and
   * session-level privacy propagation.
   *
   * When any observation in a session is private, ALL observations from
   * that session are excluded — not just the tagged ones.
   */
  filterForCompilation(observations: any[]): any[] {
    // Collect session IDs that contain at least one private observation
    const privateSessions = new Set<string>();
    for (const obs of observations) {
      if (this.isPrivate(obs) && obs.memory_session_id) {
        privateSessions.add(obs.memory_session_id);
      }
    }

    // Filter out ALL observations from private sessions, not just tagged ones
    return observations.filter(obs =>
      !this.isPrivate(obs) && !privateSessions.has(obs.memory_session_id)
    );
  }

  isPrivate(observation: any): boolean {
    const privatePattern = /<private>/i;

    if (observation.narrative && privatePattern.test(observation.narrative)) return true;
    if (observation.title && privatePattern.test(observation.title)) return true;

    // facts is stored as JSON string or already-parsed array
    if (observation.facts) {
      try {
        const facts =
          typeof observation.facts === 'string'
            ? JSON.parse(observation.facts)
            : observation.facts;
        if (Array.isArray(facts) && facts.some((f: string) => privatePattern.test(f))) return true;
      } catch {
        // malformed JSON — skip silently
      }
    }

    return false;
  }

  /**
   * Mark an entire session as containing private content.
   * Updates the sdk_sessions.has_private_content flag.
   *
   * This allows pre-emptive session-level filtering even before
   * individual observations are scanned.
   */
  markSessionPrivate(sessionId: string): void {
    if (!this.db) return;

    try {
      this.db.prepare(
        'UPDATE sdk_sessions SET has_private_content = 1 WHERE memory_session_id = ? OR content_session_id = ?'
      ).run(sessionId, sessionId);
    } catch {
      // Non-blocking: table may not have the column yet
    }
  }

  /**
   * Check if a session is marked as containing private content.
   */
  isSessionPrivate(sessionId: string): boolean {
    if (!this.db) return false;

    try {
      const row = this.db.prepare(
        'SELECT has_private_content FROM sdk_sessions WHERE memory_session_id = ? OR content_session_id = ?'
      ).get(sessionId, sessionId) as { has_private_content: number } | undefined;
      return row?.has_private_content === 1;
    } catch {
      return false;
    }
  }
}
