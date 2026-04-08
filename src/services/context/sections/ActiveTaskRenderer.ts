/**
 * ActiveTaskRenderer - Renders active task state into context injection
 *
 * Outputs a compact recovery block at the top of context (after persona).
 */

import type { ActiveTaskRow } from '../../persona/PersonaTypes.js';
import type { TaskCheckpoint } from '../../persona/PersonaTypes.js';

/**
 * Render checkpoints as a progress checklist
 */
function renderCheckpoints(checkpoints: TaskCheckpoint[]): string[] {
  if (!checkpoints || checkpoints.length === 0) return [];

  const lines: string[] = [];
  const completedCount = checkpoints.filter(c => c.status === 'completed').length;
  const totalCount = checkpoints.length;
  const current = checkpoints.find(c => c.status === 'in_progress');

  // Progress summary line
  const currentLabel = current ? current.name : 'All complete';
  lines.push(`Progress: Step ${current ? completedCount + 1 : completedCount}/${totalCount} — ${currentLabel}`);

  // Checklist
  for (const cp of checkpoints) {
    if (cp.status === 'completed') {
      lines.push(`[x] ${cp.name}`);
    } else if (cp.status === 'in_progress') {
      lines.push(`[>] ${cp.name}  ← current`);
    } else {
      lines.push(`[ ] ${cp.name}`);
    }
  }

  return lines;
}

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
  }

  // Render checkpoints if present in context_json
  let hasCheckpoints = false;
  if (task.context_json) {
    try {
      const context = JSON.parse(task.context_json);
      if (Array.isArray(context.checkpoints) && context.checkpoints.length > 0) {
        hasCheckpoints = true;
        lines.push(...renderCheckpoints(context.checkpoints));
      }
    } catch {
      // ignore parse errors
    }
  }

  // Only show plain progress/next if no checkpoints rendered
  if (!hasCheckpoints && task.status !== 'blocked') {
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
