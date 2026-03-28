import type { PlatformAdapter, NormalizedHookInput, HookResult } from '../types.js';

/**
 * OpenCode Platform Adapter
 *
 * OpenCode (by SST) uses a TypeScript plugin system with hooks like:
 * - tool.execute.before / tool.execute.after
 * - experimental.chat.system.transform (context injection)
 * - event (generic events)
 *
 * This adapter normalizes OpenCode's event format for the shell-based hook path.
 * The primary integration is via the TS plugin in opencode-plugin/.
 */
export const opencodeAdapter: PlatformAdapter = {
  normalizeInput(raw) {
    const r = (raw ?? {}) as any;
    return {
      sessionId: r.session_id ?? r.sessionId ?? r.id,
      cwd: r.cwd ?? r.directory ?? r.project ?? process.cwd(),
      platform: 'opencode',
      prompt: r.prompt ?? r.message,
      toolName: r.tool_name ?? r.toolName ?? r.name,
      toolInput: r.tool_input ?? r.toolInput ?? r.args ?? r.input,
      toolResponse: r.tool_response ?? r.toolResponse ?? r.output ?? r.result,
    };
  },

  formatOutput(result) {
    return { continue: result.continue ?? true };
  }
};
