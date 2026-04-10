/**
 * NarrativeRecallEngine - Turns search results into coherent narratives
 *
 * Instead of returning raw lists of observations, this engine groups and
 * narrates results into flowing text that tells the user what happened,
 * what decisions were made, and what's still pending.
 *
 * Template-based (no API calls required) — narratives are built from patterns.
 */

import { Database } from 'bun:sqlite';
import { logger } from '../../utils/logger.js';

export interface RecallRequest {
  query: string;                 // "what did I do yesterday" or "status of auth module"
  project: string;
  timeRange?: { start: string; end: string };
}

export interface NarrativeRecall {
  narrative: string;             // coherent paragraph(s) answering the query
  sections: RecallSection[];     // structured breakdown
  sourceCount: number;           // how many observations contributed
  confidence: 'high' | 'medium' | 'low';
}

export interface RecallSection {
  heading: string;               // "Authentication Module" or "Yesterday's Work"
  items: string[];               // bullet points
  type: 'completed' | 'in_progress' | 'decision' | 'discovery' | 'timeline';
}

export class NarrativeRecallEngine {
  constructor(private db: Database) {}

  /**
   * General recall: answer a query about past work
   */
  recall(request: RecallRequest): NarrativeRecall {
    const data = this.queryRelevantData(request);

    if (data.observations.length === 0 && data.compiledKnowledge.length === 0 && data.summaries.length === 0) {
      return {
        narrative: 'No relevant memories found for this query.',
        sections: [],
        sourceCount: 0,
        confidence: 'low',
      };
    }

    const sections = this.buildSections(data.observations, data.compiledKnowledge);
    const narrative = this.buildNarrative(sections);
    const confidence = this.assessConfidence(data);

    return {
      narrative,
      sections,
      sourceCount: data.observations.length + data.compiledKnowledge.length + data.summaries.length,
      confidence,
    };
  }

  /**
   * Timeline recall: "what happened in the last N days"
   */
  recallTimeline(project: string, days: number): NarrativeRecall {
    const sinceEpoch = Date.now() - (days * 24 * 60 * 60 * 1000);
    const sinceDate = new Date(sinceEpoch).toISOString();

    // Get observations grouped by day
    const observations = this.db.prepare(
      'SELECT * FROM observations WHERE project = ? AND created_at_epoch > ? ORDER BY created_at_epoch ASC'
    ).all(project, sinceEpoch) as any[];

    // Get session summaries for the period
    const summaries = this.db.prepare(
      'SELECT * FROM session_summaries WHERE project = ? AND created_at_epoch > ? ORDER BY created_at_epoch DESC'
    ).all(project, sinceEpoch) as any[];

    // Get structured summaries if available
    const structuredSummaries = summaries
      .filter((s: any) => s.structured_summary)
      .map((s: any) => {
        try { return JSON.parse(s.structured_summary); } catch { return null; }
      })
      .filter(Boolean);

    if (observations.length === 0 && summaries.length === 0) {
      return {
        narrative: `No activity found in the last ${days} day${days !== 1 ? 's' : ''}.`,
        sections: [],
        sourceCount: 0,
        confidence: 'low',
      };
    }

    // Group observations by day
    const byDay = new Map<string, any[]>();
    for (const obs of observations) {
      const date = new Date(obs.created_at_epoch).toISOString().split('T')[0];
      if (!byDay.has(date)) byDay.set(date, []);
      byDay.get(date)!.push(obs);
    }

    // Build sections per day
    const sections: RecallSection[] = [];
    for (const [date, dayObs] of byDay) {
      const items = dayObs.map((obs: any) => obs.title || obs.narrative?.substring(0, 80) || 'Unknown action').filter(Boolean);
      sections.push({
        heading: formatDateHeading(date),
        items,
        type: 'timeline',
      });
    }

    // Add structured summary highlights if available
    for (const structured of structuredSummaries) {
      if (structured.tasksCompleted?.length > 0) {
        sections.push({
          heading: 'Completed',
          items: structured.tasksCompleted,
          type: 'completed',
        });
      }
    }

    const narrative = this.buildTimelineNarrative(sections, days);
    const confidence: 'high' | 'medium' | 'low' = observations.length > 5 ? 'high' : observations.length > 0 ? 'medium' : 'low';

    return {
      narrative,
      sections,
      sourceCount: observations.length + summaries.length,
      confidence,
    };
  }

  /**
   * Status recall: "what's the status of X"
   */
  recallStatus(project: string, topic: string): NarrativeRecall {
    const normalizedTopic = topic.trim();

    if (!normalizedTopic) {
      return {
        narrative: 'No topic specified for status query.',
        sections: [],
        sourceCount: 0,
        confidence: 'low',
      };
    }

    // Prefer compiled knowledge
    let compiledKnowledge: any[] = [];
    try {
      compiledKnowledge = this.db.prepare(
        "SELECT * FROM compiled_knowledge WHERE project = ? AND valid_until IS NULL AND topic LIKE ? ORDER BY compiled_at DESC LIMIT 5"
      ).all(project, `%${normalizedTopic}%`) as any[];
    } catch {
      // compiled_knowledge table may not exist
    }

    // Fall back to recent observations matching the topic
    const observations = this.db.prepare(
      "SELECT * FROM observations WHERE project = ? AND (title LIKE ? OR narrative LIKE ? OR concepts LIKE ?) ORDER BY created_at_epoch DESC LIMIT 20"
    ).all(project, `%${normalizedTopic}%`, `%${normalizedTopic}%`, `%${normalizedTopic}%`) as any[];

    // Get checkpoints from active_tasks
    let checkpoints: any[] = [];
    try {
      checkpoints = this.db.prepare(
        "SELECT * FROM active_tasks WHERE project = ? AND (task_name LIKE ? OR context_json LIKE ?) AND status IN ('in_progress', 'blocked') ORDER BY updated_at_epoch DESC LIMIT 3"
      ).all(project, `%${normalizedTopic}%`, `%${normalizedTopic}%`) as any[];
    } catch {
      // active_tasks table may not exist
    }

    const totalSources = compiledKnowledge.length + observations.length + checkpoints.length;

    if (totalSources === 0) {
      return {
        narrative: `No information found about "${normalizedTopic}" in project ${project}.`,
        sections: [],
        sourceCount: 0,
        confidence: 'low',
      };
    }

    const sections: RecallSection[] = [];

    // Current state from compiled knowledge
    if (compiledKnowledge.length > 0) {
      sections.push({
        heading: `${normalizedTopic} — Compiled Knowledge`,
        items: compiledKnowledge.map((ck: any) => ck.content.substring(0, 200)),
        type: 'discovery',
      });
    }

    // Recent activity from observations
    const completedObs = observations.filter((o: any) => {
      const text = ((o.title || '') + ' ' + (o.narrative || '')).toLowerCase();
      return /\b(completed|fixed|implemented|added|resolved)\b/.test(text);
    });
    const wipObs = observations.filter((o: any) => {
      const text = ((o.title || '') + ' ' + (o.narrative || '')).toLowerCase();
      return /\b(WIP|TODO|started|in progress|partial)\b/i.test(text);
    });
    const decisionObs = observations.filter((o: any) =>
      (o.type || '').toLowerCase() === 'decision'
    );

    if (completedObs.length > 0) {
      sections.push({
        heading: 'Completed',
        items: completedObs.map((o: any) => o.title || o.narrative?.substring(0, 80)),
        type: 'completed',
      });
    }
    if (wipObs.length > 0) {
      sections.push({
        heading: 'In Progress',
        items: wipObs.map((o: any) => o.title || o.narrative?.substring(0, 80)),
        type: 'in_progress',
      });
    }
    if (decisionObs.length > 0) {
      sections.push({
        heading: 'Decisions',
        items: decisionObs.map((o: any) => o.title || o.narrative?.substring(0, 80)),
        type: 'decision',
      });
    }

    const narrative = this.buildStatusNarrative(normalizedTopic, sections, compiledKnowledge.length > 0);
    const confidence: 'high' | 'medium' | 'low' = compiledKnowledge.length > 0 ? 'high' : observations.length > 3 ? 'medium' : 'low';

    return {
      narrative,
      sections,
      sourceCount: totalSources,
      confidence,
    };
  }

  // ==========================================
  // Narrative builders
  // ==========================================

  private buildNarrative(sections: RecallSection[]): string {
    const parts: string[] = [];

    const completed = sections.filter(s => s.type === 'completed');
    const inProgress = sections.filter(s => s.type === 'in_progress');
    const decisions = sections.filter(s => s.type === 'decision');
    const discoveries = sections.filter(s => s.type === 'discovery');

    if (completed.length > 0) {
      const items = completed.flatMap(s => s.items);
      parts.push(`Completed ${items.length} item${items.length > 1 ? 's' : ''}: ${items.join('; ')}.`);
    }

    if (inProgress.length > 0) {
      const items = inProgress.flatMap(s => s.items);
      parts.push(`Still in progress: ${items.join('; ')}.`);
    }

    if (decisions.length > 0) {
      const items = decisions.flatMap(s => s.items);
      parts.push(`Decision${items.length > 1 ? 's' : ''} made: ${items.join('; ')}.`);
    }

    if (discoveries.length > 0) {
      const items = discoveries.flatMap(s => s.items);
      parts.push(`Key finding${items.length > 1 ? 's' : ''}: ${items.join('; ')}.`);
    }

    return parts.join(' ') || 'No relevant information found.';
  }

  private buildTimelineNarrative(sections: RecallSection[], days: number): string {
    const timelineSections = sections.filter(s => s.type === 'timeline');
    const completedSections = sections.filter(s => s.type === 'completed');

    const parts: string[] = [];

    if (timelineSections.length > 0) {
      const totalItems = timelineSections.reduce((sum, s) => sum + s.items.length, 0);
      parts.push(`In the last ${days} day${days !== 1 ? 's' : ''}, ${totalItems} action${totalItems !== 1 ? 's' : ''} were recorded across ${timelineSections.length} day${timelineSections.length !== 1 ? 's' : ''}.`);

      for (const section of timelineSections) {
        parts.push(`${section.heading}: ${section.items.slice(0, 3).join('; ')}${section.items.length > 3 ? ` (+${section.items.length - 3} more)` : ''}.`);
      }
    }

    if (completedSections.length > 0) {
      const items = completedSections.flatMap(s => s.items);
      parts.push(`Notable completions: ${items.join('; ')}.`);
    }

    return parts.join(' ') || `No activity found in the last ${days} days.`;
  }

  private buildStatusNarrative(topic: string, sections: RecallSection[], hasCompiledKnowledge: boolean): string {
    const parts: string[] = [];

    if (hasCompiledKnowledge) {
      const knowledgeSections = sections.filter(s => s.type === 'discovery');
      if (knowledgeSections.length > 0) {
        parts.push(`Current knowledge about "${topic}": ${knowledgeSections.flatMap(s => s.items).join('; ')}.`);
      }
    }

    const completed = sections.filter(s => s.type === 'completed');
    const inProgress = sections.filter(s => s.type === 'in_progress');
    const decisions = sections.filter(s => s.type === 'decision');

    if (completed.length > 0) {
      parts.push(`Completed: ${completed.flatMap(s => s.items).join('; ')}.`);
    }
    if (inProgress.length > 0) {
      parts.push(`In progress: ${inProgress.flatMap(s => s.items).join('; ')}.`);
    }
    if (decisions.length > 0) {
      parts.push(`Decisions: ${decisions.flatMap(s => s.items).join('; ')}.`);
    }

    return parts.join(' ') || `No information found about "${topic}".`;
  }

  // ==========================================
  // Data query helpers
  // ==========================================

  private queryRelevantData(request: RecallRequest): {
    observations: any[];
    compiledKnowledge: any[];
    summaries: any[];
    checkpoints: any[];
  } {
    const { query, project, timeRange } = request;
    const searchTerms = query.split(/\s+/).filter(t => t.length > 2);
    const likePattern = `%${query}%`;

    // Query observations
    let observations: any[] = [];
    if (timeRange) {
      const startEpoch = new Date(timeRange.start).getTime();
      const endEpoch = new Date(timeRange.end).getTime();
      observations = this.db.prepare(
        'SELECT * FROM observations WHERE project = ? AND created_at_epoch BETWEEN ? AND ? ORDER BY created_at_epoch DESC LIMIT 50'
      ).all(project, startEpoch, endEpoch) as any[];
    } else {
      observations = this.db.prepare(
        'SELECT * FROM observations WHERE project = ? AND (title LIKE ? OR narrative LIKE ? OR concepts LIKE ?) ORDER BY created_at_epoch DESC LIMIT 50'
      ).all(project, likePattern, likePattern, likePattern) as any[];
    }

    // Query compiled knowledge
    let compiledKnowledge: any[] = [];
    try {
      compiledKnowledge = this.db.prepare(
        "SELECT * FROM compiled_knowledge WHERE project = ? AND valid_until IS NULL AND (topic LIKE ? OR content LIKE ?) ORDER BY compiled_at DESC LIMIT 10"
      ).all(project, likePattern, likePattern) as any[];
    } catch {
      // Table may not exist
    }

    // Query session summaries
    let summaries: any[] = [];
    if (timeRange) {
      const startEpoch = new Date(timeRange.start).getTime();
      const endEpoch = new Date(timeRange.end).getTime();
      summaries = this.db.prepare(
        'SELECT * FROM session_summaries WHERE project = ? AND created_at_epoch BETWEEN ? AND ? ORDER BY created_at_epoch DESC LIMIT 10'
      ).all(project, startEpoch, endEpoch) as any[];
    } else {
      summaries = this.db.prepare(
        'SELECT * FROM session_summaries WHERE project = ? AND (request LIKE ? OR completed LIKE ? OR next_steps LIKE ?) ORDER BY created_at_epoch DESC LIMIT 10'
      ).all(project, likePattern, likePattern, likePattern) as any[];
    }

    // Query checkpoints from active_tasks
    let checkpoints: any[] = [];
    try {
      checkpoints = this.db.prepare(
        "SELECT * FROM active_tasks WHERE project = ? AND (task_name LIKE ? OR context_json LIKE ?) ORDER BY updated_at_epoch DESC LIMIT 5"
      ).all(project, likePattern, likePattern) as any[];
    } catch {
      // Table may not exist
    }

    return { observations, compiledKnowledge, summaries, checkpoints };
  }

  private buildSections(observations: any[], compiledKnowledge: any[]): RecallSection[] {
    const sections: RecallSection[] = [];

    // Compiled knowledge as discoveries
    if (compiledKnowledge.length > 0) {
      sections.push({
        heading: 'Knowledge',
        items: compiledKnowledge.map((ck: any) => `${ck.topic}: ${ck.content.substring(0, 150)}`),
        type: 'discovery',
      });
    }

    // Group observations by type
    const completed: string[] = [];
    const inProgress: string[] = [];
    const decisions: string[] = [];

    const completedPatterns = /\b(completed|fixed|implemented|added|created|resolved|merged|deployed|built|finished)\b/i;
    const wipPatterns = /\b(WIP|TODO|partial|started|in progress|not yet|unfinished|incomplete)\b/i;

    for (const obs of observations) {
      const type = (obs.type || '').toLowerCase();
      const title = obs.title || '';
      const narrative = obs.narrative || '';
      const text = title + ' ' + narrative;

      if (type === 'decision') {
        decisions.push(title || narrative.substring(0, 80));
      } else if (type === 'feature' || type === 'bugfix' || completedPatterns.test(text)) {
        completed.push(title || narrative.substring(0, 80));
      } else if (wipPatterns.test(text)) {
        inProgress.push(title || narrative.substring(0, 80));
      }
    }

    if (completed.length > 0) {
      sections.push({ heading: 'Completed', items: deduplicate(completed), type: 'completed' });
    }
    if (inProgress.length > 0) {
      sections.push({ heading: 'In Progress', items: deduplicate(inProgress), type: 'in_progress' });
    }
    if (decisions.length > 0) {
      sections.push({ heading: 'Decisions', items: deduplicate(decisions), type: 'decision' });
    }

    return sections;
  }

  private assessConfidence(data: {
    observations: any[];
    compiledKnowledge: any[];
    summaries: any[];
    checkpoints: any[];
  }): 'high' | 'medium' | 'low' {
    if (data.compiledKnowledge.length > 0) return 'high';
    if (data.observations.length > 3) return 'medium';
    return 'low';
  }
}

/**
 * Format a date string as a readable heading
 */
function formatDateHeading(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.round((today.getTime() - date.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;

  return dateStr;
}

/**
 * Remove near-duplicate entries
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
