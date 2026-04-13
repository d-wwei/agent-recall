import { Request, Response } from 'express';
import type { Application } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import type { CrossProjectService } from '../../../promotion/CrossProjectService.js';

export class CrossProjectRoutes extends BaseRouteHandler {
  constructor(private crossProjectService: CrossProjectService) {
    super();
  }

  setupRoutes(app: Application): void {
    app.get('/api/cross-project/patterns', this.wrapHandler(this.handlePatterns.bind(this)));
    app.post('/api/cross-project/promote', this.wrapHandler(this.handlePromote.bind(this)));
    app.get('/api/cross-project/global', this.wrapHandler(this.handleGlobal.bind(this)));
  }

  private handlePatterns(_req: Request, res: Response): void {
    const patterns = this.crossProjectService.detectGlobalPatterns();
    res.json(patterns);
  }

  private handlePromote(req: Request, res: Response): void {
    if (!this.validateRequired(req, res, ['pattern', 'projects', 'confidence'])) return;
    this.crossProjectService.promoteToGlobal(req.body);
    res.json({ success: true });
  }

  private handleGlobal(_req: Request, res: Response): void {
    const knowledge = this.crossProjectService.getGlobalKnowledge();
    res.json(knowledge);
  }
}
