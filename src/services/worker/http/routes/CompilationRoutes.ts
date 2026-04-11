/**
 * Compilation Routes
 *
 * HTTP API for knowledge compilation pipeline observability.
 * Provides statistics, run history, and compiled Mermaid diagrams
 * for a given project.
 *
 * GET /api/compilation/stats?project=<name>    — aggregate stats + lint warnings
 * GET /api/compilation/logs?project=<name>&limit=<n> — run history
 * GET /api/compilation/diagrams?project=<name> — latest compiled Mermaid diagrams
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { CompilationLogger } from '../../../compilation/CompilationLogger.js';
import { KnowledgeLint } from '../../../compilation/KnowledgeLint.js';
import { logger } from '../../../../utils/logger.js';
import type { DatabaseManager } from '../../DatabaseManager.js';

interface CompiledKnowledgeRow {
  content: string;
  compiled_at: string;
  version: number;
}

export class CompilationRoutes extends BaseRouteHandler {
  constructor(private dbManager: DatabaseManager) {
    super();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/compilation/stats', this.wrapHandler(this.handleGetStats.bind(this)));
    app.get('/api/compilation/logs', this.wrapHandler(this.handleGetLogs.bind(this)));
    app.get('/api/compilation/diagrams', this.wrapHandler(this.handleGetDiagrams.bind(this)));
  }

  /**
   * Aggregate compilation statistics for a project, including AI merge config
   * and lint warnings.
   * GET /api/compilation/stats?project=my-project
   *
   * Returns: { lastCompilation, totalRuns, successRate, aiMergeActive,
   *            aiMergeModel, lintWarnings }
   */
  private handleGetStats(req: Request, res: Response): void {
    const project = req.query.project as string | undefined;

    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }

    const db = this.dbManager.getSessionStore().db;

    try {
      const compilationLogger = new CompilationLogger(db);
      const stats = compilationLogger.getStats(project);
      const latestLog = compilationLogger.getLatestLog(project);

      const lint = new KnowledgeLint(db);
      const lintResult = lint.run(project);

      const aiMergeActive =
        !!process.env.ANTHROPIC_API_KEY &&
        process.env.AGENT_RECALL_AI_MERGE_ENABLED !== 'false';

      const aiMergeModel =
        process.env.AGENT_RECALL_COMPILATION_MODEL ?? null;

      res.json({
        lastCompilation: latestLog,
        totalRuns: stats.totalRuns,
        successRate: stats.successRate,
        aiMergeActive,
        aiMergeModel,
        lintWarnings: lintResult.warnings,
      });
    } catch (error) {
      logger.error('COMPILATION', 'Failed to compute compilation stats', { project }, error as Error);
      throw error;
    }
  }

  /**
   * Compilation run history for a project.
   * GET /api/compilation/logs?project=my-project&limit=20
   *
   * Returns an array of CompilationLog entries, newest first.
   */
  private handleGetLogs(req: Request, res: Response): void {
    const project = req.query.project as string | undefined;

    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }

    const limitParam = req.query.limit as string | undefined;
    const limit = limitParam ? parseInt(limitParam, 10) : 20;

    if (isNaN(limit) || limit < 1) {
      this.badRequest(res, 'limit must be a positive integer');
      return;
    }

    const db = this.dbManager.getSessionStore().db;

    try {
      const compilationLogger = new CompilationLogger(db);
      const logs = compilationLogger.getHistory(project, limit);
      res.json(logs);
    } catch (error) {
      logger.error('COMPILATION', 'Failed to fetch compilation logs', { project }, error as Error);
      throw error;
    }
  }

  /**
   * Latest compiled Mermaid diagram content for a project.
   * GET /api/compilation/diagrams?project=my-project
   *
   * Returns: { content, compiledAt, version } or
   *          { content: null, compiledAt: null, version: 0 } when none exists.
   */
  private handleGetDiagrams(req: Request, res: Response): void {
    const project = req.query.project as string | undefined;

    if (!project) {
      this.badRequest(res, 'project query parameter is required');
      return;
    }

    const db = this.dbManager.getSessionStore().db;

    try {
      const row = db.prepare(
        `SELECT content, compiled_at, version
         FROM compiled_knowledge
         WHERE project = ?
           AND topic = '_mermaid_diagrams'
           AND valid_until IS NULL
         ORDER BY version DESC
         LIMIT 1`
      ).get(project) as CompiledKnowledgeRow | undefined;

      if (row) {
        res.json({
          content: row.content,
          compiledAt: row.compiled_at,
          version: row.version,
        });
      } else {
        res.json({
          content: null,
          compiledAt: null,
          version: 0,
        });
      }
    } catch (error) {
      logger.error('COMPILATION', 'Failed to fetch compilation diagrams', { project }, error as Error);
      throw error;
    }
  }
}
