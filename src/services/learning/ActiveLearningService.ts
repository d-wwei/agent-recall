/**
 * ActiveLearningService - Knowledge gap detection and learning prompts
 *
 * Scans a project's directory structure, compares it against existing
 * observations, and identifies areas with little or no coverage.
 * Generates context injection hints to guide future sessions toward
 * under-explored modules.
 */

import { Database } from 'bun:sqlite';
import { readdirSync, statSync } from 'fs';
import { join, basename } from 'path';
import { logger } from '../../utils/logger.js';

export interface KnowledgeGap {
  area: string;
  reason: string;
  priority: 'high' | 'medium' | 'low';
}

export class ActiveLearningService {
  constructor(private db: Database) {}

  /**
   * Detect knowledge gaps for a project.
   *
   * 1. Scans projectDir for major modules (top-level src/ subdirectories)
   * 2. Counts observations per module (by files_modified matching)
   * 3. Modules with 0-1 observations = gap
   *
   * Priority: high if module has many files (>=5), medium (>=2), low otherwise.
   */
  detectGaps(project: string, projectDir: string): KnowledgeGap[] {
    const modules = this._discoverModules(projectDir);
    if (modules.length === 0) return [];

    const gaps: KnowledgeGap[] = [];

    for (const mod of modules) {
      const obsCount = this._countObservationsForModule(project, mod.name);
      if (obsCount <= 1) {
        const priority = mod.fileCount >= 5 ? 'high' : mod.fileCount >= 2 ? 'medium' : 'low';
        gaps.push({
          area: mod.name,
          reason: `${mod.fileCount} files in ${mod.path} but ${obsCount} observation${obsCount === 1 ? '' : 's'}`,
          priority,
        });
      }
    }

    // Sort: high first, then medium, then low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    gaps.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return gaps;
  }

  /**
   * Generate a context injection hint from detected gaps.
   * Returns a formatted string suitable for prepending to session context.
   */
  generateLearningPrompt(gaps: KnowledgeGap[]): string {
    if (gaps.length === 0) {
      return '> All project modules have good observation coverage.';
    }

    const lines = gaps.map(g => `${g.area} (${g.reason})`);
    return [
      `> Knowledge gaps detected: ${lines.join('; ')}.`,
      '> Pay attention to these areas during this session.',
    ].join('\n');
  }

  /**
   * Calculate completeness score for a project.
   * Returns 0-100: what percentage of project modules have observations.
   */
  getCompletenessScore(project: string): number {
    // Get all distinct module areas from observations
    const obsRows = this.db.prepare(`
      SELECT DISTINCT files_modified FROM observations
      WHERE project = ? AND files_modified IS NOT NULL AND files_modified != ''
    `).all(project) as any[];

    if (obsRows.length === 0) return 0;

    // Extract unique module names from files_modified
    const observedModules = new Set<string>();
    for (const row of obsRows) {
      const modules = this._extractModulesFromFiles(row.files_modified);
      for (const m of modules) {
        observedModules.add(m);
      }
    }

    // Get total modules from observations (we use observation data as the universe)
    // This gives a self-referential score: what % of mentioned modules have >1 observation
    const allModules = new Set<string>();
    const allRows = this.db.prepare(`
      SELECT files_modified FROM observations
      WHERE project = ? AND files_modified IS NOT NULL AND files_modified != ''
    `).all(project) as any[];

    for (const row of allRows) {
      const modules = this._extractModulesFromFiles(row.files_modified);
      for (const m of modules) {
        allModules.add(m);
      }
    }

    // Count modules with 2+ observations
    let coveredCount = 0;
    for (const mod of allModules) {
      const count = this._countObservationsForModule(project, mod);
      if (count >= 2) coveredCount++;
    }

    if (allModules.size === 0) return 0;
    return Math.round((coveredCount / allModules.size) * 100);
  }

  /**
   * Discover top-level src/ subdirectories as "modules".
   */
  _discoverModules(projectDir: string): { name: string; path: string; fileCount: number }[] {
    const srcDir = join(projectDir, 'src');
    const modules: { name: string; path: string; fileCount: number }[] = [];

    try {
      const entries = readdirSync(srcDir);
      for (const entry of entries) {
        const fullPath = join(srcDir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            const fileCount = this._countFilesRecursive(fullPath);
            modules.push({
              name: entry,
              path: `src/${entry}/`,
              fileCount,
            });
          }
        } catch {
          // Skip inaccessible entries
        }
      }
    } catch {
      // src/ directory doesn't exist
      logger.debug('LEARNING', `No src/ directory found in ${projectDir}`);
    }

    return modules;
  }

  /**
   * Count files recursively in a directory.
   */
  _countFilesRecursive(dir: string): number {
    let count = 0;
    try {
      const entries = readdirSync(dir);
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isFile()) {
            count++;
          } else if (stat.isDirectory()) {
            count += this._countFilesRecursive(fullPath);
          }
        } catch {
          // Skip inaccessible
        }
      }
    } catch {
      // Skip inaccessible
    }
    return count;
  }

  /**
   * Count observations that reference a given module name in files_modified.
   */
  _countObservationsForModule(project: string, moduleName: string): number {
    // Match files that contain the module name as a path segment
    const pattern = `%${moduleName}%`;
    const row = this.db.prepare(`
      SELECT COUNT(*) as cnt FROM observations
      WHERE project = ? AND files_modified LIKE ?
    `).get(project, pattern) as any;
    return row?.cnt || 0;
  }

  /**
   * Extract module names from a files_modified value (JSON array or comma-separated).
   */
  _extractModulesFromFiles(filesModified: string): string[] {
    let files: string[];
    try {
      files = JSON.parse(filesModified);
    } catch {
      files = filesModified.split(',').map(f => f.trim()).filter(Boolean);
    }

    const modules = new Set<string>();
    for (const file of files) {
      // Extract the first directory component after src/
      const match = file.match(/src\/([^/]+)/);
      if (match) {
        modules.add(match[1]);
      }
    }
    return Array.from(modules);
  }
}
