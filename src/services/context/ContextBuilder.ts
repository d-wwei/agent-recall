/**
 * ContextBuilder - Main orchestrator for context generation
 *
 * Coordinates all context generation components to build the final output.
 * This is the primary entry point for context generation.
 */

import path from 'path';
import { homedir } from 'os';
import { unlinkSync } from 'fs';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { getProjectName, isHomeDirectory } from '../../utils/project-name.js';

import type { ContextInput, ContextConfig, Observation, SessionSummary } from './types.js';
import { loadContextConfig } from './ContextConfigLoader.js';
import { calculateTokenEconomics } from './TokenCalculator.js';
import {
  queryObservations,
  queryObservationsMulti,
  querySummaries,
  querySummariesMulti,
  getPriorSessionMessages,
  prepareSummariesForTimeline,
  buildTimeline,
  getFullObservationIds,
} from './ObservationCompiler.js';
import { renderHeader } from './sections/HeaderRenderer.js';
import { renderTimeline } from './sections/TimelineRenderer.js';
import { shouldShowSummary, renderSummaryFields } from './sections/SummaryRenderer.js';
import { renderPreviouslySection, renderFooter } from './sections/FooterRenderer.js';
import { renderPersona } from './sections/PersonaRenderer.js';
import { renderActiveTask } from './sections/ActiveTaskRenderer.js';
import { renderMarkdownEmptyState } from './formatters/MarkdownFormatter.js';
import { renderColorEmptyState } from './formatters/ColorFormatter.js';
import { PersonaService } from '../persona/PersonaService.js';
import type { MergedPersona, ActiveTaskRow, BootstrapStateRow, PersonaConflict } from '../persona/PersonaTypes.js';

// Version marker path for native module error handling
const VERSION_MARKER_PATH = path.join(
  homedir(),
  '.claude',
  'plugins',
  'marketplaces',
  'agent-recall',
  'plugin',
  '.install-version'
);

/**
 * Initialize database connection with error handling
 */
function initializeDatabase(): SessionStore | null {
  try {
    return new SessionStore();
  } catch (error: any) {
    if (error.code === 'ERR_DLOPEN_FAILED') {
      try {
        unlinkSync(VERSION_MARKER_PATH);
      } catch (unlinkError) {
        logger.debug('SYSTEM', 'Marker file cleanup failed (may not exist)', {}, unlinkError as Error);
      }
      logger.error('SYSTEM', 'Native module rebuild needed - restart Claude Code to auto-fix');
      return null;
    }
    throw error;
  }
}

/**
 * Render empty state when no data exists.
 * If bootstrap has not been completed, include a welcome prompt.
 */
function renderEmptyState(
  project: string,
  useColors: boolean,
  bootstrapStatus?: BootstrapStateRow | null
): string {
  const base = useColors ? renderColorEmptyState(project) : renderMarkdownEmptyState(project);

  // If bootstrap is not completed, append a welcome prompt
  const needsBootstrap = !bootstrapStatus || bootstrapStatus.status !== 'completed';
  if (needsBootstrap) {
    const welcomeMessage = useColors
      ? `\n\x1b[33m\x1b[1m★ Welcome to Agent Recall!\x1b[0m\n\x1b[33mRun /bootstrap to set up your agent persona and preferences.\x1b[0m\n\x1b[2mThis creates a persistent identity that carries across sessions.\x1b[0m\n`
      : `\n**Welcome to Agent Recall!** Run /bootstrap to set up your agent persona and preferences.\nThis creates a persistent identity that carries across sessions.\n`;
    return base + welcomeMessage;
  }

  return base;
}

/**
 * Build context output from loaded data
 */
function buildContextOutput(
  project: string,
  observations: Observation[],
  summaries: SessionSummary[],
  config: ContextConfig,
  cwd: string,
  sessionId: string | undefined,
  useColors: boolean,
  persona?: MergedPersona | null,
  activeTask?: ActiveTaskRow | null,
  personaConflicts?: PersonaConflict[]
): string {
  const output: string[] = [];

  // Agent Recall: Render persona at the top (before everything else)
  if (persona) {
    output.push(...renderPersona(persona, useColors));
  }

  // Agent Recall: Warn about persona conflicts if any
  if (personaConflicts && personaConflicts.length > 0) {
    const warning = `⚠ Persona conflicts detected (${personaConflicts.length} field${personaConflicts.length > 1 ? 's' : ''} differ between global and project). Use /api/persona/conflicts?project=${encodeURIComponent(project)} to review.`;
    output.push(warning, '');
  }

  // Agent Recall: Render active task (after persona, before timeline)
  if (activeTask) {
    output.push(...renderActiveTask(activeTask, useColors));
  }

  // Agent Recall: Show last session's next steps prominently (if no active task)
  // This helps the user immediately see what they were doing last time
  if (!activeTask && summaries.length > 0 && summaries[0].next_steps) {
    const nextSteps = summaries[0].next_steps.trim();
    if (nextSteps) {
      if (useColors) {
        output.push(`\x1b[33m◆ Last session's next steps:\x1b[0m ${nextSteps}`, '');
      } else {
        output.push(`**Last session's next steps:** ${nextSteps}`, '');
      }
    }
  }

  // Calculate token economics
  const economics = calculateTokenEconomics(observations);

  // Render header section
  output.push(...renderHeader(project, economics, config, useColors));

  // Prepare timeline data
  const displaySummaries = summaries.slice(0, config.sessionCount);
  const summariesForTimeline = prepareSummariesForTimeline(displaySummaries, summaries);
  const timeline = buildTimeline(observations, summariesForTimeline);
  const fullObservationIds = getFullObservationIds(observations, config.fullObservationCount);

  // Render timeline
  output.push(...renderTimeline(timeline, fullObservationIds, config, cwd, useColors));

  // Render most recent summary if applicable
  const mostRecentSummary = summaries[0];
  const mostRecentObservation = observations[0];

  if (shouldShowSummary(config, mostRecentSummary, mostRecentObservation)) {
    output.push(...renderSummaryFields(mostRecentSummary, useColors));
  }

  // Render previously section (prior assistant message)
  const priorMessages = getPriorSessionMessages(observations, config, sessionId, cwd);
  output.push(...renderPreviouslySection(priorMessages, useColors));

  // Render footer
  output.push(...renderFooter(economics, config, useColors));

  return output.join('\n').trimEnd();
}

/**
 * Generate context for a project
 *
 * Main entry point for context generation. Orchestrates loading config,
 * querying data, and rendering the final context string.
 */
export async function generateContext(
  input?: ContextInput,
  useColors: boolean = false
): Promise<string> {
  const config = loadContextConfig();
  const cwd = input?.cwd ?? process.cwd();
  const project = getProjectName(cwd);

  // Detect global mode: launched from HOME directory or explicitly requested
  const globalMode = input?.globalMode ?? isHomeDirectory(cwd);

  // Use provided projects array (for worktree support) or fall back to single project
  const projects = input?.projects || [project];

  // Full mode: fetch all observations but keep normal rendering (level 1 summaries)
  if (input?.full) {
    config.totalObservationCount = 999999;
    config.sessionCount = 999999;
  }

  // Initialize database
  const db = initializeDatabase();
  if (!db) {
    return '';
  }

  try {
    // Global Quick Mode: skip project-specific observations and summaries,
    // only load global persona and active tasks as an overview
    if (globalMode) {
      logger.debug('CONTEXT', 'Global Quick Mode — skipping project-specific context', { cwd, project });

      let persona: MergedPersona | null = null;
      let activeTask: ActiveTaskRow | null = null;
      let bootstrapStatus: BootstrapStateRow | null = null;
      try {
        const personaService = new PersonaService(db.db);
        // Only load global persona (scope='global'), no project-specific merge
        persona = personaService.getMergedPersona('__global__');
        bootstrapStatus = personaService.getBootstrapStatus('__global__');
        // Still show active tasks from any project as a cross-project overview
        activeTask = personaService.getActiveTask(project);
      } catch (e) {
        logger.debug('CONTEXT', 'Persona query skipped in global mode (tables may not exist yet)', {}, e as Error);
      }

      const output: string[] = [];

      // Global mode header
      if (useColors) {
        output.push(`\x1b[36m\x1b[1m● Global Mode\x1b[0m \x1b[2m— launched from home directory\x1b[0m`, '');
      } else {
        output.push(`**Global Mode** — launched from home directory`, '');
      }

      // Render global persona
      if (persona) {
        output.push(...renderPersona(persona, useColors));
      }

      // Show active task overview (from any project)
      if (activeTask) {
        output.push(...renderActiveTask(activeTask, useColors));
      }

      // If no persona exists and bootstrap not completed, show welcome
      if (!persona?.agent_soul?.name) {
        const emptyState = renderEmptyState(project, useColors, bootstrapStatus);
        if (emptyState) {
          output.push(emptyState);
        }
      }

      return output.join('\n').trimEnd();
    }

    // Standard mode: full project-specific context generation
    // Query data for all projects (supports worktree: parent + worktree combined)
    const observations = projects.length > 1
      ? queryObservationsMulti(db, projects, config)
      : queryObservations(db, project, config);
    const summaries = projects.length > 1
      ? querySummariesMulti(db, projects, config)
      : querySummaries(db, project, config);

    // Agent Recall: Query persona, active task, bootstrap status, and conflicts
    let persona: MergedPersona | null = null;
    let activeTask: ActiveTaskRow | null = null;
    let bootstrapStatus: BootstrapStateRow | null = null;
    let personaConflicts: PersonaConflict[] = [];
    try {
      const personaService = new PersonaService(db.db);
      persona = personaService.getMergedPersona(project);
      activeTask = personaService.getActiveTask(project);
      bootstrapStatus = personaService.getBootstrapStatus('__global__');
      personaConflicts = personaService.detectConflicts(project);
    } catch (e) {
      // Graceful degradation: persona/recovery tables may not exist yet
      logger.debug('CONTEXT', 'Persona query skipped (tables may not exist yet)', {}, e as Error);
    }

    // Handle empty state (but still show persona if it exists)
    if (observations.length === 0 && summaries.length === 0 && !persona?.agent_soul?.name) {
      return renderEmptyState(project, useColors, bootstrapStatus);
    }

    // Build and return context
    const output = buildContextOutput(
      project,
      observations,
      summaries,
      config,
      cwd,
      input?.session_id,
      useColors,
      persona,
      activeTask,
      personaConflicts
    );

    return output;
  } finally {
    db.close();
  }
}
