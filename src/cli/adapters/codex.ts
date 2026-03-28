import type { PlatformAdapter, NormalizedHookInput, HookResult } from '../types.js';

/**
 * Codex CLI Platform Adapter
 *
 * Codex CLI uses a hook system nearly identical to Claude Code:
 * - Same lifecycle events (SessionStart, PostToolUse, Stop, etc.)
 * - Same JSON stdin/stdout format
 * - Same exit code semantics (0=success, 2=blocking)
 * - hooks.json at ~/.codex/hooks.json
 *
 * Key differences:
 * - hook_event_name field included in input
 * - model field included in input
 * - Context injected via AGENTS.md, not hookSpecificOutput
 */
export const codexAdapter: PlatformAdapter = {
  normalizeInput(raw) {
    const r = (raw ?? {}) as any;
    return {
      sessionId: r.session_id ?? r.id ?? r.sessionId,
      cwd: r.cwd ?? process.cwd(),
      platform: 'codex',
      prompt: r.prompt ?? r.user_prompt,
      toolName: r.tool_name,
      toolInput: r.tool_input,
      toolResponse: r.tool_response,
      transcriptPath: r.transcript_path,
    };
  },

  formatOutput(result) {
    const r = result ?? ({} as HookResult);

    // Codex expects same output format as Claude Code
    const output: Record<string, unknown> = {};

    if (r.hookSpecificOutput) {
      output.hookSpecificOutput = r.hookSpecificOutput;
    }
    if (r.systemMessage) {
      output.systemMessage = r.systemMessage;
    }
    if (r.suppressOutput !== undefined) {
      output.suppressOutput = r.suppressOutput;
    }
    return output;
  }
};
