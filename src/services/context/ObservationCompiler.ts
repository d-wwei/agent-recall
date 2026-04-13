/**
 * ObservationCompiler - Query building and data retrieval for context
 *
 * Handles database queries for observations and summaries, plus transcript extraction.
 * Includes information-density-weighted ranking to prioritize rich observations
 * over sparse recent ones when selecting which observations fit the context window.
 */

import path from 'path';
import { existsSync, readFileSync } from 'fs';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { CLAUDE_CONFIG_DIR } from '../../shared/paths.js';
import type {
  ContextConfig,
  Observation,
  SessionSummary,
  SummaryTimelineItem,
  TimelineItem,
  PriorMessages,
} from './types.js';
import { SUMMARY_LOOKAHEAD } from './types.js';

/** Multiplier for over-fetching observations before density ranking */
const DENSITY_FETCH_MULTIPLIER = 2;

/**
 * Query observations from database with type and concept filtering.
 *
 * Over-fetches by DENSITY_FETCH_MULTIPLIER, then applies density+recency
 * ranking to select the best observations for the context window.
 */
export function queryObservations(
  db: SessionStore,
  project: string,
  config: ContextConfig
): Observation[] {
  const typeArray = Array.from(config.observationTypes);
  const typePlaceholders = typeArray.map(() => '?').join(',');
  const conceptArray = Array.from(config.observationConcepts);
  const conceptPlaceholders = conceptArray.map(() => '?').join(',');

  const fetchLimit = config.totalObservationCount * DENSITY_FETCH_MULTIPLIER;

  const candidates = db.db.prepare(`
    SELECT
      id, memory_session_id, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified, discovery_tokens,
      created_at, created_at_epoch
    FROM observations
    WHERE (project = ? OR scope = 'global')
      AND type IN (${typePlaceholders})
      AND EXISTS (
        SELECT 1 FROM json_each(concepts)
        WHERE value IN (${conceptPlaceholders})
      )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(project, ...typeArray, ...conceptArray, fetchLimit) as Observation[];

  return rankByDensity(candidates, config.totalObservationCount);
}

/**
 * Query recent session summaries from database
 */
export function querySummaries(
  db: SessionStore,
  project: string,
  config: ContextConfig
): SessionSummary[] {
  return db.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, structured_summary, created_at, created_at_epoch
    FROM session_summaries
    WHERE project = ? OR scope = 'global'
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(project, config.sessionCount + SUMMARY_LOOKAHEAD) as SessionSummary[];
}

/**
 * Query observations from multiple projects (for worktree support)
 *
 * Returns observations from all specified projects, interleaved chronologically.
 * Used when running in a worktree to show both parent repo and worktree observations.
 * Over-fetches and applies density+recency ranking like queryObservations.
 */
export function queryObservationsMulti(
  db: SessionStore,
  projects: string[],
  config: ContextConfig
): Observation[] {
  const typeArray = Array.from(config.observationTypes);
  const typePlaceholders = typeArray.map(() => '?').join(',');
  const conceptArray = Array.from(config.observationConcepts);
  const conceptPlaceholders = conceptArray.map(() => '?').join(',');

  // Build IN clause for projects
  const projectPlaceholders = projects.map(() => '?').join(',');

  const fetchLimit = config.totalObservationCount * DENSITY_FETCH_MULTIPLIER;

  const candidates = db.db.prepare(`
    SELECT
      id, memory_session_id, type, title, subtitle, narrative,
      facts, concepts, files_read, files_modified, discovery_tokens,
      created_at, created_at_epoch, project
    FROM observations
    WHERE (project IN (${projectPlaceholders}) OR scope = 'global')
      AND type IN (${typePlaceholders})
      AND EXISTS (
        SELECT 1 FROM json_each(concepts)
        WHERE value IN (${conceptPlaceholders})
      )
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...projects, ...typeArray, ...conceptArray, fetchLimit) as Observation[];

  return rankByDensity(candidates, config.totalObservationCount);
}

/**
 * Query session summaries from multiple projects (for worktree support)
 *
 * Returns summaries from all specified projects, interleaved chronologically.
 * Used when running in a worktree to show both parent repo and worktree summaries.
 */
export function querySummariesMulti(
  db: SessionStore,
  projects: string[],
  config: ContextConfig
): SessionSummary[] {
  // Build IN clause for projects
  const projectPlaceholders = projects.map(() => '?').join(',');

  return db.db.prepare(`
    SELECT id, memory_session_id, request, investigated, learned, completed, next_steps, structured_summary, created_at, created_at_epoch, project
    FROM session_summaries
    WHERE project IN (${projectPlaceholders}) OR scope = 'global'
    ORDER BY created_at_epoch DESC
    LIMIT ?
  `).all(...projects, config.sessionCount + SUMMARY_LOOKAHEAD) as SessionSummary[];
}

/**
 * Calculate information-density score for an observation.
 *
 * Score = recency_weight + density_weight
 *
 * recency_weight: Linear decay from 1.0 to 0.0 over 168 hours (7 days).
 *   Observations older than 7 days get recency_weight = 0.
 *
 * density_weight: Sum of bonuses for content richness (max ~0.8):
 *   - has_title:         +0.1
 *   - facts_count:       +0.1 per fact, capped at 0.3
 *   - concepts_count:    +0.05 per concept, capped at 0.2
 *   - has_narrative:     +0.1
 *   - has_files_modified:+0.1
 *
 * A rich observation from yesterday (~0.86 + 0.8 = 1.66) outranks
 * a sparse observation from 1 hour ago (~0.99 + 0.1 = 1.09).
 */
function scoreDensity(obs: Observation, nowEpoch: number): number {
  // --- Recency weight ---
  const ageHours = (nowEpoch - obs.created_at_epoch) / 3600;
  const recencyWeight = Math.max(0, 1.0 - ageHours / 168);

  // --- Density weight ---
  let densityWeight = 0;

  // Title bonus
  if (obs.title && obs.title.trim().length > 0) {
    densityWeight += 0.1;
  }

  // Facts bonus (JSON array string)
  if (obs.facts) {
    try {
      const factsArray = JSON.parse(obs.facts);
      if (Array.isArray(factsArray)) {
        densityWeight += Math.min(factsArray.length * 0.1, 0.3);
      }
    } catch {
      // Malformed JSON — treat as having 1 fact if non-empty
      if (obs.facts.trim().length > 0) {
        densityWeight += 0.1;
      }
    }
  }

  // Concepts bonus (JSON array string)
  if (obs.concepts) {
    try {
      const conceptsArray = JSON.parse(obs.concepts);
      if (Array.isArray(conceptsArray)) {
        densityWeight += Math.min(conceptsArray.length * 0.05, 0.2);
      }
    } catch {
      if (obs.concepts.trim().length > 0) {
        densityWeight += 0.05;
      }
    }
  }

  // Narrative bonus
  if (obs.narrative && obs.narrative.trim().length > 0) {
    densityWeight += 0.1;
  }

  // Files modified bonus
  if (obs.files_modified) {
    try {
      const filesArray = JSON.parse(obs.files_modified);
      if (Array.isArray(filesArray) && filesArray.length > 0) {
        densityWeight += 0.1;
      }
    } catch {
      if (obs.files_modified.trim().length > 0) {
        densityWeight += 0.1;
      }
    }
  }

  return recencyWeight + densityWeight;
}

/**
 * Rank observations by information density + recency.
 *
 * Takes an over-fetched pool of observations (sorted by recency from DB),
 * scores each by density + recency, selects the top `limit`, then re-sorts
 * chronologically so the timeline reads in natural time order.
 *
 * @param candidates - Observations fetched from DB (more than needed)
 * @param limit - How many to keep for the context window
 * @returns Top-N observations re-sorted chronologically (oldest first for timeline)
 */
export function rankByDensity(candidates: Observation[], limit: number): Observation[] {
  if (candidates.length <= limit) {
    return candidates;
  }

  const nowEpoch = Math.floor(Date.now() / 1000);

  // Score each observation
  const scored = candidates.map(obs => ({
    obs,
    score: scoreDensity(obs, nowEpoch),
  }));

  // Sort by score descending — highest density+recency first
  scored.sort((a, b) => b.score - a.score);

  // Take the top N
  const selected = scored.slice(0, limit).map(s => s.obs);

  // Re-sort chronologically (by created_at_epoch ascending) for timeline display
  // Note: the original query returns DESC; we preserve DESC here so downstream
  // code (getFullObservationIds, getPriorSessionMessages) which expects most-recent-first
  // still works correctly. buildTimeline() will re-sort ascending internally.
  selected.sort((a, b) => b.created_at_epoch - a.created_at_epoch);

  return selected;
}

/**
 * Convert cwd path to dashed format for transcript lookup
 */
function cwdToDashed(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

/**
 * Extract prior messages from transcript file
 */
export function extractPriorMessages(transcriptPath: string): PriorMessages {
  try {
    if (!existsSync(transcriptPath)) {
      return { userMessage: '', assistantMessage: '' };
    }

    const content = readFileSync(transcriptPath, 'utf-8').trim();
    if (!content) {
      return { userMessage: '', assistantMessage: '' };
    }

    const lines = content.split('\n').filter(line => line.trim());
    let lastAssistantMessage = '';

    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const line = lines[i];
        if (!line.includes('"type":"assistant"')) {
          continue;
        }

        const entry = JSON.parse(line);
        if (entry.type === 'assistant' && entry.message?.content && Array.isArray(entry.message.content)) {
          let text = '';
          for (const block of entry.message.content) {
            if (block.type === 'text') {
              text += block.text;
            }
          }
          text = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
          if (text) {
            lastAssistantMessage = text;
            break;
          }
        }
      } catch (parseError) {
        logger.debug('PARSER', 'Skipping malformed transcript line', { lineIndex: i }, parseError as Error);
        continue;
      }
    }

    return { userMessage: '', assistantMessage: lastAssistantMessage };
  } catch (error) {
    logger.failure('WORKER', `Failed to extract prior messages from transcript`, { transcriptPath }, error as Error);
    return { userMessage: '', assistantMessage: '' };
  }
}

/**
 * Get prior session messages if enabled
 */
export function getPriorSessionMessages(
  observations: Observation[],
  config: ContextConfig,
  currentSessionId: string | undefined,
  cwd: string
): PriorMessages {
  if (!config.showLastMessage || observations.length === 0) {
    return { userMessage: '', assistantMessage: '' };
  }

  const priorSessionObs = observations.find(obs => obs.memory_session_id !== currentSessionId);
  if (!priorSessionObs) {
    return { userMessage: '', assistantMessage: '' };
  }

  const priorSessionId = priorSessionObs.memory_session_id;
  const dashedCwd = cwdToDashed(cwd);
  // Use CLAUDE_CONFIG_DIR to support custom Claude config directories
  const transcriptPath = path.join(CLAUDE_CONFIG_DIR, 'projects', dashedCwd, `${priorSessionId}.jsonl`);
  return extractPriorMessages(transcriptPath);
}

/**
 * Prepare summaries for timeline display
 */
export function prepareSummariesForTimeline(
  displaySummaries: SessionSummary[],
  allSummaries: SessionSummary[]
): SummaryTimelineItem[] {
  const mostRecentSummaryId = allSummaries[0]?.id;

  return displaySummaries.map((summary, i) => {
    const olderSummary = i === 0 ? null : allSummaries[i + 1];
    return {
      ...summary,
      displayEpoch: olderSummary ? olderSummary.created_at_epoch : summary.created_at_epoch,
      displayTime: olderSummary ? olderSummary.created_at : summary.created_at,
      shouldShowLink: summary.id !== mostRecentSummaryId
    };
  });
}

/**
 * Build unified timeline from observations and summaries
 */
export function buildTimeline(
  observations: Observation[],
  summaries: SummaryTimelineItem[]
): TimelineItem[] {
  const timeline: TimelineItem[] = [
    ...observations.map(obs => ({ type: 'observation' as const, data: obs })),
    ...summaries.map(summary => ({ type: 'summary' as const, data: summary }))
  ];

  // Sort chronologically
  timeline.sort((a, b) => {
    const aEpoch = a.type === 'observation' ? a.data.created_at_epoch : a.data.displayEpoch;
    const bEpoch = b.type === 'observation' ? b.data.created_at_epoch : b.data.displayEpoch;
    return aEpoch - bEpoch;
  });

  return timeline;
}

/**
 * Get set of observation IDs that should show full details
 */
export function getFullObservationIds(observations: Observation[], count: number): Set<number> {
  return new Set(
    observations
      .slice(0, count)
      .map(obs => obs.id)
  );
}
