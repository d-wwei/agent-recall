/**
 * Claude Code Transcript Processor
 *
 * Parses Claude Code JSONL files directly, bypassing the generic schema system.
 * Claude Code JSONL has nested/compound entries (tool_use inside assistant message
 * content arrays) that the flat schema model can't express cleanly.
 *
 * This processor acts as a FALLBACK for when hooks don't fire (e.g., ft-claude,
 * old Claude Code versions). It produces the same database records as the hook
 * pipeline, with deduplication to avoid double-writes when both paths work.
 */

import { sessionInitHandler } from '../../cli/handlers/session-init.js';
import { observationHandler } from '../../cli/handlers/observation.js';
import { sessionCompleteHandler } from '../../cli/handlers/session-complete.js';
import { ensureWorkerRunning, workerHttpRequest } from '../../shared/worker-utils.js';
import { logger } from '../../utils/logger.js';

const PLATFORM = 'transcript-claude-code';

/** Tracks in-flight state for a single Claude Code session */
interface SessionState {
  sessionId: string;
  cwd?: string;
  project?: string;
  version?: string;
  promptCount: number;
  lastAssistantMessage?: string;
  /** tool_use id → {name, input} awaiting tool_result */
  pendingTools: Map<string, { name: string; input: unknown }>;
  /** Set of promptIds already processed (dedup within a single watcher pass) */
  seenPromptIds: Set<string>;
  /** If true, hooks already captured this session — skip all writes */
  hookCaptured: boolean;
}

/** Optional injected dedup check — set by WorkerService which has DB access */
let dedupChecker: ((contentSessionId: string) => boolean) | null = null;

/**
 * Inject a synchronous function that checks if a session already has prompts in DB.
 * Called by WorkerService after DB is initialized.
 */
export function setDedupChecker(fn: (contentSessionId: string) => boolean): void {
  dedupChecker = fn;
}

/**
 * Check if a session was already captured by hooks.
 * Uses the injected dedup checker if available, falls back to false (process everything).
 */
function isSessionCapturedByHooks(contentSessionId: string): boolean {
  if (!dedupChecker) return false;
  return dedupChecker(contentSessionId);
}

export class ClaudeCodeTranscriptProcessor {
  private sessions = new Map<string, SessionState>();

  /**
   * Process a single JSONL line from a Claude Code session file.
   * @param line Raw JSON string
   * @param sessionIdFromFilename Fallback sessionId extracted from filename
   */
  async processLine(line: string, sessionIdFromFilename?: string): Promise<void> {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      return; // Malformed line, skip
    }

    const type = entry.type as string | undefined;
    if (!type) return;

    switch (type) {
      case 'user':
        await this.handleUser(entry, sessionIdFromFilename);
        break;
      case 'assistant':
        await this.handleAssistant(entry);
        break;
      // Skip: progress, file-history-snapshot, system, queue-operation, last-prompt
      default:
        break;
    }
  }

  /**
   * Signal that a JSONL file has been fully read (e.g., file closed or no more data).
   * Triggers summary + session-complete for any active sessions.
   */
  async finalizeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.hookCaptured) return;

    if (session.lastAssistantMessage) {
      await this.queueSummary(session);
    }
    await sessionCompleteHandler.execute({
      sessionId: session.sessionId,
      cwd: session.cwd ?? process.cwd(),
      platform: PLATFORM
    });
    this.sessions.delete(sessionId);
  }

  // ── User messages ──────────────────────────────────────────────

  private async handleUser(entry: Record<string, unknown>, sessionIdFromFilename?: string): Promise<void> {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) return;

    const content = message.content;
    const sessionId = (entry.sessionId as string) || sessionIdFromFilename;
    if (!sessionId) return;

    const session = this.getOrCreateSession(sessionId, entry);
    if (session.hookCaptured) return;

    if (typeof content === 'string') {
      // Plain user text message → session_init
      await this.handleUserTextMessage(session, entry, content);
    } else if (Array.isArray(content)) {
      // Could be tool_result or mixed content
      for (const item of content) {
        if (typeof item !== 'object' || item === null) continue;
        const itemType = (item as Record<string, unknown>).type as string;

        if (itemType === 'tool_result') {
          await this.handleToolResult(session, item as Record<string, unknown>);
        } else if (itemType === 'text') {
          // Text content in array form — treat as user message if it's the first
          const text = (item as Record<string, unknown>).text as string;
          if (text && session.promptCount === 0) {
            await this.handleUserTextMessage(session, entry, text);
          }
        }
      }
    }
  }

  private async handleUserTextMessage(
    session: SessionState,
    entry: Record<string, unknown>,
    prompt: string
  ): Promise<void> {
    const promptId = entry.promptId as string | undefined;

    // Dedup: skip if we already processed this promptId in this watcher pass
    if (promptId && session.seenPromptIds.has(promptId)) return;
    if (promptId) session.seenPromptIds.add(promptId);

    session.promptCount++;

    // Update session metadata from entry
    if (entry.cwd && typeof entry.cwd === 'string') session.cwd = entry.cwd;

    await sessionInitHandler.execute({
      sessionId: session.sessionId,
      cwd: session.cwd ?? process.cwd(),
      prompt,
      platform: PLATFORM
    });
  }

  // ── Assistant messages ─────────────────────────────────────────

  private async handleAssistant(entry: Record<string, unknown>): Promise<void> {
    const message = entry.message as Record<string, unknown> | undefined;
    if (!message) return;

    const content = message.content;
    if (!Array.isArray(content)) return;

    // We need to find which session this belongs to — assistant entries
    // don't always have sessionId, but they follow a user entry that did.
    // Use parentUuid or the most recently active session.
    const sessionId = this.resolveSessionIdForAssistant(entry);
    if (!sessionId) return;

    const session = this.sessions.get(sessionId);
    if (!session || session.hookCaptured) return;

    for (const item of content) {
      if (typeof item !== 'object' || item === null) continue;
      const itemType = (item as Record<string, unknown>).type as string;

      if (itemType === 'tool_use') {
        this.handleToolUse(session, item as Record<string, unknown>);
      } else if (itemType === 'text') {
        const text = (item as Record<string, unknown>).text as string;
        if (text) session.lastAssistantMessage = text;
      }
      // 'thinking' type — skip (internal reasoning)
    }
  }

  private handleToolUse(session: SessionState, item: Record<string, unknown>): void {
    const toolId = item.id as string | undefined;
    const toolName = item.name as string | undefined;
    const toolInput = item.input;

    if (toolId && toolName) {
      session.pendingTools.set(toolId, { name: toolName, input: toolInput });
    }
  }

  // ── Tool results ───────────────────────────────────────────────

  private async handleToolResult(session: SessionState, item: Record<string, unknown>): Promise<void> {
    const toolUseId = item.tool_use_id as string | undefined;
    if (!toolUseId) return;

    const pending = session.pendingTools.get(toolUseId);
    if (!pending) return; // No matching tool_use — skip

    session.pendingTools.delete(toolUseId);

    // Extract response content
    let toolResponse: unknown = item.content;
    if (Array.isArray(toolResponse)) {
      // Content is array of {type: "text", text: "..."} — flatten
      toolResponse = (toolResponse as Array<Record<string, unknown>>)
        .filter(c => c.type === 'text')
        .map(c => c.text)
        .join('\n');
    }

    // Truncate large responses to avoid overwhelming the DB
    if (typeof toolResponse === 'string' && toolResponse.length > 10000) {
      toolResponse = toolResponse.slice(0, 10000) + '\n... [truncated by transcript watcher]';
    }

    await observationHandler.execute({
      sessionId: session.sessionId,
      cwd: session.cwd ?? process.cwd(),
      toolName: pending.name,
      toolInput: pending.input,
      toolResponse,
      platform: PLATFORM
    });
  }

  // ── Session management ─────────────────────────────────────────

  private getOrCreateSession(
    sessionId: string,
    entry: Record<string, unknown>
  ): SessionState {
    let session = this.sessions.get(sessionId);
    if (session) return session;

    // First time seeing this session — check if hooks already captured it
    const hookCaptured = isSessionCapturedByHooks(sessionId);
    if (hookCaptured) {
      logger.info('TRANSCRIPT', `Session ${sessionId.slice(0, 8)} already captured by hooks, skipping`, {
        correlationId: sessionId
      });
    }

    session = {
      sessionId,
      cwd: (entry.cwd as string) || undefined,
      project: undefined,
      version: (entry.version as string) || undefined,
      promptCount: 0,
      pendingTools: new Map(),
      seenPromptIds: new Set(),
      hookCaptured
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private resolveSessionIdForAssistant(_entry: Record<string, unknown>): string | null {
    // Assistant entries in Claude Code JSONL don't always have sessionId.
    // They are sequentially after their corresponding user entry.
    // Use the most recently created session as a heuristic.
    if (this.sessions.size === 0) return null;

    // If there's only one session being tracked, use it
    if (this.sessions.size === 1) {
      return this.sessions.keys().next().value ?? null;
    }

    // Multiple sessions (shouldn't happen for single-file processing)
    // Return the last one added
    const keys = Array.from(this.sessions.keys());
    return keys[keys.length - 1] ?? null;
  }

  // ── Summary ────────────────────────────────────────────────────

  private async queueSummary(session: SessionState): Promise<void> {
    const workerReady = await ensureWorkerRunning();
    if (!workerReady) return;

    try {
      await workerHttpRequest('/api/sessions/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentSessionId: session.sessionId,
          last_assistant_message: session.lastAssistantMessage ?? ''
        })
      });
    } catch (err) {
      logger.warn('TRANSCRIPT', 'Failed to queue summary', {
        correlationId: session.sessionId,
        error: String(err)
      } as any);
    }
  }
}
