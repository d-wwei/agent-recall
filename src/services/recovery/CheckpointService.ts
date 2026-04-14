/**
 * CheckpointService - Automatic session state snapshots for resume continuity
 *
 * Saves work state periodically (via incremental-save) so that when the user
 * returns, Claude knows exactly where things left off. Uses the active_tasks
 * table's context_json field to store checkpoint data.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';
import { extractFilesFromRawMessages } from './RawContextFallback.js';

export interface TaskHistoryItem {
  prompt: string;          // cleaned user prompt (first 100 chars)
  status: 'completed' | 'pending' | 'unknown';
  timestamp: string;
}

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
  taskHistory: TaskHistoryItem[];     // progression of user requests
  conversationTopics: string[];       // what was discussed
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
      taskHistory: [],
      conversationTopics: [],
    };
  }

  /**
   * Build a smart checkpoint that analyzes both observations AND user prompts.
   * Produces richer task history, conversation topics, and smarter resume hints
   * by treating user prompts as the primary signal for what was being worked on.
   */
  buildSmartCheckpoint(
    project: string,
    sessionId: string,
    observations: any[],
    userPrompts: any[],
    sessionStartEpoch: number
  ): Checkpoint {
    // Start with base checkpoint from observations
    const base = this.buildCheckpointFromObservations(
      project, sessionId, observations,
      userPrompts.length > 0 ? userPrompts[userPrompts.length - 1]?.prompt_text || null : null
    );

    // Fallback: when observations are empty (SDK Agent pipeline down),
    // extract file info directly from raw pending_messages
    if (observations.length === 0 && base.filesModified.length === 0) {
      try {
        const rawMessages = this.db.prepare(`
          SELECT pm.tool_name, pm.tool_input, pm.content_session_id
          FROM pending_messages pm
          WHERE pm.content_session_id = ?
            AND pm.message_type = 'observation'
          ORDER BY pm.created_at_epoch ASC
        `).all(sessionId) as { tool_name: string | null; tool_input: string | null; content_session_id: string }[];

        if (rawMessages.length > 0) {
          const extracted = extractFilesFromRawMessages(rawMessages);
          base.filesModified = extracted.filesModified;
          base.filesRead = extracted.filesRead;
          base.lastToolAction = extracted.lastAction;
          base.observationCount = rawMessages.length;
          logger.debug('CHECKPOINT', `Fallback: extracted ${extracted.filesModified.length} files from ${rawMessages.length} raw messages`);
        }
      } catch {
        // Non-blocking: raw message extraction failure shouldn't break checkpoint
      }
    }

    // 1. currentTask: extract from the LATEST user prompt with cleaning
    if (userPrompts.length > 0) {
      const lastPrompt = userPrompts[userPrompts.length - 1];
      const cleanedPrompt = cleanPromptText(lastPrompt.prompt_text || '');
      base.currentTask = cleanedPrompt.substring(0, 120) || base.currentTask;
    }

    // 2. taskHistory: build task progression from ALL user prompts
    const taskHistory: TaskHistoryItem[] = [];
    for (let i = 0; i < userPrompts.length; i++) {
      const prompt = userPrompts[i];
      const promptText = cleanPromptText(prompt.prompt_text || '');
      if (!promptText) continue;

      const isLast = i === userPrompts.length - 1;
      const promptEpoch = prompt.created_at_epoch || 0;

      // Check if observations after this prompt indicate completion
      const hasCompletionAfter = observations.some(obs => {
        const obsEpoch = obs.created_at_epoch || 0;
        if (obsEpoch <= promptEpoch) return false;
        const type = (obs.type || '').toLowerCase();
        const narrative = (obs.narrative || '').toLowerCase();
        const title = (obs.title || '').toLowerCase();
        return type === 'feature' || type === 'bugfix' ||
          /\b(completed|fixed|implemented|added|created|resolved|finished|done)\b/.test(narrative) ||
          /\b(completed|fixed|implemented|added|created|resolved|finished|done)\b/.test(title);
      });

      let status: 'completed' | 'pending' | 'unknown';
      if (isLast && !hasCompletionAfter) {
        status = 'pending';
      } else if (hasCompletionAfter) {
        status = 'completed';
      } else {
        status = 'unknown';
      }

      taskHistory.push({
        prompt: promptText.substring(0, 100),
        status,
        timestamp: prompt.created_at || new Date().toISOString(),
      });
    }
    base.taskHistory = taskHistory;

    // 3. pendingWork: smarter detection
    // Add: last prompt if no observation followed it
    if (userPrompts.length > 0) {
      const lastPrompt = userPrompts[userPrompts.length - 1];
      const lastPromptEpoch = lastPrompt.created_at_epoch || 0;
      const hasObsAfterLastPrompt = observations.some(obs =>
        (obs.created_at_epoch || 0) > lastPromptEpoch
      );
      if (!hasObsAfterLastPrompt) {
        const cleaned = cleanPromptText(lastPrompt.prompt_text || '');
        if (cleaned && !base.pendingWork.some(p => p.toLowerCase().includes(cleaned.substring(0, 30).toLowerCase()))) {
          base.pendingWork.push(`Unfinished: ${cleaned.substring(0, 80)}`);
        }
      }
    }
    // Add: test failures from observations
    if (base.testStatus && /fail/i.test(base.testStatus)) {
      const testObs = observations.filter(obs => {
        const text = [obs.title, obs.narrative].filter(Boolean).join(' ').toLowerCase();
        return text.includes('test') && text.includes('fail');
      });
      for (const obs of testObs) {
        const files = obs.files_modified || obs.files_read || '';
        const fileHint = typeof files === 'string' ? parseFilesList(files)[0] : (Array.isArray(files) ? files[0] : '');
        if (fileHint && !base.pendingWork.some(p => p.includes(fileHint))) {
          base.pendingWork.push(`Fix failing tests in ${fileHint}`);
        }
      }
    }

    // 4. resumeHint: much smarter
    base.resumeHint = buildSmartResumeHint(
      base, userPrompts, observations
    );

    // 5. conversationTopics: extracted from prompt topics
    const topics = new Set<string>();
    for (const prompt of userPrompts) {
      const text = prompt.prompt_text || '';
      // Extract topic: first meaningful clause (up to 60 chars)
      const cleaned = cleanPromptText(text);
      if (cleaned) {
        // Take first sentence or first 60 chars
        const firstSentence = cleaned.split(/[.!?\n]/)[0]?.trim();
        if (firstSentence && firstSentence.length > 3) {
          topics.add(firstSentence.substring(0, 60));
        }
      }
    }
    base.conversationTopics = Array.from(topics);

    return base;
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

/**
 * Clean a user prompt by removing common prefixes and trimming
 */
function cleanPromptText(text: string): string {
  let cleaned = text.trim();
  // Strip common conversational prefixes — apply repeatedly to handle chained prefixes
  // e.g., "Can you please fix..." → "fix..."
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(can you|could you|please|help me|i want to|i need to|let's|let us)\s+/i, '');
  }
  // Strip leading punctuation
  cleaned = cleaned.replace(/^[,;:\-–—]+\s*/, '');
  return cleaned.trim();
}

/**
 * Build a smarter resume hint that considers user prompts, observations, and test status
 */
function buildSmartResumeHint(
  checkpoint: Checkpoint,
  userPrompts: any[],
  observations: any[]
): string {
  // Priority 1: If tests are failing, that's the most actionable hint
  if (checkpoint.testStatus && /fail/i.test(checkpoint.testStatus)) {
    const recentModified = checkpoint.filesModified.slice(-1);
    const fileHint = recentModified.length > 0 ? ` in ${recentModified[0]}` : '';
    return `Tests failing (${checkpoint.testStatus})${fileHint} — fix before continuing`;
  }

  // Priority 2: If last prompt had no completion signal
  if (userPrompts.length > 0) {
    const lastPrompt = userPrompts[userPrompts.length - 1];
    const lastPromptEpoch = lastPrompt.created_at_epoch || 0;
    const hasCompletionAfter = observations.some(obs => {
      const obsEpoch = obs.created_at_epoch || 0;
      if (obsEpoch <= lastPromptEpoch) return false;
      const type = (obs.type || '').toLowerCase();
      const narrative = (obs.narrative || '').toLowerCase();
      return type === 'feature' || type === 'bugfix' ||
        /\b(completed|fixed|implemented|finished|done)\b/.test(narrative);
    });

    if (!hasCompletionAfter) {
      const cleaned = cleanPromptText(lastPrompt.prompt_text || '');
      if (cleaned) {
        return `User asked '${cleaned.substring(0, 80)}' but it wasn't finished`;
      }
    }
  }

  // If multiple files modified, point to the most recent
  if (checkpoint.filesModified.length > 0) {
    const lastFile = checkpoint.filesModified[checkpoint.filesModified.length - 1];
    return `Last working on ${lastFile}`;
  }

  // Default
  return `Continue from where ${checkpoint.currentTask.substring(0, 60)} left off`;
}
