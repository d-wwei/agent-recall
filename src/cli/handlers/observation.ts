/**
 * Observation Handler - PostToolUse
 *
 * Extracted from save-hook.ts - sends tool usage to worker for storage.
 */

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { ensureWorkerRunning, workerHttpRequest, buildWorkerUrl } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';
import { isProjectExcluded } from '../../utils/project-filter.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';

/**
 * In-memory observation counter per session (Phase 5.1 — periodic save).
 * Resets when the hook process exits; only tracks counts within a single
 * Claude Code session lifetime. Keys are contentSessionId strings.
 */
const observationCounts: Map<string, number> = new Map();

/** Fire incremental-save checkpoint on every tool call for zero data loss */
const INCREMENTAL_SAVE_INTERVAL = 1;

export const observationHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    // Ensure worker is running before any other logic
    const workerReady = await ensureWorkerRunning();
    if (!workerReady) {
      // Worker not available - skip observation gracefully
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    const { sessionId, cwd, toolName, toolInput, toolResponse } = input;

    if (!toolName) {
      // No tool name provided - skip observation gracefully
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    const toolStr = logger.formatTool(toolName, toolInput);

    logger.dataIn('HOOK', `PostToolUse: ${toolStr}`, {});

    // Validate required fields before sending to worker
    if (!cwd) {
      throw new Error(`Missing cwd in PostToolUse hook input for session ${sessionId}, tool ${toolName}`);
    }

    // Check if project is excluded from tracking
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    if (isProjectExcluded(cwd, settings.CLAUDE_MEM_EXCLUDED_PROJECTS)) {
      logger.debug('HOOK', 'Project excluded from tracking, skipping observation', { cwd, toolName });
      return { continue: true, suppressOutput: true };
    }

    // Send to worker - worker handles privacy check and database operations
    try {
      const response = await workerHttpRequest('/api/sessions/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: sessionId,
          tool_name: toolName,
          tool_input: toolInput,
          tool_response: toolResponse,
          cwd
        })
      });

      if (!response.ok) {
        // Log but don't throw — observation storage failure should not block tool use
        logger.warn('HOOK', 'Observation storage failed, skipping', { status: response.status, toolName });
        return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
      }

      logger.debug('HOOK', 'Observation sent successfully', { toolName });

      // Periodic save: every N observations, fire a non-blocking checkpoint request (Phase 5.1)
      // This creates safety checkpoints for long sessions to survive worker crashes.
      if (sessionId) {
        const count = (observationCounts.get(sessionId) ?? 0) + 1;
        observationCounts.set(sessionId, count);

        if (count % INCREMENTAL_SAVE_INTERVAL === 0) {
          logger.debug('HOOK', 'Firing incremental save checkpoint', { sessionId, count });
          // Fire-and-forget — must not delay hook response
          fetch(buildWorkerUrl('/api/incremental-save'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contentSessionId: sessionId, project: cwd })
          }).catch(() => {});
        }
      }
    } catch (error) {
      // Worker unreachable — skip observation gracefully
      logger.warn('HOOK', 'Observation fetch error, skipping', { error: error instanceof Error ? error.message : String(error) });
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    return { continue: true, suppressOutput: true };
  }
};
