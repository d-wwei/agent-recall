/**
 * OutputFormatter - Multi-format output for observations
 *
 * Provides Marp slides, HTML timeline, and weekly report rendering
 * from arrays of observation objects.
 */

export type OutputFormat = 'markdown' | 'slides' | 'timeline' | 'weekly';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return ISO date string (YYYY-MM-DD) from an epoch number or date string.
 * Falls back to today if the value cannot be parsed.
 */
function toDateStr(value: number | string | undefined): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Extract the first fact from an observation's facts field.
 * facts may be a JSON array string, a plain string, or an array.
 */
function firstFact(obs: any): string {
  const raw = obs.facts;
  if (!raw) return '';
  if (Array.isArray(raw)) return String(raw[0] || '');
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        if (Array.isArray(arr) && arr.length > 0) return String(arr[0]);
      } catch {
        // fall through to plain string
      }
    }
    return trimmed.split('\n')[0] || trimmed;
  }
  return '';
}

/**
 * Group observations by their `type` field.
 */
function groupByType(observations: any[]): Map<string, any[]> {
  const map = new Map<string, any[]>();
  for (const obs of observations) {
    const key = String(obs.type || 'unknown');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(obs);
  }
  return map;
}

/**
 * Capitalise first character of a string.
 */
function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

/**
 * Return epoch ms from an observation (supports created_at_epoch or created_at).
 */
function epochOf(obs: any): number {
  if (typeof obs.created_at_epoch === 'number') return obs.created_at_epoch;
  if (obs.created_at) {
    const d = new Date(obs.created_at);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  return 0;
}

// ---------------------------------------------------------------------------
// OutputFormatter
// ---------------------------------------------------------------------------

export class OutputFormatter {
  // -------------------------------------------------------------------------
  // formatAsSlides — Marp-compatible markdown
  // -------------------------------------------------------------------------

  /**
   * Renders observations as a Marp presentation.
   * Each observation type group becomes its own slide.
   */
  formatAsSlides(observations: any[], project: string): string {
    const lines: string[] = [];

    // Marp front-matter
    lines.push('---');
    lines.push('marp: true');
    lines.push('theme: default');
    lines.push('---');
    lines.push('');

    // Title slide
    lines.push(`# ${project} — Knowledge Report`);
    lines.push('');

    if (observations.length === 0) {
      lines.push('---');
      lines.push('');
      lines.push('*No observations recorded.*');
      lines.push('');
      lines.push('---');
      return lines.join('\n');
    }

    const groups = groupByType(observations);

    for (const [type, items] of groups) {
      lines.push('---');
      lines.push('');
      lines.push(`## ${capitalize(type)}s`);
      lines.push('');
      for (const obs of items) {
        const title = obs.title || 'Untitled';
        const fact = firstFact(obs);
        if (fact) {
          lines.push(`- **${title}**: ${fact}`);
        } else {
          lines.push(`- **${title}**`);
        }
      }
      lines.push('');
    }

    lines.push('---');
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // formatAsTimeline — HTML timeline
  // -------------------------------------------------------------------------

  /**
   * Renders observations as an HTML timeline.
   * Entries are sorted chronologically (newest first).
   */
  formatAsTimeline(observations: any[]): string {
    const lines: string[] = [];
    lines.push('<div class="timeline">');

    if (observations.length === 0) {
      lines.push('</div>');
      return lines.join('\n');
    }

    // Sort newest first
    const sorted = [...observations].sort((a, b) => epochOf(b) - epochOf(a));

    for (const obs of sorted) {
      const dateStr = toDateStr(obs.created_at_epoch ?? obs.created_at);
      const type = String(obs.type || 'unknown');
      const title = obs.title || 'Untitled';
      const fact = firstFact(obs);

      lines.push('  <div class="entry">');
      lines.push(`    <span class="date">${dateStr}</span>`);
      lines.push(`    <span class="badge ${type}">${type}</span>`);
      lines.push(`    <span class="title">${title}</span>`);
      if (fact) {
        lines.push(`    <p>${fact}</p>`);
      }
      lines.push('  </div>');
    }

    lines.push('</div>');
    return lines.join('\n');
  }

  // -------------------------------------------------------------------------
  // formatAsWeeklyReport — Markdown weekly report
  // -------------------------------------------------------------------------

  /**
   * Renders observations from the last 7 days as a markdown weekly report.
   * Observations older than 7 days are excluded.
   */
  formatAsWeeklyReport(observations: any[], project: string): string {
    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const cutoff = now - sevenDaysMs;

    // Filter to last 7 days
    const recent = observations.filter(obs => epochOf(obs) >= cutoff);

    // Period strings
    const endDate = toDateStr(now);
    const startDate = toDateStr(cutoff);

    const lines: string[] = [];
    lines.push(`# Weekly Report: ${project}`);
    lines.push(`Period: ${startDate} — ${endDate}`);
    lines.push('');

    // Summary
    const groups = groupByType(recent);
    const typeList = Array.from(groups.keys()).join(', ');
    lines.push('## Summary');
    if (recent.length === 0) {
      lines.push('No observations this week.');
    } else {
      lines.push(
        `${recent.length} observation${recent.length === 1 ? '' : 's'} this week across ${groups.size} categor${groups.size === 1 ? 'y' : 'ies'}: ${typeList}.`
      );
    }
    lines.push('');

    // Known sections in preferred order, then any remaining types
    const ORDERED_SECTIONS = ['decision', 'discovery', 'change'];
    const renderedTypes = new Set<string>();

    const renderSection = (type: string, items: any[]) => {
      if (renderedTypes.has(type)) return;
      renderedTypes.add(type);
      lines.push(`## ${capitalize(type)}s`);
      if (items.length === 0) {
        lines.push('*None this week.*');
      } else {
        for (const obs of items) {
          const title = obs.title || 'Untitled';
          const fact = firstFact(obs);
          if (fact) {
            lines.push(`- ${title}: ${fact}`);
          } else {
            lines.push(`- ${title}`);
          }
        }
      }
      lines.push('');
    };

    for (const type of ORDERED_SECTIONS) {
      renderSection(type, groups.get(type) || []);
    }

    // Remaining types not in ORDERED_SECTIONS
    for (const [type, items] of groups) {
      if (!renderedTypes.has(type)) {
        renderSection(type, items);
      }
    }

    // Next Steps placeholder (always present)
    lines.push('## Next Steps');
    lines.push('');

    return lines.join('\n');
  }
}
