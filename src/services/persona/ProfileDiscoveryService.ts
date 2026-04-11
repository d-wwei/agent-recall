/**
 * ProfileDiscoveryService — Scan user environment for existing profile data
 *
 * Runs BEFORE bootstrap to detect existing persona information from:
 *   1. Current agent-recall DB (highest priority)
 *   2. CLAUDE.md @ references
 *   3. Well-known file paths (global-*.md, .assistant/*.md)
 *   4. ~/.claude/memory/*.md (YAML frontmatter)
 *   5. Legacy ~/.claude-mem/claude-mem.db (lowest priority)
 *
 * Read-only: never writes to the database. Returns structured results
 * for the bootstrap skill to present to the user for confirmation.
 */

import { Database } from 'bun:sqlite';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { logger } from '../../utils/logger.js';
import { parseAtReferences, resolveClaudeMdReferences } from '../../utils/claude-md-parser.js';
import type { ProfileCategory } from '../../utils/claude-md-parser.js';
import { PersonaService } from './PersonaService.js';
import { LegacyDbImporter } from './LegacyDbImporter.js';
import { CLAUDE_CONFIG_DIR, CLAUDE_MD_PATH } from '../../shared/paths.js';
import type { ProfileType } from './PersonaTypes.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface DiscoveredField {
  field: string;
  value: string | string[];
  source: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface DiscoveredProfile {
  user: DiscoveredField[];
  style: DiscoveredField[];
  workflow: DiscoveredField[];
  agent_soul: DiscoveredField[];
}

export interface DiscoveryConflict {
  field: string;
  profile_type: string;
  values: Array<{ source: string; value: string | string[] }>;
}

export interface DiscoveryResult {
  sources_scanned: string[];
  sources_found: string[];
  profiles: DiscoveredProfile;
  existing_db_profiles: {
    user: Record<string, any> | null;
    style: Record<string, any> | null;
    workflow: Record<string, any> | null;
    agent_soul: Record<string, any> | null;
  };
  conflicts: DiscoveryConflict[];
}

// ---------------------------------------------------------------------------
// Key-value mapping rules (EN + ZH)
// ---------------------------------------------------------------------------

interface FieldMapping {
  profileType: ProfileType;
  field: string;
}

const KEY_MAPPINGS: Record<string, FieldMapping> = {
  // User
  'name': { profileType: 'user', field: 'name' },
  '名字': { profileType: 'user', field: 'name' },
  '姓名': { profileType: 'user', field: 'name' },
  'role': { profileType: 'user', field: 'role' },
  '角色': { profileType: 'user', field: 'role' },
  'language': { profileType: 'user', field: 'language' },
  '语言': { profileType: 'user', field: 'language' },
  'primary language': { profileType: 'user', field: 'language' },
  'timezone': { profileType: 'user', field: 'timezone' },
  '时区': { profileType: 'user', field: 'timezone' },
  'location': { profileType: 'user', field: 'background' },
  '地点': { profileType: 'user', field: 'background' },
  'profession': { profileType: 'user', field: 'profession' },
  '职业': { profileType: 'user', field: 'profession' },
  'background': { profileType: 'user', field: 'background' },
  '背景': { profileType: 'user', field: 'background' },
  'current focus': { profileType: 'user', field: 'background' },
  'interests': { profileType: 'user', field: 'background' },

  // Style
  'tone': { profileType: 'style', field: 'tone' },
  '语气': { profileType: 'style', field: 'tone' },
  'brevity': { profileType: 'style', field: 'brevity' },
  '简洁度': { profileType: 'style', field: 'brevity' },
  'formatting': { profileType: 'style', field: 'formatting' },
  '格式': { profileType: 'style', field: 'formatting' },
  'default language': { profileType: 'style', field: 'formatting' },
  'response structure': { profileType: 'style', field: 'output_structure' },
  'output structure': { profileType: 'style', field: 'output_structure' },

  // Workflow
  'preferred role': { profileType: 'workflow', field: 'preferred_role' },
  '偏好角色': { profileType: 'workflow', field: 'preferred_role' },
  'decision style': { profileType: 'workflow', field: 'decision_style' },
  '决策风格': { profileType: 'workflow', field: 'decision_style' },

  // Agent soul
  'vibe': { profileType: 'agent_soul', field: 'vibe' },
  '风格': { profileType: 'agent_soul', field: 'vibe' },
};

// ---------------------------------------------------------------------------
// Markdown content parser
// ---------------------------------------------------------------------------

function parseMarkdownContent(
  content: string,
  expectedType: ProfileCategory | undefined,
  source: string,
  confidence: 'high' | 'medium' | 'low'
): DiscoveredField[] {
  const fields: DiscoveredField[] = [];
  const lines = content.split('\n');

  // Skip YAML frontmatter if present
  let startIdx = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        startIdx = i + 1;
        break;
      }
    }
  }

  // Collect list items under headings for recurring_tasks, high_frequency_tasks, etc.
  let currentHeading = '';
  const listItems: string[] = [];
  let collectingList = false;

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track headings
    if (trimmed.startsWith('##')) {
      // Flush previous list
      if (collectingList && listItems.length > 0) {
        const headingLower = currentHeading.toLowerCase();
        if (headingLower.includes('task') || headingLower.includes('任务') || headingLower.includes('频')) {
          fields.push({
            field: 'recurring_tasks',
            value: [...listItems],
            source,
            confidence,
          });
        }
      }
      currentHeading = trimmed.replace(/^#+\s*/, '');
      listItems.length = 0;
      collectingList = true;
      continue;
    }

    // Collect list items
    if (collectingList && trimmed.startsWith('- ')) {
      listItems.push(trimmed.slice(2).trim());
      continue;
    }

    // Key-value line matching: "Key: Value" or "- **Key**: Value"
    const kvMatch = trimmed.match(/^[-*]*\s*\*{0,2}([^:*]+?)\*{0,2}\s*[:：]\s*(.+)$/);
    if (kvMatch) {
      const key = kvMatch[1].trim().toLowerCase();
      const value = kvMatch[2].trim();
      const mapping = KEY_MAPPINGS[key];
      if (mapping) {
        fields.push({
          field: mapping.field,
          value,
          source,
          confidence,
        });
      }
    }
  }

  // Flush final list
  if (collectingList && listItems.length > 0) {
    const headingLower = currentHeading.toLowerCase();
    if (headingLower.includes('task') || headingLower.includes('任务') || headingLower.includes('频')) {
      fields.push({
        field: 'recurring_tasks',
        value: [...listItems],
        source,
        confidence,
      });
    }
  }

  // If no structured fields found and we have an expected type, store full content as background
  if (fields.length === 0 && content.trim().length > 50) {
    const bodyText = lines.slice(startIdx).join('\n').trim();
    if (expectedType === 'user') {
      fields.push({ field: 'background', value: bodyText.slice(0, 500), source, confidence: 'low' });
    } else if (expectedType === 'agent_soul') {
      fields.push({ field: 'self_description', value: bodyText.slice(0, 500), source, confidence: 'low' });
    }
  }

  return fields;
}

function categoryToProfileType(cat: ProfileCategory): ProfileType | null {
  if (cat === 'unknown') return null;
  return cat as ProfileType;
}

// ---------------------------------------------------------------------------
// ProfileDiscoveryService
// ---------------------------------------------------------------------------

export class ProfileDiscoveryService {
  private personaService: PersonaService;

  constructor(private readonly db: Database) {
    this.personaService = new PersonaService(db);
  }

  discover(): DiscoveryResult {
    const result: DiscoveryResult = {
      sources_scanned: [],
      sources_found: [],
      profiles: { user: [], style: [], workflow: [], agent_soul: [] },
      existing_db_profiles: { user: null, style: null, workflow: null, agent_soul: null },
      conflicts: [],
    };

    // Step 1: Existing DB profiles
    this.scanExistingDb(result);

    // Step 2: CLAUDE.md @ references
    const discoveredPaths = new Set<string>();
    this.scanClaudeMdReferences(result, discoveredPaths);

    // Step 3: Well-known paths
    this.scanWellKnownPaths(result, discoveredPaths);

    // Step 4: Memory directory
    this.scanMemoryDir(result, discoveredPaths);

    // Step 5: Legacy DB
    this.scanLegacyDb(result);

    // Detect conflicts
    this.detectConflicts(result);

    logger.info('DISCOVERY', `Discovery complete: ${result.sources_found.length} sources, ${this.countFields(result)} fields`, {
      scanned: result.sources_scanned.length,
      found: result.sources_found.length,
      conflicts: result.conflicts.length,
    });

    return result;
  }

  private scanExistingDb(result: DiscoveryResult): void {
    const source = 'db:agent_profiles';
    result.sources_scanned.push(source);

    for (const type of ['user', 'style', 'workflow', 'agent_soul'] as const) {
      try {
        const profile = this.personaService.getProfile('global', type);
        if (profile) {
          result.existing_db_profiles[type] = profile;
          // Extract fields
          for (const [field, value] of Object.entries(profile)) {
            if (value != null && value !== '' && field !== 'source') {
              result.profiles[type].push({
                field,
                value: value as string | string[],
                source,
                confidence: 'high',
              });
            }
          }
        }
      } catch (err) {
        logger.warn('DISCOVERY', `Failed to read DB profile: ${type}`, {}, err as Error);
      }
    }

    if (Object.values(result.existing_db_profiles).some(p => p !== null)) {
      result.sources_found.push(source);
    }
  }

  private scanClaudeMdReferences(result: DiscoveryResult, discoveredPaths: Set<string>): void {
    result.sources_scanned.push(CLAUDE_MD_PATH);

    const refs = resolveClaudeMdReferences(CLAUDE_MD_PATH);
    for (const ref of refs) {
      if (!ref.exists || ref.category === 'unknown') continue;

      discoveredPaths.add(ref.resolvedPath);
      result.sources_found.push(ref.resolvedPath);

      try {
        const content = readFileSync(ref.resolvedPath, 'utf-8');
        const profileType = categoryToProfileType(ref.category);
        if (!profileType) continue;

        const fields = parseMarkdownContent(content, ref.category, ref.resolvedPath, 'high');
        for (const field of fields) {
          result.profiles[profileType].push(field);
        }
      } catch (err) {
        logger.warn('DISCOVERY', `Failed to read referenced file`, { path: ref.resolvedPath }, err as Error);
      }
    }
  }

  private scanWellKnownPaths(result: DiscoveryResult, discoveredPaths: Set<string>): void {
    const home = homedir();
    const wellKnown: Array<{ path: string; category: ProfileCategory }> = [
      { path: join(CLAUDE_CONFIG_DIR, 'global-user.md'), category: 'user' },
      { path: join(CLAUDE_CONFIG_DIR, 'global-style.md'), category: 'style' },
      { path: join(CLAUDE_CONFIG_DIR, 'global-workflow.md'), category: 'workflow' },
      { path: join(home, '.assistant', 'USER.md'), category: 'user' },
      { path: join(home, '.assistant', 'STYLE.md'), category: 'style' },
      { path: join(home, '.assistant', 'WORKFLOW.md'), category: 'workflow' },
    ];

    for (const { path, category } of wellKnown) {
      result.sources_scanned.push(path);

      // Skip if already discovered via @ refs
      if (discoveredPaths.has(path)) continue;
      if (!existsSync(path)) continue;

      discoveredPaths.add(path);
      result.sources_found.push(path);

      try {
        const content = readFileSync(path, 'utf-8');
        const profileType = categoryToProfileType(category);
        if (!profileType) continue;

        const fields = parseMarkdownContent(content, category, path, 'medium');
        for (const field of fields) {
          result.profiles[profileType].push(field);
        }
      } catch (err) {
        logger.warn('DISCOVERY', `Failed to read well-known file`, { path }, err as Error);
      }
    }
  }

  private scanMemoryDir(result: DiscoveryResult, discoveredPaths: Set<string>): void {
    const memoryDir = join(CLAUDE_CONFIG_DIR, 'memory');
    result.sources_scanned.push(memoryDir);

    if (!existsSync(memoryDir)) return;

    try {
      const files = readdirSync(memoryDir).filter(f => extname(f) === '.md');
      for (const file of files) {
        const filePath = join(memoryDir, file);
        if (discoveredPaths.has(filePath)) continue;

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.split('\n');

        // Check for YAML frontmatter with type=user
        if (lines[0]?.trim() !== '---') continue;
        let closeIdx = -1;
        for (let i = 1; i < lines.length; i++) {
          if (lines[i].trim() === '---') { closeIdx = i; break; }
        }
        if (closeIdx === -1) continue;

        const fmLines = lines.slice(1, closeIdx);
        let fmType: string | undefined;
        for (const fmLine of fmLines) {
          const match = fmLine.match(/^type:\s*(.+)$/);
          if (match) { fmType = match[1].trim(); break; }
        }

        if (fmType !== 'user' && fmType !== 'feedback') continue;

        discoveredPaths.add(filePath);
        result.sources_found.push(filePath);

        if (fmType === 'user') {
          const body = lines.slice(closeIdx + 1).join('\n').trim();
          const fields = parseMarkdownContent(body, 'user', filePath, 'medium');
          for (const field of fields) {
            result.profiles.user.push(field);
          }
        }
      }
    } catch (err) {
      logger.warn('DISCOVERY', 'Failed to scan memory directory', { dir: memoryDir }, err as Error);
    }
  }

  private scanLegacyDb(result: DiscoveryResult): void {
    const legacyPath = join(homedir(), '.claude-mem', 'claude-mem.db');
    result.sources_scanned.push(legacyPath);

    const legacyData = LegacyDbImporter.import(legacyPath);
    if (!legacyData) return;

    result.sources_found.push(legacyPath);

    for (const [profileType, content] of Object.entries(legacyData)) {
      if (!['user', 'style', 'workflow', 'agent_soul'].includes(profileType)) continue;
      const pt = profileType as ProfileType;

      for (const [field, value] of Object.entries(content)) {
        if (value != null && value !== '' && field !== 'source' && field !== 'content') {
          result.profiles[pt].push({
            field,
            value: value as string | string[],
            source: legacyPath,
            confidence: 'low',
          });
        }
      }
    }
  }

  private detectConflicts(result: DiscoveryResult): void {
    for (const profileType of ['user', 'style', 'workflow', 'agent_soul'] as const) {
      const fields = result.profiles[profileType];
      const byField = new Map<string, DiscoveredField[]>();

      for (const f of fields) {
        const existing = byField.get(f.field) || [];
        existing.push(f);
        byField.set(f.field, existing);
      }

      for (const [field, entries] of byField) {
        if (entries.length <= 1) continue;

        // Check if values actually differ
        const uniqueValues = new Set(entries.map(e => JSON.stringify(e.value)));
        if (uniqueValues.size <= 1) continue;

        result.conflicts.push({
          field,
          profile_type: profileType,
          values: entries.map(e => ({ source: e.source, value: e.value })),
        });
      }
    }
  }

  private countFields(result: DiscoveryResult): number {
    return Object.values(result.profiles).reduce((sum, fields) => sum + fields.length, 0);
  }
}
