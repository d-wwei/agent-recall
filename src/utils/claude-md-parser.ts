/**
 * claude-md-parser — Parse @ references from CLAUDE.md files
 *
 * Extracts `@path` references, resolves paths, checks existence,
 * and classifies each reference by persona profile type.
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { logger } from './logger.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ProfileCategory = 'user' | 'style' | 'workflow' | 'agent_soul' | 'unknown';

export interface ParsedReference {
  rawLine: string;
  resolvedPath: string;
  exists: boolean;
  category: ProfileCategory;
}

// ---------------------------------------------------------------------------
// Classification rules
// ---------------------------------------------------------------------------

const CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: ProfileCategory }> = [
  { pattern: /user/i, category: 'user' },
  { pattern: /style/i, category: 'style' },
  { pattern: /workflow/i, category: 'workflow' },
  { pattern: /soul|agent-core|assistant-core/i, category: 'agent_soul' },
];

function classifyByFilename(filename: string): ProfileCategory {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(filename)) return category;
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function expandTilde(p: string): string {
  if (p.startsWith('~/') || p === '~') {
    return resolve(homedir(), p.slice(2));
  }
  return p;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse @ references from raw CLAUDE.md content.
 * Lines starting with `@` (after optional whitespace) are treated as references.
 * Lines starting with `#` or that are blank are skipped.
 */
export function parseAtReferences(content: string): ParsedReference[] {
  const results: ParsedReference[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Must start with @
    if (!trimmed.startsWith('@')) continue;

    const rawPath = trimmed.slice(1).trim();
    if (!rawPath) continue;

    const resolvedPath = resolve(expandTilde(rawPath));
    const filename = resolvedPath.split('/').pop() || '';
    const exists = existsSync(resolvedPath);

    results.push({
      rawLine: trimmed,
      resolvedPath,
      exists,
      category: classifyByFilename(filename),
    });
  }

  return results;
}

/**
 * Read a CLAUDE.md file and return its parsed @ references.
 * Returns empty array if the file does not exist or is unreadable.
 */
export function resolveClaudeMdReferences(claudeMdPath: string): ParsedReference[] {
  try {
    if (!existsSync(claudeMdPath)) return [];
    const content = readFileSync(claudeMdPath, 'utf-8');
    return parseAtReferences(content);
  } catch (err) {
    logger.warn('PARSER', 'Failed to read CLAUDE.md', { path: claudeMdPath }, err as Error);
    return [];
  }
}
