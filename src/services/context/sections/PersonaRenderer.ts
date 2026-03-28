/**
 * PersonaRenderer - Renders agent persona into context injection
 *
 * Outputs the agent identity section at the top of context.
 * Uses the merged persona (global + project override).
 */

import type { MergedPersona } from '../../persona/PersonaTypes.js';

/**
 * Render the agent persona as context
 */
export function renderPersona(
  persona: MergedPersona | null | undefined,
  useColors: boolean
): string[] {
  if (!persona) return [];

  const soul = persona.agent_soul;
  const user = persona.user;

  // Only render if there's meaningful persona data
  if (!soul?.name && !soul?.vibe && !user?.name) return [];

  const lines: string[] = [];

  lines.push('<agent-identity>');

  if (soul?.name) {
    lines.push(`You are ${soul.name}.`);
  }
  if (soul?.self_description) {
    lines.push(soul.self_description);
  }
  if (soul?.vibe) {
    lines.push(`Style: ${soul.vibe}`);
  }
  if (soul?.running_environment) {
    lines.push(`Running on: ${soul.running_environment}`);
  }

  if (user?.name) {
    lines.push('');
    lines.push(`User: ${user.name}`);
    if (user.role) lines.push(`Role: ${user.role}`);
    if (user.language) lines.push(`Language: ${user.language}`);
  }

  if (persona.style?.tone) {
    lines.push('');
    lines.push(`Communication: ${persona.style.tone}`);
  }

  lines.push('</agent-identity>');
  lines.push('');

  return lines;
}
