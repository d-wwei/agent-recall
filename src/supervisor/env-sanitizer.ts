export const ENV_PREFIXES = ['CLAUDECODE_', 'CLAUDE_CODE_'];
export const ENV_EXACT_MATCHES = new Set([
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION',
  'MCP_SESSION_ID',
]);

// Variables with CLAUDE_CODE_ prefix that MUST be preserved for auth and SDK operation.
// sanitizeEnv strips all CLAUDE_CODE_* by default to prevent "nested session" errors,
// but these specific vars are required for the Agent SDK subprocess to authenticate.
const ALLOWED_CLAUDE_CODE_VARS = new Set([
  'CLAUDE_CODE_OAUTH_TOKEN',    // CLI subscription billing auth
  'CLAUDE_CODE_ENTRYPOINT',     // Set to 'sdk-ts' by buildIsolatedEnv
]);

export function sanitizeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const sanitized: NodeJS.ProcessEnv = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (ENV_EXACT_MATCHES.has(key)) continue;
    if (ENV_PREFIXES.some(prefix => key.startsWith(prefix)) && !ALLOWED_CLAUDE_CODE_VARS.has(key)) continue;
    sanitized[key] = value;
  }

  return sanitized;
}
