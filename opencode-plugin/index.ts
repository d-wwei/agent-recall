/**
 * Agent Recall plugin for OpenCode
 *
 * Integrates Agent Recall's persistent memory with OpenCode's TypeScript plugin system.
 * Captures tool executions and injects context via system prompt transformation.
 */

const WORKER_URL = 'http://127.0.0.1:37777';

async function workerPost(path: string, body: any): Promise<any> {
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // Worker not running — degrade gracefully
  }
}

async function workerGet(path: string): Promise<any> {
  try {
    const res = await fetch(`${WORKER_URL}${path}`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export default function agentRecallPlugin() {
  let sessionId = `opencode-${Date.now()}`;
  let project = '';

  return async (input: any) => {
    project = input.directory || input.project || '';

    return {
      // Capture tool executions
      "tool.execute.after": async (data: any) => {
        await workerPost('/api/sessions/observations', {
          contentSessionId: sessionId,
          tool_name: data.tool?.name || 'unknown',
          tool_input: data.args || data.input,
          tool_response: typeof data.output === 'string' ? data.output : JSON.stringify(data.output),
          cwd: project,
        });
      },

      // Inject context into system prompt
      "experimental.chat.system.transform": async (system: string) => {
        try {
          const context = await workerGet(`/api/context/inject?projects=${encodeURIComponent(project)}`);
          if (context?.text) {
            return `${system}\n\n<agent-recall-context>\n${context.text}\n</agent-recall-context>`;
          }
        } catch {
          // Silently degrade if worker is unavailable
        }
        return system;
      },

      // Generic event handler for session lifecycle
      event: async (event: any) => {
        if (event.type === 'session.created') {
          sessionId = event.sessionId || `opencode-${Date.now()}`;
          await workerPost('/api/sessions/init', {
            contentSessionId: sessionId,
            project,
            prompt: '',
          });
        }
      },
    };
  };
}
