/**
 * Gitignore Handler Utility
 *
 * Ensures `.assistant/` and `.agent-recall/` entries are present in
 * the project's .gitignore to prevent sensitive memory data from
 * being committed to version control.
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { logger } from './logger.js';

/** Entries to ensure are present in .gitignore */
const REQUIRED_ENTRIES = ['.assistant/', '.agent-recall/'];

/** Comment header placed before appended entries */
const COMMENT_HEADER = '# Agent Recall data';

/**
 * Walk up from `startDir` to find the nearest directory containing `.git/`.
 * Returns the git root path, or null if none found.
 */
function findGitRoot(startDir: string): string | null {
  let current = resolve(startDir);
  const root = resolve('/');

  while (current !== root) {
    if (existsSync(join(current, '.git'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root reached
    current = parent;
  }

  // Check root itself
  if (existsSync(join(current, '.git'))) {
    return current;
  }

  return null;
}

/**
 * Parse a .gitignore file and return the set of effective entries
 * (trimmed, non-empty, non-comment lines).
 */
function parseGitignoreEntries(content: string): Set<string> {
  const entries = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      entries.add(trimmed);
    }
  }
  return entries;
}

/**
 * Ensure `.assistant/` and `.agent-recall/` are listed in the project's
 * .gitignore file. This prevents sensitive memory data from being
 * accidentally committed.
 *
 * Behavior:
 * - Walks up from `cwd` to find the git root
 * - If no git root or no .gitignore exists, returns silently
 * - Appends missing entries with a comment header
 * - Never throws; logs warnings on failure
 *
 * @param cwd - The current working directory to start searching from
 */
export function ensureGitignoreEntries(cwd: string): void {
  try {
    const gitRoot = findGitRoot(cwd);
    if (!gitRoot) {
      return; // Not in a git repo
    }

    const gitignorePath = join(gitRoot, '.gitignore');
    if (!existsSync(gitignorePath)) {
      return; // No .gitignore to update
    }

    const content = readFileSync(gitignorePath, 'utf-8');
    const existingEntries = parseGitignoreEntries(content);

    const missingEntries = REQUIRED_ENTRIES.filter(
      entry => !existingEntries.has(entry)
    );

    if (missingEntries.length === 0) {
      return; // All entries already present
    }

    // Build the block to append
    const endsWithNewline = content.endsWith('\n');
    const prefix = endsWithNewline ? '\n' : '\n\n';
    const block = `${prefix}${COMMENT_HEADER}\n${missingEntries.join('\n')}\n`;

    writeFileSync(gitignorePath, content + block, 'utf-8');
    logger.info('HOOK', `Added ${missingEntries.join(', ')} to .gitignore at ${gitignorePath}`);
  } catch (error) {
    // Non-blocking: log and move on
    logger.warn('HOOK', 'Failed to update .gitignore', undefined, error);
  }
}
