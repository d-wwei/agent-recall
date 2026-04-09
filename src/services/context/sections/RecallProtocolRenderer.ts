/**
 * RecallProtocolRenderer - Renders behavioral memory directives into context
 *
 * Outputs 3 L0 directives instructing the AI to verify facts against memory,
 * flag contradictions, and record user preferences. Injected every session.
 */

/**
 * Render the RECALL_PROTOCOL behavioral directives as markdown lines.
 * Kept under 300 tokens (~240 target).
 */
export function renderRecallProtocol(useColors: boolean): string[] {
  const heading = '## Memory Protocol';

  const lines: string[] = [
    useColors ? `\x1b[1;36m${heading}\x1b[0m` : heading,
    '1. Before answering about past facts, search memory to verify — do not guess',
    '2. When you discover information contradicting stored memory, flag it and request an update',
    '3. User preferences, decisions, and corrections are worth recording',
    '',
  ];

  return lines;
}
