/**
 * MarkdownExporter - Exports database records as plain markdown files
 *
 * Writes agent_profiles, compiled_knowledge, and agent_diary entries to disk
 * as human-readable markdown files, organized by type and date.
 *
 * Output directory layout:
 *   outputDir/profile/{user,style,workflow,agent-soul}.md
 *   outputDir/knowledge/{topic}.md
 *   outputDir/knowledge/index.md
 *   outputDir/diary/YYYY-MM-DD.md
 */
import { Database } from 'bun:sqlite';
import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────
// Row types (lightweight — only what we need for export)
// ─────────────────────────────────────────────────────────

interface AgentProfileRow {
  profile_type: string;
  content_json: string;
  scope: string;
  updated_at: string | null;
}

interface CompiledKnowledgeRow {
  topic: string;
  content: string;
  confidence: string | null;
  compiled_at: string | null;
}

interface AgentDiaryRow {
  id: number;
  entry: string;
  created_at: string;
  memory_session_id: string | null;
}

// ─────────────────────────────────────────────────────────
// MarkdownExporter
// ─────────────────────────────────────────────────────────

export class MarkdownExporter {
  constructor(
    private db: Database,
    private outputDir: string
  ) {}

  /**
   * Export all profile, knowledge, and diary data for a project.
   * Returns the total number of files written.
   */
  exportAll(project: string): number {
    let count = 0;
    count += this.countWrites(() => this.exportProfiles(project));
    count += this.countWrites(() => this.exportKnowledge(project));
    count += this.countWrites(() => this.exportDiary(project));
    return count;
  }

  /**
   * Export agent_profiles → outputDir/profile/{type}.md
   *
   * Exports four standard profile types: user, style, workflow, agent-soul.
   * Tries both the given project scope and 'global' scope; project takes priority.
   */
  exportProfiles(project: string): void {
    const profileDir = path.join(this.outputDir, 'profile');
    fs.mkdirSync(profileDir, { recursive: true });

    // Fetch all profiles for this project (including global)
    const rows = this.db.prepare(
      `SELECT profile_type, content_json, scope, updated_at
       FROM agent_profiles
       WHERE scope = ? OR scope = 'global'
       ORDER BY CASE WHEN scope = ? THEN 0 ELSE 1 END`
    ).all(project, project) as AgentProfileRow[];

    // Deduplicate: project-scope overrides global for same profile_type
    const seen = new Map<string, AgentProfileRow>();
    for (const row of rows) {
      if (!seen.has(row.profile_type)) {
        seen.set(row.profile_type, row);
      }
    }

    for (const [profileType, row] of seen) {
      // Normalize profile_type to filename: 'agent_soul' → 'agent-soul'
      const filename = profileType.replace(/_/g, '-') + '.md';
      const filePath = path.join(profileDir, filename);

      let content: Record<string, any>;
      try {
        content = JSON.parse(row.content_json);
      } catch {
        content = { raw: row.content_json };
      }

      const markdown = this.renderProfileMarkdown(profileType, content, row);
      fs.writeFileSync(filePath, markdown, 'utf8');
    }
  }

  /**
   * Export compiled_knowledge → outputDir/knowledge/{topic}.md + index.md
   */
  exportKnowledge(project: string): void {
    const knowledgeDir = path.join(this.outputDir, 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });

    const rows = this.db.prepare(
      `SELECT topic, content, confidence, compiled_at
       FROM compiled_knowledge
       WHERE project = ?
       ORDER BY topic ASC`
    ).all(project) as CompiledKnowledgeRow[];

    if (rows.length === 0) return;

    const indexLines: string[] = ['# Knowledge Index\n'];

    for (const row of rows) {
      const filename = this.topicToFilename(row.topic) + '.md';
      const filePath = path.join(knowledgeDir, filename);

      const markdown = this.renderKnowledgeMarkdown(row);
      fs.writeFileSync(filePath, markdown, 'utf8');

      const confidence = row.confidence ? ` _(${row.confidence})_` : '';
      indexLines.push(`- [${row.topic}](./${filename})${confidence}`);
    }

    const indexPath = path.join(knowledgeDir, 'index.md');
    fs.writeFileSync(indexPath, indexLines.join('\n') + '\n', 'utf8');
  }

  /**
   * Export agent_diary → outputDir/diary/YYYY-MM-DD.md (grouped by date)
   */
  exportDiary(project: string): void {
    const diaryDir = path.join(this.outputDir, 'diary');
    fs.mkdirSync(diaryDir, { recursive: true });

    const rows = this.db.prepare(
      `SELECT id, entry, created_at, memory_session_id
       FROM agent_diary
       WHERE project = ?
       ORDER BY created_at ASC`
    ).all(project) as AgentDiaryRow[];

    if (rows.length === 0) return;

    // Group entries by date (YYYY-MM-DD prefix of created_at)
    const byDate = new Map<string, AgentDiaryRow[]>();
    for (const row of rows) {
      const date = this.extractDate(row.created_at);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date)!.push(row);
    }

    for (const [date, entries] of byDate) {
      const filePath = path.join(diaryDir, `${date}.md`);
      const markdown = this.renderDiaryMarkdown(date, entries);
      fs.writeFileSync(filePath, markdown, 'utf8');
    }
  }

  // ─────────────────────────────────────────────
  // Private rendering helpers
  // ─────────────────────────────────────────────

  private renderProfileMarkdown(
    profileType: string,
    content: Record<string, any>,
    row: AgentProfileRow
  ): string {
    const title = this.profileTypeTitle(profileType);
    const lines: string[] = [
      `# ${title}`,
      '',
      `> Scope: \`${row.scope}\`${row.updated_at ? `  |  Last updated: ${row.updated_at}` : ''}`,
      '',
    ];

    // Render each key as a section
    for (const [key, value] of Object.entries(content)) {
      if (value === null || value === undefined || value === '') continue;
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      if (Array.isArray(value)) {
        lines.push(`## ${label}`);
        lines.push('');
        for (const item of value) {
          lines.push(`- ${item}`);
        }
        lines.push('');
      } else {
        lines.push(`## ${label}`);
        lines.push('');
        lines.push(String(value));
        lines.push('');
      }
    }

    return lines.join('\n');
  }

  private renderKnowledgeMarkdown(row: CompiledKnowledgeRow): string {
    const lines: string[] = [
      `# ${row.topic}`,
      '',
    ];

    if (row.confidence) {
      lines.push(`> Confidence: **${row.confidence}**${row.compiled_at ? `  |  Compiled: ${row.compiled_at}` : ''}`);
      lines.push('');
    }

    lines.push(row.content);
    lines.push('');

    return lines.join('\n');
  }

  private renderDiaryMarkdown(date: string, entries: AgentDiaryRow[]): string {
    const lines: string[] = [
      `# Diary — ${date}`,
      '',
    ];

    for (const entry of entries) {
      const time = this.extractTime(entry.created_at);
      const sessionNote = entry.memory_session_id
        ? ` _(session: ${entry.memory_session_id})_`
        : '';
      lines.push(`## ${time}${sessionNote}`);
      lines.push('');
      lines.push(entry.entry);
      lines.push('');
    }

    return lines.join('\n');
  }

  // ─────────────────────────────────────────────
  // Utility helpers
  // ─────────────────────────────────────────────

  /** Count files written by an export method via stat before/after */
  private countWrites(fn: () => void): number {
    const before = this.countFilesInOutputDir();
    fn();
    const after = this.countFilesInOutputDir();
    return Math.max(0, after - before);
  }

  private countFilesInOutputDir(): number {
    try {
      return this.walkFiles(this.outputDir).length;
    } catch {
      return 0;
    }
  }

  private walkFiles(dir: string): string[] {
    const result: string[] = [];
    if (!fs.existsSync(dir)) return result;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        result.push(...this.walkFiles(full));
      } else {
        result.push(full);
      }
    }
    return result;
  }

  /** Convert a topic string to a safe filename: lowercase, spaces→hyphens */
  private topicToFilename(topic: string): string {
    return topic
      .toLowerCase()
      .replace(/[^a-z0-9\-_\s]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .substring(0, 64) || 'untitled';
  }

  /** Extract YYYY-MM-DD from an ISO or SQLite datetime string */
  private extractDate(datetime: string): string {
    if (!datetime) return 'unknown';
    // Handle "2025-12-31T23:59:59.000Z", "2025-12-31 23:59:59", "2025-12-31"
    const match = datetime.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : 'unknown';
  }

  /** Extract HH:MM from an ISO or SQLite datetime string */
  private extractTime(datetime: string): string {
    if (!datetime) return '00:00';
    const match = datetime.match(/[T ](\d{2}:\d{2})/);
    return match ? match[1] : '00:00';
  }

  /** Human-readable title for a profile type */
  private profileTypeTitle(profileType: string): string {
    const titles: Record<string, string> = {
      user: 'User Profile',
      style: 'Style Preferences',
      workflow: 'Workflow Preferences',
      agent_soul: 'Agent Soul',
    };
    return titles[profileType] ?? profileType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }
}
