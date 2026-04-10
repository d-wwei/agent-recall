/**
 * StructuredSummaryBuilder - Produces actionable, structured session summaries
 *
 * Upgrades raw session summaries into categorized, machine-readable data
 * with completed tasks, in-progress work, decisions, blockers, and resume context.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface StructuredSummary {
  tasksCompleted: string[];      // things that got done
  tasksInProgress: string[];     // started but not finished (with file:line hints)
  decisionsMade: string[];       // choices/decisions recorded
  blockers: string[];            // things that blocked progress
  keyDiscoveries: string[];      // important things learned
  resumeContext: string;         // one paragraph: what to do next time, where to look
  sessionDuration: string;       // "45 minutes" or "2 hours"
  observationCount: number;
}

export class StructuredSummaryBuilder {
  constructor(private db: Database) {}

  /**
   * Build a structured summary from session observations and raw summary data
   */
  buildFromSession(
    project: string,
    sessionId: string,
    observations: any[],
    rawSummary: any | null,
    sessionStartEpoch: number
  ): StructuredSummary {
    const tasksCompleted = this.extractCompleted(observations, rawSummary);
    const tasksInProgress = this.extractInProgress(observations);
    const decisionsMade = this.extractDecisions(observations);
    const blockers = this.extractBlockers(observations);
    const keyDiscoveries = this.extractDiscoveries(observations);
    const resumeContext = this.buildResumeContext(rawSummary, tasksInProgress, tasksCompleted);
    const sessionDuration = this.calculateDuration(sessionStartEpoch);

    return {
      tasksCompleted,
      tasksInProgress,
      decisionsMade,
      blockers,
      keyDiscoveries,
      resumeContext,
      sessionDuration,
      observationCount: observations.length,
    };
  }

  /**
   * Format structured summary as readable markdown
   */
  formatAsMarkdown(summary: StructuredSummary): string {
    const sections: string[] = ['## Session Summary', ''];

    if (summary.tasksCompleted.length > 0) {
      sections.push('### Completed');
      for (const task of summary.tasksCompleted) {
        sections.push(`- ${task}`);
      }
      sections.push('');
    }

    if (summary.tasksInProgress.length > 0) {
      sections.push('### In Progress');
      for (const task of summary.tasksInProgress) {
        sections.push(`- ${task}`);
      }
      sections.push('');
    }

    if (summary.decisionsMade.length > 0) {
      sections.push('### Decisions');
      for (const decision of summary.decisionsMade) {
        sections.push(`- ${decision}`);
      }
      sections.push('');
    }

    if (summary.blockers.length > 0) {
      sections.push('### Blockers');
      for (const blocker of summary.blockers) {
        sections.push(`- ${blocker}`);
      }
      sections.push('');
    }

    if (summary.keyDiscoveries.length > 0) {
      sections.push('### Key Discoveries');
      for (const discovery of summary.keyDiscoveries) {
        sections.push(`- ${discovery}`);
      }
      sections.push('');
    }

    if (summary.resumeContext) {
      sections.push('### Resume Context');
      sections.push(summary.resumeContext);
      sections.push('');
    }

    sections.push(`Duration: ${summary.sessionDuration} | ${summary.observationCount} observations`);

    return sections.join('\n');
  }

  /**
   * Store structured summary in session_summaries.structured_summary
   */
  storeStructuredSummary(project: string, sessionId: string, summary: StructuredSummary): void {
    const json = JSON.stringify(summary);

    try {
      // Try to update the most recent summary for this session
      const result = this.db.prepare(
        'UPDATE session_summaries SET structured_summary = ? WHERE memory_session_id = ? AND project = ?'
      ).run(json, sessionId, project);

      if (result.changes === 0) {
        // No summary row exists yet — store in notes as fallback
        logger.debug('STRUCTURED_SUMMARY', `No summary row found for session ${sessionId}, storing skipped`);
      } else {
        logger.debug('STRUCTURED_SUMMARY', `Stored structured summary for session ${sessionId}`);
      }
    } catch (err) {
      // structured_summary column may not exist yet (migration 44 not applied)
      logger.debug('STRUCTURED_SUMMARY', 'Failed to store structured summary (column may not exist)', {
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  // ==========================================
  // Extraction helpers
  // ==========================================

  private extractCompleted(observations: any[], rawSummary: any | null): string[] {
    const completed: string[] = [];

    // From observations with completion-sounding patterns
    const completedPatterns = /\b(completed|fixed|implemented|added|created|resolved|merged|deployed|built|finished|wrote|refactored)\b/i;

    for (const obs of observations) {
      const type = (obs.type || '').toLowerCase();
      const title = obs.title || '';
      const narrative = obs.narrative || '';

      if (type === 'feature' || type === 'bugfix') {
        completed.push(title || narrative.substring(0, 80));
      } else if (completedPatterns.test(title) || completedPatterns.test(narrative)) {
        completed.push(title || narrative.substring(0, 80));
      }
    }

    // Also pull from raw summary's completed field
    if (rawSummary?.completed) {
      const items = rawSummary.completed.split(/[;,\n]/).map((s: string) => s.trim()).filter(Boolean);
      for (const item of items) {
        if (!completed.some(c => c.toLowerCase().includes(item.toLowerCase().substring(0, 20)))) {
          completed.push(item);
        }
      }
    }

    return deduplicate(completed);
  }

  private extractInProgress(observations: any[]): string[] {
    const inProgress: string[] = [];
    const wipPatterns = /\b(WIP|TODO|partial|started|in progress|not yet|unfinished|working on|began|incomplete)\b/i;

    for (const obs of observations) {
      const narrative = obs.narrative || '';
      const title = obs.title || '';

      if (wipPatterns.test(narrative) || wipPatterns.test(title)) {
        // Try to add file hint
        let hint = title || narrative.substring(0, 80);
        if (obs.files_modified) {
          const files = parseFiles(obs.files_modified);
          if (files.length > 0) {
            hint += ` (${files[0]})`;
          }
        }
        inProgress.push(hint);
      }
    }

    return deduplicate(inProgress);
  }

  private extractDecisions(observations: any[]): string[] {
    const decisions: string[] = [];
    const decisionPatterns = /\b(decided|decision|chose|chosen|switched to|changed to|opted for|will use|going with)\b/i;

    for (const obs of observations) {
      const type = (obs.type || '').toLowerCase();
      const narrative = obs.narrative || '';
      const title = obs.title || '';

      if (type === 'decision') {
        decisions.push(title || narrative.substring(0, 80));
      } else if (decisionPatterns.test(narrative) || decisionPatterns.test(title)) {
        decisions.push(title || narrative.substring(0, 80));
      }
    }

    return deduplicate(decisions);
  }

  private extractBlockers(observations: any[]): string[] {
    const blockers: string[] = [];
    const blockerPatterns = /\b(blocked|fail(?:ed|ing|ure)?|error|can't|cannot|unable to|broken|crash|exception|timeout)\b/i;

    for (const obs of observations) {
      const narrative = obs.narrative || '';
      const title = obs.title || '';

      if (blockerPatterns.test(narrative) || blockerPatterns.test(title)) {
        blockers.push(title || narrative.substring(0, 80));
      }
    }

    return deduplicate(blockers);
  }

  private extractDiscoveries(observations: any[]): string[] {
    const discoveries: string[] = [];

    for (const obs of observations) {
      const type = (obs.type || '').toLowerCase();
      const confidence = (obs.confidence || '').toLowerCase();
      const title = obs.title || '';
      const narrative = obs.narrative || '';

      if (type === 'discovery' && confidence === 'high') {
        discoveries.push(title || narrative.substring(0, 80));
      }
    }

    return deduplicate(discoveries);
  }

  private buildResumeContext(
    rawSummary: any | null,
    tasksInProgress: string[],
    tasksCompleted: string[]
  ): string {
    const parts: string[] = [];

    // Start with completed summary
    if (tasksCompleted.length > 0) {
      parts.push(`Completed: ${tasksCompleted.join('; ')}.`);
    }

    // Add in-progress items
    if (tasksInProgress.length > 0) {
      parts.push(`Still in progress: ${tasksInProgress.join('; ')}.`);
    }

    // Add next_steps from raw summary
    if (rawSummary?.next_steps) {
      parts.push(`Next steps: ${rawSummary.next_steps.trim()}`);
    }

    if (parts.length === 0) {
      return 'No specific resume context available.';
    }

    return parts.join(' ');
  }

  private calculateDuration(sessionStartEpoch: number): string {
    const now = Date.now();
    const diffMs = now - sessionStartEpoch;

    if (diffMs < 0 || sessionStartEpoch === 0) return 'unknown';

    const minutes = Math.round(diffMs / 60000);

    if (minutes < 1) return 'less than a minute';
    if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''}`;

    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (remainingMinutes === 0) return `${hours} hour${hours !== 1 ? 's' : ''}`;
    return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}`;
  }
}

/**
 * Parse files from JSON array string or comma-separated string
 */
function parseFiles(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON
  }
  return raw.split(',').map(f => f.trim()).filter(Boolean);
}

/**
 * Remove near-duplicate entries from an array
 */
function deduplicate(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const normalized = item.toLowerCase().trim();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
