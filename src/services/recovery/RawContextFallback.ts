/**
 * RawContextFallback — Build session context from raw pending_messages + user_prompts
 *
 * When the SDK Agent pipeline is down (pool exhaustion, crashes, etc.),
 * observations and session_summaries tables are empty. This service
 * extracts actionable context directly from the raw data that WAS
 * persisted — pending_messages (tool_name, tool_input) and user_prompts.
 *
 * No AI processing needed — pure rule-based extraction.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface FallbackContext {
  hasData: boolean;
  filesModified: string[];
  filesRead: string[];
  commands: string[];
  lastAction: string;
  userRequests: string[];
  sessionCount: number;
  messageCount: number;
}

interface RawMessage {
  tool_name: string | null;
  tool_input: string | null;
  content_session_id: string;
}

interface RawPrompt {
  prompt_text: string;
  content_session_id: string;
}

/**
 * Extract file paths and commands from raw pending_messages tool_input JSON.
 * Shared utility — used by both RawContextFallback and CheckpointService.
 */
export function extractFilesFromRawMessages(messages: RawMessage[]): {
  filesModified: string[];
  filesRead: string[];
  commands: string[];
  lastAction: string;
} {
  const modified = new Set<string>();
  const read = new Set<string>();
  const commands: string[] = [];
  let lastAction = '';

  for (const msg of messages) {
    if (!msg.tool_name || !msg.tool_input) continue;

    let input: any;
    try {
      input = typeof msg.tool_input === 'string' ? JSON.parse(msg.tool_input) : msg.tool_input;
    } catch {
      continue;
    }

    const toolName = msg.tool_name;

    switch (toolName) {
      case 'Edit':
      case 'Write':
      case 'NotebookEdit':
        if (input.file_path) {
          modified.add(shortenPath(input.file_path));
          lastAction = `${toolName} ${shortenPath(input.file_path)}`;
        }
        break;

      case 'Read':
        if (input.file_path) {
          read.add(shortenPath(input.file_path));
          lastAction = `Read ${shortenPath(input.file_path)}`;
        }
        break;

      case 'Bash':
        if (input.command) {
          const cmd = input.command.substring(0, 120);
          commands.push(cmd);
          lastAction = `Bash: ${cmd.substring(0, 60)}`;
        }
        break;

      case 'Grep':
        if (input.pattern) {
          lastAction = `Grep: ${input.pattern.substring(0, 40)}`;
        }
        break;

      case 'Glob':
        if (input.pattern) {
          lastAction = `Glob: ${input.pattern.substring(0, 40)}`;
        }
        break;

      case 'Agent':
        lastAction = 'Agent subagent task';
        break;

      default:
        lastAction = toolName;
    }
  }

  return {
    filesModified: Array.from(modified),
    filesRead: Array.from(read).filter(f => !modified.has(f)),
    commands: commands.slice(-10),
    lastAction: lastAction || 'No actions recorded',
  };
}

/**
 * Shorten absolute paths for readability.
 * /Users/admin/Documents/AI/foo/bar.ts → foo/bar.ts (keeps last 2 segments)
 */
function shortenPath(filePath: string): string {
  const parts = filePath.split('/');
  if (parts.length <= 3) return filePath;
  return parts.slice(-3).join('/');
}

export class RawContextFallback {
  constructor(private db: Database) {}

  /**
   * Build fallback context from raw pending_messages + user_prompts
   * for a specific project. Returns null if no data available.
   */
  buildFallbackContext(project: string): FallbackContext | null {
    try {
      // Get recent pending/failed messages for this project
      const messages = this.db.prepare(`
        SELECT pm.tool_name, pm.tool_input, pm.content_session_id
        FROM pending_messages pm
        JOIN sdk_sessions ss ON pm.session_db_id = ss.id
        WHERE ss.project = ?
          AND pm.status IN ('pending', 'failed', 'processing')
          AND pm.message_type = 'observation'
        ORDER BY pm.created_at_epoch DESC
        LIMIT 200
      `).all(project) as RawMessage[];

      // Get recent user prompts for this project
      const prompts = this.db.prepare(`
        SELECT up.prompt_text, up.content_session_id
        FROM user_prompts up
        JOIN sdk_sessions ss ON up.content_session_id = ss.content_session_id
        WHERE ss.project = ?
        ORDER BY up.created_at_epoch DESC
        LIMIT 20
      `).all(project) as RawPrompt[];

      if (messages.length === 0 && prompts.length === 0) {
        return null;
      }

      // Extract files and commands from raw messages
      const extracted = extractFilesFromRawMessages(messages);

      // Extract user requests (deduplicated, cleaned)
      const seen = new Set<string>();
      const userRequests: string[] = [];
      for (const p of prompts) {
        const cleaned = cleanPrompt(p.prompt_text);
        if (cleaned && !seen.has(cleaned.substring(0, 50))) {
          seen.add(cleaned.substring(0, 50));
          userRequests.push(cleaned.substring(0, 100));
        }
        if (userRequests.length >= 8) break;
      }

      // Count unique sessions
      const sessionIds = new Set([
        ...messages.map(m => m.content_session_id),
        ...prompts.map(p => p.content_session_id),
      ]);

      const result: FallbackContext = {
        hasData: true,
        filesModified: extracted.filesModified.slice(0, 20),
        filesRead: extracted.filesRead.slice(0, 15),
        commands: extracted.commands.slice(0, 5),
        lastAction: extracted.lastAction,
        userRequests,
        sessionCount: sessionIds.size,
        messageCount: messages.length,
      };

      logger.debug('RECOVERY', `RawContextFallback built for ${project}`, {
        filesModified: result.filesModified.length,
        filesRead: result.filesRead.length,
        userRequests: result.userRequests.length,
        messageCount: result.messageCount,
      });

      return result;
    } catch (err) {
      logger.debug('RECOVERY', 'RawContextFallback failed (non-blocking)', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }
}

/**
 * Clean user prompt text for display
 */
function cleanPrompt(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  // Strip XML-like tags (hook metadata)
  cleaned = cleaned.replace(/<[^>]+>/g, '').trim();
  // Strip common prefixes
  cleaned = cleaned.replace(/^(can you|could you|please|help me|i want to|i need to|let's|let us)\s+/gi, '');
  cleaned = cleaned.replace(/^[,;:\-–—]+\s*/, '');
  return cleaned.trim();
}
