/**
 * ProjectMiner - Scans project directories for high-value files and extracts
 * them as observations into the agent-recall database.
 *
 * Responsibility:
 * - Detect known high-value files (README, CHANGELOG, docs, configs)
 * - Read file contents (skipping files > 50KB)
 * - Create one 'discovery' observation per file found
 */

import { existsSync, readFileSync, statSync } from 'fs';
import { join, basename } from 'path';
import { Database } from 'bun:sqlite';
import { storeObservation } from '../sqlite/observations/store.js';
import { logger } from '../../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MinedFile {
  path: string;
  type: 'readme' | 'changelog' | 'docs' | 'config';
  content: string;
  summary: string; // first 200 chars
}

export interface MiningResult {
  filesScanned: number;
  filesFound: number;
  observationsCreated: number;
  files: MinedFile[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE_BYTES = 50 * 1024; // 50 KB
const MAX_NARRATIVE_CHARS = 5_000;
const SUMMARY_CHARS = 200;

/**
 * Ordered list of candidate paths relative to projectDir, with their type
 * classification.
 */
const MINABLE_CANDIDATES: Array<{ rel: string; type: MinedFile['type'] }> = [
  { rel: 'README.md',               type: 'readme' },
  { rel: 'README.txt',              type: 'readme' },
  { rel: 'README',                  type: 'readme' },
  { rel: 'CHANGELOG.md',            type: 'changelog' },
  { rel: 'CHANGES.md',              type: 'changelog' },
  { rel: 'docs/README.md',          type: 'docs' },
  { rel: 'docs/architecture.md',    type: 'docs' },
  { rel: 'docs/ARCHITECTURE.md',    type: 'docs' },
  { rel: 'CLAUDE.md',               type: 'docs' },
  { rel: '.claude/CLAUDE.md',       type: 'docs' },
  { rel: 'CONTRIBUTING.md',         type: 'docs' },
  { rel: 'package.json',            type: 'config' },
  { rel: 'pyproject.toml',          type: 'config' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract a human-readable content string from package.json.
 * Returns only the name, description, and scripts fields to avoid noise.
 */
function extractPackageJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    const { name, description, scripts } = parsed;
    return JSON.stringify({ name, description, scripts }, null, 2);
  } catch {
    return raw;
  }
}

/**
 * Classify the raw content of a file, applying special extraction for
 * structured formats (package.json).
 */
function processContent(filePath: string, raw: string): string {
  if (basename(filePath) === 'package.json') {
    return extractPackageJson(raw);
  }
  return raw;
}

// ---------------------------------------------------------------------------
// ProjectMiner class
// ---------------------------------------------------------------------------

export class ProjectMiner {
  constructor(private db: Database) {}

  /**
   * Returns the list of absolute paths to minable files that exist under
   * projectDir. Preserves the canonical ordering defined in MINABLE_CANDIDATES.
   */
  getMinableFiles(projectDir: string): string[] {
    const found: string[] = [];
    for (const { rel } of MINABLE_CANDIDATES) {
      const abs = join(projectDir, rel);
      if (existsSync(abs)) {
        found.push(abs);
      }
    }
    return found;
  }

  /**
   * Scan projectDir for high-value files, read each one, and create a
   * 'discovery' observation in the database for each file found.
   *
   * @param projectDir  Absolute path to the project root
   * @param project     Project name/identifier for observation tagging
   */
  /**
   * Ensure a synthetic sdk_session row exists for the given miningSessionId.
   * The observations table has a FK -> sdk_sessions(memory_session_id), so we
   * must register the session before inserting observations.
   */
  private ensureMiningSession(miningSessionId: string, project: string): void {
    const now = new Date();
    this.db.prepare(`
      INSERT OR IGNORE INTO sdk_sessions
        (content_session_id, memory_session_id, project, user_prompt,
         started_at, started_at_epoch, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      miningSessionId,
      miningSessionId,
      project,
      'project-file-mining',
      now.toISOString(),
      now.getTime(),
      'completed'
    );
  }

  mine(projectDir: string, project: string): MiningResult {
    const minedFiles: MinedFile[] = [];
    let filesScanned = 0;
    let observationsCreated = 0;

    // Use a synthetic session ID so all mining observations are grouped together
    const miningSessionId = `mining:${project}:${Date.now()}`;

    // Register the synthetic session so the FK constraint on observations is satisfied
    this.ensureMiningSession(miningSessionId, project);

    for (const { rel, type } of MINABLE_CANDIDATES) {
      const absPath = join(projectDir, rel);

      if (!existsSync(absPath)) {
        continue;
      }

      filesScanned++;

      // Skip files that are too large
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(absPath);
      } catch (err) {
        logger.warn('MINER', `Cannot stat file, skipping: ${absPath}`, { err });
        continue;
      }

      if (stat.size > MAX_FILE_SIZE_BYTES) {
        logger.debug('MINER', `Skipping large file (${stat.size} bytes): ${absPath}`);
        continue;
      }

      // Read file content
      let raw: string;
      try {
        raw = readFileSync(absPath, 'utf-8');
      } catch (err) {
        logger.warn('MINER', `Cannot read file, skipping: ${absPath}`, { err });
        continue;
      }

      const content = processContent(absPath, raw);
      const truncatedContent = content.length > MAX_NARRATIVE_CHARS
        ? content.slice(0, MAX_NARRATIVE_CHARS)
        : content;
      const summary = content.slice(0, SUMMARY_CHARS);

      const minedFile: MinedFile = {
        path: absPath,
        type,
        content: truncatedContent,
        summary,
      };

      minedFiles.push(minedFile);

      // Create one observation per file
      const filename = basename(absPath);
      try {
        storeObservation(
          this.db,
          miningSessionId,
          project,
          {
            type: 'discovery',
            title: `Project file: ${filename}`,
            subtitle: null,
            facts: [],
            narrative: truncatedContent,
            concepts: ['project-setup', filename.toLowerCase()],
            files_read: [absPath],
            files_modified: [],
          },
          /* promptNumber */ undefined,
          /* discoveryTokens */ 0
        );
        observationsCreated++;
      } catch (err) {
        logger.warn('MINER', `Failed to store observation for ${absPath}`, { err });
      }
    }

    return {
      filesScanned,
      filesFound: minedFiles.length,
      observationsCreated,
      files: minedFiles,
    };
  }
}
