import { Request, Response } from 'express';
import type { Application } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import type { ActiveLearningService } from '../../../learning/ActiveLearningService.js';

export class LearningRoutes extends BaseRouteHandler {
  constructor(private learningService: ActiveLearningService) {
    super();
  }

  setupRoutes(app: Application): void {
    app.get('/api/learning/gaps', this.wrapHandler(this.handleGaps.bind(this)));
    app.get('/api/learning/completeness', this.wrapHandler(this.handleCompleteness.bind(this)));
    app.get('/api/learning/prompt', this.wrapHandler(this.handlePrompt.bind(this)));
  }

  private handleGaps(req: Request, res: Response): void {
    const project = req.query.project as string;
    const projectDir = req.query.projectDir as string;
    if (!project || !projectDir) {
      this.badRequest(res, 'project and projectDir query parameters required');
      return;
    }
    const gaps = this.learningService.detectGaps(project, projectDir);
    res.json(gaps);
  }

  private handleCompleteness(req: Request, res: Response): void {
    const project = req.query.project as string;
    if (!project) { this.badRequest(res, 'project query parameter required'); return; }
    const score = this.learningService.getCompletenessScore(project);
    res.json({ score });
  }

  private handlePrompt(req: Request, res: Response): void {
    const project = req.query.project as string;
    const projectDir = req.query.projectDir as string;
    if (!project || !projectDir) {
      this.badRequest(res, 'project and projectDir query parameters required');
      return;
    }
    const gaps = this.learningService.detectGaps(project, projectDir);
    const prompt = this.learningService.generateLearningPrompt(gaps);
    res.json({ prompt });
  }
}
