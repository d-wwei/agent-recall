import { Request, Response } from 'express';
import type { Application } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import type { TeamKnowledgeService } from '../../../collaboration/TeamKnowledgeService.js';
import type { MultiAgentCoordinator } from '../../../collaboration/MultiAgentCoordinator.js';

export class CollaborationRoutes extends BaseRouteHandler {
  constructor(
    private teamService: TeamKnowledgeService,
    private coordinator: MultiAgentCoordinator
  ) {
    super();
  }

  setupRoutes(app: Application): void {
    // Team knowledge
    app.post('/api/team/share', this.wrapHandler(this.handleShare.bind(this)));
    app.get('/api/team/shared', this.wrapHandler(this.handleGetShared.bind(this)));
    app.post('/api/team/import', this.wrapHandler(this.handleImport.bind(this)));

    // Multi-agent coordination
    app.get('/api/agents/active', this.wrapHandler(this.handleActiveSessions.bind(this)));
    app.get('/api/agents/conflicts', this.wrapHandler(this.handleConflicts.bind(this)));
    app.post('/api/agents/propagate', this.wrapHandler(this.handlePropagate.bind(this)));
    app.get('/api/agents/discoveries', this.wrapHandler(this.handleDiscoveries.bind(this)));
  }

  private handleShare(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['compiledKnowledgeId', 'sharedBy'])) return;
    const id = this.teamService.shareKnowledge(req.body.compiledKnowledgeId, req.body.sharedBy);
    res.json({ id });
  }

  private handleGetShared(req: Request, res: Response): void {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const shared = this.teamService.getSharedKnowledge(project);
    res.json(shared);
  }

  private handleImport(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['id', 'topic', 'content', 'sharedBy', 'project'])) return;
    const id = this.teamService.importShared(req.body);
    res.json({ id });
  }

  private handleActiveSessions(req: Request, res: Response): void {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const sessions = this.coordinator.getActiveSessions(project);
    res.json(sessions);
  }

  private handleConflicts(req: Request, res: Response): void {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const conflicts = this.coordinator.detectFileConflicts(project);
    res.json(conflicts);
  }

  private handlePropagate(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['fromSessionId', 'observationId'])) return;
    this.coordinator.propagateDiscovery(req.body.fromSessionId, req.body.observationId);
    res.json({ success: true });
  }

  private handleDiscoveries(req: Request, res: Response): void {
    const project = req.query.project as string;
    const since = parseInt(req.query.since as string, 10) || 0;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const discoveries = this.coordinator.getPropagatedDiscoveries(project, since);
    res.json(discoveries);
  }
}
