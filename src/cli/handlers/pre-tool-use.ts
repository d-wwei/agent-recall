/**
 * PreToolUse Handler — proactive memory hint before file search tools.
 *
 * When Claude is about to use Glob/Grep/Read/Bash on a file,
 * checks if compiled_knowledge has relevant entries and injects a hint.
 */

import type { EventHandler, NormalizedHookInput, HookResult } from '../types.js';
import { buildWorkerUrl, fetchWithTimeout } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';
import { HOOK_EXIT_CODES } from '../../shared/hook-constants.js';

/** Tools that trigger proactive memory lookup. */
const FILE_SEARCH_TOOLS = new Set(['Glob', 'Grep', 'Read', 'Bash']);

/** Bash commands that indicate file reading (worth checking memory for). */
const BASH_FILE_COMMANDS = /^\s*(grep|find|cat|head|tail)/;

/**
 * Extract a meaningful search term from a tool invocation.
 * Returns null if the tool isn't a file-search or the input is unusable.
 */
export function extractSearchTerm(toolName: string, input: any): string | null {
  if (!input) return null;

  if (toolName === 'Read' && input.file_path) {
    // Extract filename from path
    const parts = String(input.file_path).split('/');
    return parts[parts.length - 1] || null;
  }
  if (toolName === 'Grep' && input.pattern) {
    return String(input.pattern);
  }
  if (toolName === 'Glob' && input.pattern) {
    return String(input.pattern);
  }
  if (toolName === 'Bash' && typeof input.command === 'string') {
    // Only for grep/find/cat/head/tail commands
    if (BASH_FILE_COMMANDS.test(input.command)) {
      const tokens = input.command.trim().split(/\s+/);
      return tokens[tokens.length - 1] || null;
    }
  }
  return null;
}

export const preToolUseHandler: EventHandler = {
  async execute(input: NormalizedHookInput): Promise<HookResult> {
    const toolName = input.toolName ?? '';

    // Only trigger for file-reading tools
    if (!FILE_SEARCH_TOOLS.has(toolName)) {
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    const searchTerm = extractSearchTerm(toolName, input.toolInput);
    if (!searchTerm) {
      return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
    }

    try {
      const url = buildWorkerUrl(`/api/search?q=${encodeURIComponent(searchTerm)}&limit=2&format=json`);
      const response = await fetchWithTimeout(url, {}, 3000);

      if (!response.ok) {
        return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
      }

      const data = await response.json() as { observations?: { title?: string }[] };

      if (data.observations && data.observations.length > 0) {
        const topics = data.observations
          .map((o: any) => o.title)
          .filter(Boolean)
          .slice(0, 2)
          .join(', ');

        if (topics) {
          return {
            continue: true,
            suppressOutput: false,
            systemMessage: `> Related memory: ${topics}. Check /mem-search before raw file search.`,
            exitCode: HOOK_EXIT_CODES.SUCCESS,
          };
        }
      }
    } catch (err) {
      // Non-fatal — worker may not be running
      logger.debug('HOOK', 'PreToolUse memory lookup failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { continue: true, suppressOutput: true, exitCode: HOOK_EXIT_CODES.SUCCESS };
  },
};
