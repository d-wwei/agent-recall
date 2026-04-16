/**
 * Session Complete Handler - Stop (Phase 2)
 *
 * Completes the session after summarize has been queued.
 * This removes the session from the active sessions map, allowing
 * the orphan reaper to clean up any remaining subprocess.
 *
 * Fixes Issue #842: Orphan reaper starts but never reaps because
 * sessions stay in the active sessions map forever.
 */

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { ensureWorkerRunning, workerHttpRequest, getWorkerPort } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { DB_PATH } from '../../shared/paths.js';

/**
 * Direct DB fallback: when Worker is DOWN, open SQLite directly to
 * mark the session completed, backfill summary, and create diary entry.
 * This prevents sessions from being stuck as 'active' forever.
 */
async function directDbFallback(contentSessionId: string): Promise<void> {
  let db: import('bun:sqlite').Database | null = null;
  try {
    const { Database } = await import('bun:sqlite');
    db = new Database(DB_PATH, { readwrite: true });
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA foreign_keys = ON');

    // 1. Find session and mark completed
    const session = db.prepare(
      "SELECT id, memory_session_id, project FROM sdk_sessions WHERE content_session_id = ? AND status = 'active' LIMIT 1"
    ).get(contentSessionId) as { id: number; memory_session_id: string | null; project: string } | null;

    if (!session) {
      // Session already completed or doesn't exist — nothing to do
      logger.debug('HOOK', 'session-complete fallback: session not active or not found', { contentSessionId });
      return;
    }

    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    db.prepare(
      "UPDATE sdk_sessions SET status = 'completed', completed_at = ?, completed_at_epoch = ? WHERE id = ?"
    ).run(now, nowEpoch, session.id);
    logger.info('HOOK', 'session-complete fallback: marked completed via direct DB', { contentSessionId, sessionDbId: session.id });

    if (!session.memory_session_id) return;

    // 2. Backfill summary if missing
    const existingSummary = db.prepare(
      'SELECT id FROM session_summaries WHERE memory_session_id = ? LIMIT 1'
    ).get(session.memory_session_id) as { id: number } | undefined;

    if (!existingSummary) {
      const prompts = db.prepare(
        'SELECT prompt_text FROM user_prompts WHERE content_session_id = ? ORDER BY prompt_number ASC LIMIT 5'
      ).all(contentSessionId) as { prompt_text: string }[];

      const observations = db.prepare(
        'SELECT title, narrative, type FROM observations WHERE memory_session_id = ? ORDER BY created_at_epoch ASC LIMIT 10'
      ).all(session.memory_session_id) as { title: string; narrative: string; type: string }[];

      if (prompts.length > 0 || observations.length > 0) {
        const request = prompts.map(p => p.prompt_text).join('; ').slice(0, 500) || 'No prompt recorded';
        const completed = observations
          .map(o => `[${o.type}] ${o.title}`)
          .join('; ')
          .slice(0, 500) || 'No observations recorded';
        const learned = observations
          .filter(o => o.narrative)
          .map(o => o.narrative)
          .join('; ')
          .slice(0, 500) || '';

        db.prepare(`
          INSERT INTO session_summaries
          (memory_session_id, project, request, investigated, learned, completed, next_steps, notes, created_at, created_at_epoch)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          session.memory_session_id,
          session.project,
          request,
          observations.length > 0
            ? `Worked on: ${observations.map(o => o.type).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`
            : 'Session completed without detailed investigation',
          learned || 'Session completed without detailed observations',
          completed || 'Session completed',
          'Continue based on session context',
          '[auto-backfilled at session complete — worker unavailable]',
          now,
          nowEpoch
        );
        logger.info('HOOK', 'session-complete fallback: backfilled summary', { contentSessionId });
      }
    }

    // 3. Create diary entry if missing
    const existingDiary = db.prepare(
      'SELECT id FROM agent_diary WHERE memory_session_id = ? LIMIT 1'
    ).get(session.memory_session_id) as { id: number } | undefined;

    if (!existingDiary) {
      const summaryRow = db.prepare(
        'SELECT request, completed FROM session_summaries WHERE memory_session_id = ? LIMIT 1'
      ).get(session.memory_session_id) as { request: string; completed: string } | undefined;

      const diaryText = summaryRow
        ? `Session: ${summaryRow.request}. Completed: ${summaryRow.completed}`.slice(0, 1000)
        : 'Session completed (no summary available)';

      db.prepare(
        'INSERT INTO agent_diary (memory_session_id, project, entry) VALUES (?, ?, ?)'
      ).run(session.memory_session_id, session.project, diaryText);
      logger.debug('HOOK', 'session-complete fallback: created diary entry', { contentSessionId });
    }
  } catch (err) {
    logger.warn('HOOK', 'session-complete fallback failed', {
      error: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (db) {
      try { db.close(); } catch { /* best-effort */ }
    }
  }
}

export const sessionCompleteHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Ensure worker is running
    const workerReady = await ensureWorkerRunning();
    if (!workerReady) {
      // Worker not available — fall back to direct DB access
      const { sessionId } = input;
      if (sessionId) {
        await directDbFallback(sessionId);
      }
      return { continue: true, suppressOutput: true };
    }

    const { sessionId } = input;

    if (!sessionId) {
      logger.warn('HOOK', 'session-complete: Missing sessionId, skipping');
      return { continue: true, suppressOutput: true };
    }

    logger.info('HOOK', '→ session-complete: Removing session from active map', {
      contentSessionId: sessionId
    });

    try {
      // Call the session complete endpoint by contentSessionId
      const response = await workerHttpRequest('/api/sessions/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId
        })
      });

      if (!response.ok) {
        const text = await response.text();
        logger.warn('HOOK', 'session-complete: Failed to complete session', {
          status: response.status,
          body: text
        });
      } else {
        logger.info('HOOK', 'Session completed successfully', { contentSessionId: sessionId });
      }
    } catch (error) {
      // Log but don't fail - session may already be gone
      logger.warn('HOOK', 'session-complete: Error completing session', {
        error: (error as Error).message
      });
    }

    // Fire compilation check (non-blocking) — send contentSessionId so the worker
    // can look up the actual project name from the database (not the cwd path)
    const port = getWorkerPort();
    fetch(`http://localhost:${port}/api/compilation/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentSessionId: sessionId }),
    }).catch(() => {});

    return { continue: true, suppressOutput: true };
  }
};
