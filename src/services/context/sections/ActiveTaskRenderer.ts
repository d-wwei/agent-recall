/**
 * ActiveTaskRenderer - Renders active task state into context injection
 *
 * Outputs a compact recovery block at the top of context (after persona).
 */

import type { ActiveTaskRow } from '../../persona/PersonaTypes.js';

/**
 * Render the active task as context
 */
export function renderActiveTask(
  task: ActiveTaskRow | null | undefined,
  useColors: boolean
): string[] {
  if (!task) return [];

  const lines: string[] = [];

  lines.push('<active-task>');

  if (task.status === 'blocked') {
    lines.push(`**Blocked Task**: ${task.task_name}`);
    if (task.progress) lines.push(`Progress: ${task.progress}`);
    if (task.next_step) lines.push(`Blocker: ${task.next_step}`);
  } else {
    lines.push(`**Active Task**: ${task.task_name}`);
    if (task.progress) lines.push(`Progress: ${task.progress}`);
    if (task.next_step) lines.push(`Next: ${task.next_step}`);
  }

  // Show interrupted tasks if any
  if (task.interrupted_tasks_json) {
    try {
      const interrupted = JSON.parse(task.interrupted_tasks_json);
      if (Array.isArray(interrupted) && interrupted.length > 0) {
        lines.push('');
        lines.push('Interrupted tasks:');
        for (const t of interrupted) {
          lines.push(`- ${t.task_name || t.name} (paused at: ${t.progress || 'unknown'})`);
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  lines.push('</active-task>');
  lines.push('');

  return lines;
}
