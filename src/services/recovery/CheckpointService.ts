/**
 * CheckpointService - Automatic session state snapshots for resume continuity
 *
 * Saves work state periodically (via incremental-save) so that when the user
 * returns, Claude knows exactly where things left off. Uses the active_tasks
 * table's context_json field to store checkpoint data.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface Checkpoint {
  currentTask: string;           // what the user is doing (from latest user prompt)
  filesModified: string[];       // accumulated files changed in this session
  filesRead: string[];           // accumulated files read
  testStatus: string | null;     // last test result: "3 pass, 1 fail" or null
  pendingWork: string[];         // TODOs/unfinished items detected
  lastToolAction: string;        // "Read src/auth/middleware.ts" — last thing done
  observationCount: number;      // how many observations this session
  resumeHint: string;            // one-line "start here next time"
  savedAt: string;               // ISO timestamp
}

export class CheckpointService {
  constructor(private db: Database) {}

  /**
   * Upsert checkpoint into active_tasks with checkpoint data in context_json
   */
  saveCheckpoint(project: string, sessionId: string, checkpoint: Checkpoint): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    // Check if an active task already exists for this project
    const existing = this.db.prepare(
      "SELECT id, context_json FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1"
    ).get(project) as { id: number; context_json: string | null } | undefined;

    if (existing) {
      // Merge checkpoint into existing context_json (preserve checkpoints array etc.)
      let existingContext: Record<string, any> = {};
      if (existing.context_json) {
        try {
          existingContext = JSON.parse(existing.context_json);
        } catch {
          // ignore parse errors
        }
      }
      existingContext.session_checkpoint = checkpoint;

      this.db.prepare(
        `UPDATE active_tasks SET
          task_name = ?,
          context_json = ?,
          status = 'in_progress',
          updated_at = ?,
          updated_at_epoch = ?
        WHERE id = ?`
      ).run(
        checkpoint.currentTask,
        JSON.stringify(existingContext),
        now,
        nowEpoch,
        existing.id
      );
    } else {
      // Insert new active task with checkpoint
      const contextJson = JSON.stringify({ session_checkpoint: checkpoint });
      this.db.prepare(`
        INSERT INTO active_tasks (project, task_name, status, context_json, started_at, started_at_epoch, updated_at, updated_at_epoch)
        VALUES (?, ?, 'in_progress', ?, ?, ?, ?, ?)
      `).run(
        project,
        checkpoint.currentTask,
        contextJson,
        now,
        nowEpoch,
        now,
        nowEpoch
      );
    }

    logger.debug('CHECKPOINT', `Saved checkpoint for ${project}: ${checkpoint.currentTask} (${checkpoint.observationCount} obs)`);
  }

  /**
   * Get the most recent checkpoint for a project
   */
  getLatestCheckpoint(project: string): Checkpoint | null {
    const row = this.db.prepare(
      "SELECT context_json FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1"
    ).get(project) as { context_json: string | null } | undefined;

    if (!row || !row.context_json) return null;

    try {
      const context = JSON.parse(row.context_json);
      return context.session_checkpoint || null;
    } catch {
      return null;
    }
  }

  /**
   * Build a checkpoint from accumulated observations in the current session
   */
  buildCheckpointFromObservations(
    project: string,
    sessionId: string,
    observations: any[],
    lastUserPrompt: string | null
  ): Checkpoint {
    // currentTask: from last user prompt or fallback
    const currentTask = lastUserPrompt
      ? lastUserPrompt.substring(0, 100)
      : `Working on ${project}`;

    // Aggregate files from all observations
    const filesModifiedSet = new Set<string>();
    const filesReadSet = new Set<string>();

    for (const obs of observations) {
      if (obs.files_modified) {
        const files = typeof obs.files_modified === 'string'
          ? parseFilesList(obs.files_modified)
          : obs.files_modified;
        if (Array.isArray(files)) {
          files.forEach((f: string) => filesModifiedSet.add(f));
        }
      }
      if (obs.files_read) {
        const files = typeof obs.files_read === 'string'
          ? parseFilesList(obs.files_read)
          : obs.files_read;
        if (Array.isArray(files)) {
          files.forEach((f: string) => filesReadSet.add(f));
        }
      }
    }

    // Test status: find last observation mentioning test results
    let testStatus: string | null = null;
    for (let i = observations.length - 1; i >= 0; i--) {
      const obs = observations[i];
      const text = [obs.title, obs.narrative, obs.facts].filter(Boolean).join(' ').toLowerCase();
      if (text.includes('test') && (text.includes('pass') || text.includes('fail'))) {
        // Extract a concise test status
        const passMatch = text.match(/(\d+)\s*(?:tests?\s+)?pass/);
        const failMatch = text.match(/(\d+)\s*(?:tests?\s+)?fail/);
        const parts: string[] = [];
        if (passMatch) parts.push(`${passMatch[1]} pass`);
        if (failMatch) parts.push(`${failMatch[1]} fail`);
        if (parts.length > 0) {
          testStatus = parts.join(', ');
        } else {
          testStatus = text.includes('fail') ? 'tests failing' : 'tests passing';
        }
        break;
      }
    }

    // Pending work: observations with TODO/WIP/incomplete markers
    const pendingWork: string[] = [];
    const pendingPatterns = /\b(TODO|not yet|incomplete|WIP|work.in.progress|unfinished|remaining|still need)\b/i;
    for (const obs of observations) {
      const narrative = obs.narrative || '';
      if (pendingPatterns.test(narrative)) {
        const hint = obs.title || narrative.substring(0, 80);
        pendingWork.push(hint);
      }
    }

    // Last tool action: title of most recent observation
    const lastObs = observations[observations.length - 1];
    const lastToolAction = lastObs
      ? (lastObs.title || lastObs.subtitle || 'Unknown action')
      : 'No actions recorded';

    // Build resume hint
    const resumeHint = buildResumeHint(lastToolAction, pendingWork);

    return {
      currentTask,
      filesModified: Array.from(filesModifiedSet),
      filesRead: Array.from(filesReadSet),
      testStatus,
      pendingWork,
      lastToolAction,
      observationCount: observations.length,
      resumeHint,
      savedAt: new Date().toISOString(),
    };
  }

  /**
   * Clear checkpoint after session ends (summary takes over)
   */
  clearCheckpoint(project: string): void {
    const row = this.db.prepare(
      "SELECT id, context_json FROM active_tasks WHERE project = ? AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 1"
    ).get(project) as { id: number; context_json: string | null } | undefined;

    if (!row) return;

    // Remove checkpoint from context_json but keep other fields
    if (row.context_json) {
      try {
        const context = JSON.parse(row.context_json);
        delete context.session_checkpoint;
        const now = new Date().toISOString();
        const nowEpoch = Date.now();
        this.db.prepare(
          "UPDATE active_tasks SET context_json = ?, updated_at = ?, updated_at_epoch = ? WHERE id = ?"
        ).run(JSON.stringify(context), now, nowEpoch, row.id);
      } catch {
        // ignore parse errors
      }
    }

    logger.debug('CHECKPOINT', `Cleared checkpoint for ${project}`);
  }
}

/**
 * Parse a files list from either JSON array string or comma-separated string
 */
function parseFilesList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON, try comma-separated
  }
  return raw.split(',').map(f => f.trim()).filter(Boolean);
}

/**
 * Build a one-line resume hint from the last action and pending work
 */
function buildResumeHint(lastToolAction: string, pendingWork: string[]): string {
  const parts: string[] = [];
  if (lastToolAction && lastToolAction !== 'No actions recorded') {
    parts.push(`Last: ${lastToolAction}`);
  }
  if (pendingWork.length > 0) {
    parts.push(`Next: ${pendingWork[0]}`);
  }
  if (parts.length === 0) {
    return 'Continue working on the project';
  }
  return parts.join('. ');
}
