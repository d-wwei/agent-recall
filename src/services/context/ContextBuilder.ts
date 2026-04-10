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
import { renderRecallProtocol } from './sections/RecallProtocolRenderer.js';
import { renderMarkdownEmptyState } from './formatters/MarkdownFormatter.js';
import { renderColorEmptyState } from './formatters/ColorFormatter.js';
import { TokenBudgetManager } from './TokenBudgetManager.js';
import { PersonaService } from '../persona/PersonaService.js';
import type { MergedPersona, ActiveTaskRow, BootstrapStateRow, PersonaConflict } from '../persona/PersonaTypes.js';
import { AutoMemorySync } from '../sync/AutoMemorySync.js';
import { MarkdownImporter } from '../markdown-sync/MarkdownImporter.js';
import { CheckpointService } from '../recovery/CheckpointService.js';
import type { Checkpoint } from '../recovery/CheckpointService.js';
import { existsSync } from 'fs';

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
  personaConflicts?: PersonaConflict[],
  budgetManager?: TokenBudgetManager,
  completenessHints?: string[],
  compiledKnowledge?: any[],
  checkpoint?: Checkpoint | null
): string {
  const output: string[] = [];

  // Agent Recall: Render persona at the top (before everything else)
  // L0 — track consumption but don't gate (always renders)
  if (persona) {
    const personaLines = renderPersona(persona, useColors);
    output.push(...personaLines);
    if (budgetManager) {
      const personaText = personaLines.join('\n');
      budgetManager.consume('L0', TokenBudgetManager.estimateTokens(personaText));
    }
  }

  // Agent Recall: Inject RECALL_PROTOCOL behavioral directives (L0 — always present)
  // L0 — track consumption but don't gate
  const recallLines = renderRecallProtocol(useColors);
  output.push(...recallLines);
  if (budgetManager) {
    const recallText = recallLines.join('\n');
    budgetManager.consume('L0', TokenBudgetManager.estimateTokens(recallText));
  }

  // Agent Recall: Warn about persona conflicts if any
  if (personaConflicts && personaConflicts.length > 0) {
    const warning = `⚠ Persona conflicts detected (${personaConflicts.length} field${personaConflicts.length > 1 ? 's' : ''} differ between global and project). Use /api/persona/conflicts?project=${encodeURIComponent(project)} to review.`;
    output.push(warning, '');
  }

  // Agent Recall: Render active task (after persona, before timeline)
  // L1 — gate by token budget
  if (activeTask) {
    const taskLines = renderActiveTask(activeTask, useColors);
    const taskText = taskLines.join('\n');
    const taskTokens = TokenBudgetManager.estimateTokens(taskText);
    if (!budgetManager || budgetManager.canFit('L1', taskTokens)) {
      output.push(...taskLines);
      if (budgetManager) {
        budgetManager.consume('L1', taskTokens);
      }
    }
  }

  // Agent Recall: Inject checkpoint context for session resume (L1)
  if (checkpoint && !activeTask) {
    const checkpointLines = [
      `> **Last session checkpoint** (${checkpoint.savedAt}):`,
      `> Task: ${checkpoint.currentTask}`,
      checkpoint.testStatus ? `> Tests: ${checkpoint.testStatus}` : null,
      checkpoint.pendingWork.length > 0 ? `> Pending: ${checkpoint.pendingWork.join(', ')}` : null,
      checkpoint.resumeHint ? `> Resume: ${checkpoint.resumeHint}` : null,
    ].filter(Boolean) as string[];

    // Render task history from smart checkpoint
    if (checkpoint.taskHistory && checkpoint.taskHistory.length > 0) {
      const pending = checkpoint.taskHistory.filter(t => t.status === 'pending');
      const completed = checkpoint.taskHistory.filter(t => t.status === 'completed');
      if (completed.length > 0) {
        checkpointLines.push(`> Completed: ${completed.map(t => t.prompt).join('; ')}`);
      }
      if (pending.length > 0) {
        checkpointLines.push(`> Still pending: ${pending.map(t => t.prompt).join('; ')}`);
      }
    }

    checkpointLines.push('');
    const cpText = checkpointLines.join('\n');
    const cpTokens = TokenBudgetManager.estimateTokens(cpText);
    if (!budgetManager || budgetManager.canFit('L1', cpTokens)) {
      output.push(...checkpointLines);
      if (budgetManager) {
        budgetManager.consume('L1', cpTokens);
      }
    }
  }

  // Agent Recall: L1 completeness/staleness hints (after active task, before timeline)
  if (completenessHints && completenessHints.length > 0) {
    output.push(...completenessHints);
  }

  // Agent Recall: Show last session's next steps prominently (if no active task)
  // This helps the user immediately see what they were doing last time
  // L1 — gate by token budget
  if (!activeTask && summaries.length > 0 && summaries[0].next_steps) {
    const nextSteps = summaries[0].next_steps.trim();
    if (nextSteps) {
      let nextStepsLines: string[];
      if (useColors) {
        nextStepsLines = [`\x1b[33m◆ Last session's next steps:\x1b[0m ${nextSteps}`, ''];
      } else {
        nextStepsLines = [`**Last session's next steps:** ${nextSteps}`, ''];
      }
      const nextStepsText = nextStepsLines.join('\n');
      const nextStepsTokens = TokenBudgetManager.estimateTokens(nextStepsText);
      if (!budgetManager || budgetManager.canFit('L1', nextStepsTokens)) {
        output.push(...nextStepsLines);
        if (budgetManager) {
          budgetManager.consume('L1', nextStepsTokens);
        }
      }
    }
  }

  // Calculate token economics
  const economics = calculateTokenEconomics(observations);

  // Render header section
  output.push(...renderHeader(project, economics, config, useColors));

  // Phase 3: Prefer compiled knowledge for L2 if available
  if (compiledKnowledge && compiledKnowledge.length > 0) {
    // Use compiled knowledge pages instead of raw observations for context
    const ckLines = compiledKnowledge.map((ck: any) =>
      `### ${ck.topic}\n${ck.content}`
    );
    const ckText = ckLines.join('\n\n');
    const ckTokens = TokenBudgetManager.estimateTokens(ckText);
    if (budgetManager && budgetManager.canFit('L2', ckTokens)) {
      output.push('\n## Project Knowledge\n');
      output.push(ckText);
      budgetManager.consume('L2', ckTokens);
    }
  }

  // L2 — filter observations to fit within token budget before timeline rendering
  let fittedObservations = observations;
  if (budgetManager) {
    const l2Budget = budgetManager.remaining('L2');
    let tokenCount = 0;
    fittedObservations = observations.filter(obs => {
      const text = [obs.title, obs.narrative, obs.facts ? JSON.stringify(obs.facts) : null]
        .filter(Boolean)
        .join(' ');
      const tokens = TokenBudgetManager.estimateTokens(text);
      if (tokenCount + tokens <= l2Budget) {
        tokenCount += tokens;
        return true;
      }
      return false;
    });
  }

  // Prepare timeline data
  const displaySummaries = summaries.slice(0, config.sessionCount);
  const summariesForTimeline = prepareSummariesForTimeline(displaySummaries, summaries);
  const timeline = buildTimeline(fittedObservations, summariesForTimeline);
  const fullObservationIds = getFullObservationIds(fittedObservations, config.fullObservationCount);

  // Render timeline (streamlined: title + first fact only for L1 wake-up summary)
  output.push(...renderTimeline(timeline, fullObservationIds, config, cwd, useColors, true));

  // Render most recent summary if applicable
  const mostRecentSummary = summaries[0];
  const mostRecentObservation = fittedObservations[0];

  if (shouldShowSummary(config, mostRecentSummary, mostRecentObservation)) {
    output.push(...renderSummaryFields(mostRecentSummary, useColors));
  }

  // Render previously section (prior assistant message)
  const priorMessages = getPriorSessionMessages(fittedObservations, config, sessionId, cwd);
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

  // Phase 1: Auto memory sync — import user/feedback from ~/.claude/memory/
  try {
    const autoMemoryDir = path.join(homedir(), '.claude', 'memory');
    if (existsSync(autoMemoryDir)) {
      const autoSync = new AutoMemorySync(db.db, autoMemoryDir);
      const syncResult = autoSync.syncIncremental();
      if (syncResult.imported > 0) {
        logger.debug('CONTEXT', `Auto memory sync: imported ${syncResult.imported} entries`);
      }
    }
  } catch (err) {
    logger.debug('CONTEXT', 'Auto memory sync failed (non-blocking)', { error: String(err) });
  }

  // Phase 1b: Markdown bidirectional sync — check for user edits to exported markdown files
  try {
    const readableDir = path.join(homedir(), '.agent-recall', 'readable');
    if (existsSync(readableDir)) {
      const importer = new MarkdownImporter(db.db, readableDir);
      const changes = importer.checkForChanges();
      if (changes.length > 0) {
        const importCount = importer.importChanges(changes);
        if (importCount > 0) {
          logger.debug('CONTEXT', `Markdown import: imported ${importCount} user-edited files`);
        }
      }
    }
  } catch (err) {
    logger.debug('CONTEXT', 'Markdown import check failed (non-blocking)', { error: String(err) });
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
      const globalBudgetManager = new TokenBudgetManager((config as any).tokenBudget || 3000);

      // Global mode header
      if (useColors) {
        output.push(`\x1b[36m\x1b[1m● Global Mode\x1b[0m \x1b[2m— launched from home directory\x1b[0m`, '');
      } else {
        output.push(`**Global Mode** — launched from home directory`, '');
      }

      // Render global persona
      // L0 — track consumption but don't gate (always renders)
      if (persona) {
        const personaLines = renderPersona(persona, useColors);
        output.push(...personaLines);
        const personaText = personaLines.join('\n');
        globalBudgetManager.consume('L0', TokenBudgetManager.estimateTokens(personaText));
      }

      // Show active task overview (from any project)
      // L1 — gate by token budget
      if (activeTask) {
        const taskLines = renderActiveTask(activeTask, useColors);
        const taskText = taskLines.join('\n');
        const taskTokens = TokenBudgetManager.estimateTokens(taskText);
        if (globalBudgetManager.canFit('L1', taskTokens)) {
          output.push(...taskLines);
          globalBudgetManager.consume('L1', taskTokens);
        }
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
    let personaService: PersonaService | null = null;
    try {
      personaService = new PersonaService(db.db);
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

    // Agent Recall: Completeness/staleness hints (L1 — after active task, before timeline)
    // Only shown when bootstrap is completed; non-blocking on error.
    const completenessHints: string[] = [];
    if (bootstrapStatus?.status === 'completed' && personaService) {
      try {
        const completeness = personaService.checkCompleteness(project);
        const staleness = personaService.checkStaleness(project);

        if (completeness.percentage < 80 && completeness.gaps.length > 0) {
          completenessHints.push(`\n> Profile ${completeness.percentage}% complete. Missing: ${completeness.gaps.join(', ')}`);
        }
        if (staleness.staleFields.length > 0) {
          completenessHints.push(`\n> Some profile fields not updated in 90+ days: ${staleness.staleFields.join(', ')}`);
        }
      } catch (err) {
        // Non-blocking: completeness check failure shouldn't break context generation
        logger.debug('CONTEXT', 'Completeness check failed (non-blocking)', { error: String(err) });
      }
    }

    // Create token budget manager for L0-L3 enforcement
    const budgetManager = new TokenBudgetManager((config as any).tokenBudget || 3000);

    // Phase 3: Load compiled knowledge for L2 context preference
    let compiledKnowledge: any[] = [];
    try {
      compiledKnowledge = db.getCompiledKnowledge(project);
    } catch {
      // Non-blocking: compiled_knowledge table may not exist in older installs
    }

    // Load checkpoint for session resume context
    let checkpoint: Checkpoint | null = null;
    try {
      const checkpointService = new CheckpointService(db.db);
      checkpoint = checkpointService.getLatestCheckpoint(project);
    } catch {
      // Non-blocking: checkpoint loading failure shouldn't break context generation
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
      personaConflicts,
      budgetManager,
      completenessHints,
      compiledKnowledge,
      checkpoint
    );

    return output;
  } finally {
    db.close();
  }
}
