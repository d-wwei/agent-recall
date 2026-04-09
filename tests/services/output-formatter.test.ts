import { describe, it, expect } from 'bun:test';
import { OutputFormatter } from '../../src/services/worker/search/OutputFormatter.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW_EPOCH = new Date('2026-04-09T12:00:00Z').getTime();
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function makeObs(overrides: Partial<{
  id: number;
  type: string;
  title: string;
  facts: string | string[];
  created_at_epoch: number;
  created_at: string;
}>): any {
  return {
    id: 1,
    type: 'decision',
    title: 'Test observation',
    facts: ['First fact', 'Second fact'],
    created_at_epoch: NOW_EPOCH,
    created_at: '2026-04-09',
    ...overrides,
  };
}

const formatter = new OutputFormatter();

// ---------------------------------------------------------------------------
// formatAsSlides
// ---------------------------------------------------------------------------

describe('OutputFormatter.formatAsSlides', () => {
  it('contains Marp front-matter header', () => {
    const result = formatter.formatAsSlides([], 'MyProject');
    expect(result).toContain('marp: true');
    expect(result).toContain('theme: default');
  });

  it('opens with YAML front-matter delimiters', () => {
    const result = formatter.formatAsSlides([], 'MyProject');
    expect(result.startsWith('---\nmarp: true')).toBe(true);
  });

  it('includes project name in title slide', () => {
    const result = formatter.formatAsSlides([], 'MyProject');
    expect(result).toContain('# MyProject — Knowledge Report');
  });

  it('produces minimal output for empty observations', () => {
    const result = formatter.formatAsSlides([], 'MyProject');
    expect(result).toContain('No observations recorded.');
    // Should still have front-matter and title
    expect(result).toContain('marp: true');
  });

  it('creates a slide per observation type group', () => {
    const obs = [
      makeObs({ type: 'decision', title: 'Decided to use Bun' }),
      makeObs({ id: 2, type: 'discovery', title: 'Found a bug' }),
    ];
    const result = formatter.formatAsSlides(obs, 'Proj');
    expect(result).toContain('## Decisions');
    expect(result).toContain('## Discoverys');
  });

  it('lists observation titles as bullet points with first fact', () => {
    const obs = [makeObs({ title: 'Use Bun', facts: ['Faster startup'] })];
    const result = formatter.formatAsSlides(obs, 'Proj');
    expect(result).toContain('- **Use Bun**: Faster startup');
  });

  it('handles observations with no facts gracefully', () => {
    const obs = [makeObs({ title: 'No-fact obs', facts: [] })];
    const result = formatter.formatAsSlides(obs, 'Proj');
    expect(result).toContain('- **No-fact obs**');
    // Should not produce an extra colon with empty fact
    expect(result).not.toContain('**No-fact obs**: \n');
  });

  it('handles facts stored as a JSON array string', () => {
    const obs = [makeObs({ title: 'JSON facts', facts: '["Fact A","Fact B"]' })];
    const result = formatter.formatAsSlides(obs, 'Proj');
    expect(result).toContain('Fact A');
  });

  it('groups multiple observations of the same type under one slide', () => {
    const obs = [
      makeObs({ id: 1, type: 'decision', title: 'Decision A' }),
      makeObs({ id: 2, type: 'decision', title: 'Decision B' }),
    ];
    const result = formatter.formatAsSlides(obs, 'Proj');
    // Only one "## Decisions" heading
    const count = (result.match(/## Decisions/g) || []).length;
    expect(count).toBe(1);
    expect(result).toContain('Decision A');
    expect(result).toContain('Decision B');
  });
});

// ---------------------------------------------------------------------------
// formatAsTimeline
// ---------------------------------------------------------------------------

describe('OutputFormatter.formatAsTimeline', () => {
  it('wraps output in <div class="timeline">', () => {
    const result = formatter.formatAsTimeline([]);
    expect(result).toContain('<div class="timeline">');
    expect(result).toContain('</div>');
  });

  it('produces minimal HTML for empty observations', () => {
    const result = formatter.formatAsTimeline([]);
    expect(result.trim()).toBe('<div class="timeline">\n</div>');
  });

  it('includes entry div for each observation', () => {
    const obs = [makeObs(), makeObs({ id: 2 })];
    const result = formatter.formatAsTimeline(obs);
    const count = (result.match(/<div class="entry">/g) || []).length;
    expect(count).toBe(2);
  });

  it('includes date span with correct format', () => {
    const obs = [makeObs({ created_at_epoch: NOW_EPOCH })];
    const result = formatter.formatAsTimeline(obs);
    expect(result).toContain('<span class="date">2026-04-09</span>');
  });

  it('includes type badge with correct class and text', () => {
    const obs = [makeObs({ type: 'decision' })];
    const result = formatter.formatAsTimeline(obs);
    expect(result).toContain('<span class="badge decision">decision</span>');
  });

  it('includes title span', () => {
    const obs = [makeObs({ title: 'My Decision' })];
    const result = formatter.formatAsTimeline(obs);
    expect(result).toContain('<span class="title">My Decision</span>');
  });

  it('includes first fact in a <p> tag', () => {
    const obs = [makeObs({ facts: ['Primary insight', 'Secondary'] })];
    const result = formatter.formatAsTimeline(obs);
    expect(result).toContain('<p>Primary insight</p>');
    expect(result).not.toContain('Secondary');
  });

  it('omits <p> tag when no facts are present', () => {
    const obs = [makeObs({ facts: [] })];
    const result = formatter.formatAsTimeline(obs);
    expect(result).not.toContain('<p>');
  });

  it('sorts entries newest first', () => {
    const older = makeObs({ id: 1, title: 'Old', created_at_epoch: NOW_EPOCH - ONE_DAY_MS * 5 });
    const newer = makeObs({ id: 2, title: 'New', created_at_epoch: NOW_EPOCH });
    const result = formatter.formatAsTimeline([older, newer]);
    const posNew = result.indexOf('New');
    const posOld = result.indexOf('Old');
    expect(posNew).toBeLessThan(posOld);
  });
});

// ---------------------------------------------------------------------------
// formatAsWeeklyReport
// ---------------------------------------------------------------------------

describe('OutputFormatter.formatAsWeeklyReport', () => {
  it('includes correct report title with project name', () => {
    const result = formatter.formatAsWeeklyReport([], 'MyProject');
    expect(result).toContain('# Weekly Report: MyProject');
  });

  it('includes period line', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toMatch(/Period: \d{4}-\d{2}-\d{2} — \d{4}-\d{2}-\d{2}/);
  });

  it('includes Summary section', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toContain('## Summary');
  });

  it('includes Decisions section', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toContain('## Decisions');
  });

  it('includes Discoverys section', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toContain('## Discoverys');
  });

  it('includes Changes section', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toContain('## Changes');
  });

  it('includes Next Steps section', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toContain('## Next Steps');
  });

  it('produces "No observations this week." for empty input', () => {
    const result = formatter.formatAsWeeklyReport([], 'Proj');
    expect(result).toContain('No observations this week.');
  });

  it('excludes observations older than 7 days', () => {
    const old = makeObs({
      id: 99,
      title: 'Ancient decision',
      created_at_epoch: Date.now() - 8 * ONE_DAY_MS,
    });
    const result = formatter.formatAsWeeklyReport([old], 'Proj');
    expect(result).not.toContain('Ancient decision');
    expect(result).toContain('No observations this week.');
  });

  it('includes observations within the last 7 days', () => {
    const recent = makeObs({
      id: 1,
      type: 'decision',
      title: 'Recent call',
      facts: ['We decided X'],
      created_at_epoch: Date.now() - 2 * ONE_DAY_MS,
    });
    const result = formatter.formatAsWeeklyReport([recent], 'Proj');
    expect(result).toContain('Recent call');
    expect(result).toContain('We decided X');
  });

  it('shows correct observation count in summary', () => {
    const obs = [
      makeObs({ id: 1, created_at_epoch: Date.now() - ONE_DAY_MS }),
      makeObs({ id: 2, created_at_epoch: Date.now() - ONE_DAY_MS }),
    ];
    const result = formatter.formatAsWeeklyReport(obs, 'Proj');
    expect(result).toContain('2 observations this week');
  });

  it('groups items under their type section', () => {
    const obs = [
      makeObs({ id: 1, type: 'discovery', title: 'Found cache bug', created_at_epoch: Date.now() - ONE_DAY_MS }),
    ];
    const result = formatter.formatAsWeeklyReport(obs, 'Proj');
    const discoveryIdx = result.indexOf('## Discoverys');
    const titleIdx = result.indexOf('Found cache bug');
    expect(discoveryIdx).toBeGreaterThanOrEqual(0);
    expect(titleIdx).toBeGreaterThan(discoveryIdx);
  });
});
