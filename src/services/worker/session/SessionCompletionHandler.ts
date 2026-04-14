/**
 * Session Completion Handler
 *
 * Consolidates session completion logic for manual session deletion/completion.
 * Used by DELETE /api/sessions/:id and POST /api/sessions/:id/complete endpoints.
 *
 * Completion flow:
 * 1. Update sdk_sessions.status to 'completed' in database
 * 2. Delete session from SessionManager (aborts SDK agent, cleans up in-memory state)
 * 3. Broadcast session completed event (updates UI spinner)
 */

import { SessionManager } from '../SessionManager.js';
import { SessionEventBroadcaster } from '../events/SessionEventBroadcaster.js';
import type { DatabaseManager } from '../DatabaseManager.js';
import { logger } from '../../../utils/logger.js';

export class SessionCompletionHandler {
  constructor(
    private sessionManager: SessionManager,
    private eventBroadcaster: SessionEventBroadcaster,
    private dbManager?: DatabaseManager
  ) {}

  /**
   * Complete session by database ID
   * Used by DELETE /api/sessions/:id and POST /api/sessions/:id/complete
   */
  async completeByDbId(sessionDbId: number): Promise<void> {
    // Mark session as completed in database (persists across restarts)
    if (this.dbManager) {
      try {
        const now = new Date().toISOString();
        const nowEpoch = Date.now();
        this.dbManager.getSessionStore().db.prepare(
          "UPDATE sdk_sessions SET status = 'completed', completed_at = ?, completed_at_epoch = ? WHERE id = ? AND status = 'active'"
        ).run(now, nowEpoch, sessionDbId);
      } catch (err) {
        logger.warn('SESSION', `Failed to update session ${sessionDbId} status to completed`, {
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    // Delete from session manager (aborts SDK agent)
    await this.sessionManager.deleteSession(sessionDbId);

    // Broadcast session completed event
    this.eventBroadcaster.broadcastSessionCompleted(sessionDbId);
  }
}
