/**
 * AssistantMigrator — migrates legacy .assistant/ directory data into Agent Recall's database.
 *
 * Migration mapping:
 *   .assistant/USER.md         → agent_profiles (scope=project, profile_type='user')
 *   .assistant/STYLE.md        → agent_profiles (scope=project, profile_type='style')
 *   .assistant/WORKFLOW.md     → agent_profiles (scope=project, profile_type='workflow')
 *   .assistant/MEMORY.md       → observations  (split by ## headings; one row per section)
 *   .assistant/memory/projects/*.md → observations (one row per file, project-tagged)
 *   .assistant/memory/daily/*.md    → SKIP (short-lived, not worth migrating)
 *   .assistant/runtime/last-session.md → session_summaries (most recent entry)
 *
 * Post-migration: renames .assistant/ → .assistant.migrated/ (archive, not delete).
 * Idempotency: if .assistant.migrated/ already exists, detect() returns false.
 */

import { Database } from 'bun:sqlite';
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  mkdirSync,
} from 'fs';
import { join, basename, extname } from 'path';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MigrationResult {
  profiles: number;
  observations: number;
  summaries: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split markdown content into sections by ## headings.
 * Returns an array of { heading, body } pairs.
 * Lines before the first ## heading are discarded.
 */
function splitByH2(content: string): Array<{ heading: string; body: string }> {
  const lines = content.split('\n');
  const sections: Array<{ heading: string; body: string }> = [];

  let currentHeading: string | null = null;
  const currentLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      // Save previous section (if any)
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
        currentLines.length = 0;
      }
      currentHeading = line.replace(/^##\s+/, '').trim();
    } else if (currentHeading !== null) {
      currentLines.push(line);
    }
    // Lines before the first ## are ignored
  }

  // Flush final section
  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentLines.join('\n').trim() });
  }

  return sections;
}

/**
 * Read a file and return its content, or null if the file does not exist.
 */
function readFileSafe(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// AssistantMigrator
// ---------------------------------------------------------------------------

export class AssistantMigrator {
  private readonly assistantDir: string;
  private readonly migratedDir: string;

  constructor(
    private readonly db: Database,
    private readonly projectDir: string
  ) {
    this.assistantDir = join(projectDir, '.assistant');
    this.migratedDir = join(projectDir, '.assistant.migrated');
  }

  /**
   * Returns true if there is data to migrate:
   *   - .assistant/ directory exists, AND
   *   - .assistant.migrated/ does NOT exist (idempotency guard).
   */
  detect(): boolean {
    if (existsSync(this.migratedDir)) return false;
    return existsSync(this.assistantDir);
  }

  /**
   * Run the full migration.
   *
   * @param project  Project name used as the scope in agent_profiles and
   *                 as the project field in observations / session_summaries.
   */
  migrate(project: string): MigrationResult {
    const result: MigrationResult = {
      profiles: 0,
      observations: 0,
      summaries: 0,
      errors: [],
    };

    // --- 1. Profile files -----------------------------------------------
    const profileFiles: Array<{ file: string; profileType: string }> = [
      { file: 'USER.md', profileType: 'user' },
      { file: 'STYLE.md', profileType: 'style' },
      { file: 'WORKFLOW.md', profileType: 'workflow' },
    ];

    for (const { file, profileType } of profileFiles) {
      const filePath = join(this.assistantDir, file);
      const content = readFileSafe(filePath);
      if (content === null) continue;

      try {
        this.upsertProfile(project, profileType, content);
        result.profiles++;
      } catch (err) {
        result.errors.push(`Failed to migrate ${file}: ${String(err)}`);
      }
    }

    // --- 2. MEMORY.md → observations (split by ## headings) -------------
    const memoryPath = join(this.assistantDir, 'MEMORY.md');
    const memoryContent = readFileSafe(memoryPath);
    if (memoryContent !== null) {
      const sections = splitByH2(memoryContent);
      for (const section of sections) {
        try {
          this.insertObservation(project, section.heading, section.body);
          result.observations++;
        } catch (err) {
          result.errors.push(`Failed to migrate MEMORY.md section "${section.heading}": ${String(err)}`);
        }
      }
    }

    // --- 3. memory/projects/*.md → observations -------------------------
    const projectsDir = join(this.assistantDir, 'memory', 'projects');
    if (existsSync(projectsDir)) {
      let files: string[] = [];
      try {
        files = readdirSync(projectsDir).filter(f => f.endsWith('.md'));
      } catch (err) {
        result.errors.push(`Failed to read memory/projects/: ${String(err)}`);
      }

      for (const fileName of files) {
        const filePath = join(projectsDir, fileName);
        const content = readFileSafe(filePath);
        if (content === null) continue;

        // Use filename without extension as the observation title
        const title = basename(fileName, extname(fileName));

        try {
          this.insertObservation(project, title, content);
          result.observations++;
        } catch (err) {
          result.errors.push(`Failed to migrate memory/projects/${fileName}: ${String(err)}`);
        }
      }
    }

    // --- 4. runtime/last-session.md → session_summaries ----------------
    const lastSessionPath = join(this.assistantDir, 'runtime', 'last-session.md');
    const lastSessionContent = readFileSafe(lastSessionPath);
    if (lastSessionContent !== null) {
      try {
        this.insertSummary(project, lastSessionContent);
        result.summaries++;
      } catch (err) {
        result.errors.push(`Failed to migrate last-session.md: ${String(err)}`);
      }
    }

    // --- 5. Archive: rename .assistant/ → .assistant.migrated/ ---------
    try {
      renameSync(this.assistantDir, this.migratedDir);
    } catch (err) {
      result.errors.push(`Failed to rename .assistant/ to .assistant.migrated/: ${String(err)}`);
    }

    return result;
  }

  // -------------------------------------------------------------------------
  // Private DB helpers
  // -------------------------------------------------------------------------

  private upsertProfile(scope: string, profileType: string, rawContent: string): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();
    const contentJson = JSON.stringify({ raw: rawContent });

    this.db.prepare(`
      INSERT INTO agent_profiles
        (scope, profile_type, content_json, created_at, created_at_epoch, updated_at, updated_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(scope, profile_type) DO UPDATE SET
        content_json = excluded.content_json,
        updated_at = excluded.updated_at,
        updated_at_epoch = excluded.updated_at_epoch
    `).run(scope, profileType, contentJson, now, nowEpoch, now, nowEpoch);
  }

  private insertObservation(project: string, title: string, narrative: string): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    this.db.prepare(`
      INSERT INTO observations
        (memory_session_id, project, type, title, subtitle, facts, narrative, concepts,
         files_read, files_modified, prompt_number, discovery_tokens, content_hash,
         created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'migrated',           // memory_session_id
      project,
      'note',               // type
      title,
      null,                 // subtitle
      '[]',                 // facts
      narrative,
      '[]',                 // concepts
      '[]',                 // files_read
      '[]',                 // files_modified
      null,                 // prompt_number
      0,                    // discovery_tokens
      null,                 // content_hash — not deduplicating migrations
      now,
      nowEpoch
    );
  }

  private insertSummary(project: string, rawContent: string): void {
    const now = new Date().toISOString();
    const nowEpoch = Date.now();

    this.db.prepare(`
      INSERT INTO session_summaries
        (memory_session_id, project, request, investigated, learned, completed,
         next_steps, notes, prompt_number, discovery_tokens, created_at, created_at_epoch)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'migrated',   // memory_session_id
      project,
      null,         // request
      null,         // investigated
      null,         // learned
      null,         // completed
      null,         // next_steps
      rawContent,   // store raw content in notes
      null,         // prompt_number
      0,            // discovery_tokens
      now,
      nowEpoch
    );
  }
}
