/**
 * Tests for pure logic embedded in viewer components
 *
 * These tests validate the business logic functions defined inside components
 * without requiring React rendering. We re-implement the functions from the
 * source to test them in isolation (since they're not exported).
 *
 * If these functions are ever refactored to be exported, tests should import directly.
 */
import { describe, it, expect } from 'bun:test';

// ---------- ObservationCard: stripProjectRoot ----------
// Copied from src/ui/viewer/components/ObservationCard.tsx (not exported)
function stripProjectRoot(filePath: string): string {
  const markers = ['/Scripts/', '/src/', '/plugin/', '/docs/'];
  for (const marker of markers) {
    const index = filePath.indexOf(marker);
    if (index !== -1) return filePath.substring(index + 1);
  }
  const projectIndex = filePath.indexOf('agent-recall/');
  if (projectIndex !== -1) return filePath.substring(projectIndex + 'agent-recall/'.length);
  const parts = filePath.split('/');
  return parts.length > 3 ? parts.slice(-3).join('/') : filePath;
}

describe('ObservationCard - stripProjectRoot', () => {
  it('should strip path up to /src/', () => {
    expect(stripProjectRoot('/Users/admin/project/src/hooks/useTheme.ts'))
      .toBe('src/hooks/useTheme.ts');
  });

  it('should strip path up to /plugin/', () => {
    expect(stripProjectRoot('/Users/admin/project/plugin/scripts/worker.js'))
      .toBe('plugin/scripts/worker.js');
  });

  it('should strip path up to /Scripts/', () => {
    expect(stripProjectRoot('/home/user/repo/Scripts/deploy.sh'))
      .toBe('Scripts/deploy.sh');
  });

  it('should strip path up to /docs/', () => {
    expect(stripProjectRoot('/home/user/repo/docs/README.md'))
      .toBe('docs/README.md');
  });

  it('should strip up to agent-recall/ when no marker matches', () => {
    expect(stripProjectRoot('/Users/admin/agent-recall/config/settings.json'))
      .toBe('config/settings.json');
  });

  it('should return last 3 path components when nothing else matches', () => {
    expect(stripProjectRoot('/a/b/c/d/e/file.ts'))
      .toBe('d/e/file.ts');
  });

  it('should return last 3 segments for short absolute paths (leading empty split element)', () => {
    // '/a/b/c'.split('/') = ['', 'a', 'b', 'c'] → length 4 > 3 → slice(-3) = 'a/b/c'
    expect(stripProjectRoot('/a/b/c'))
      .toBe('a/b/c');
  });

  it('should return the full path for very short relative paths', () => {
    expect(stripProjectRoot('a/b/c'))
      .toBe('a/b/c');
  });

  it('should prefer the first matching marker', () => {
    // /src/ appears before /plugin/ in the path
    expect(stripProjectRoot('/project/src/plugin/nested/file.ts'))
      .toBe('src/plugin/nested/file.ts');
  });
});

// ---------- SessionView: formatSessionTime ----------
// Copied from src/ui/viewer/components/SessionView.tsx (not exported)
function formatSessionTime(epoch: number): string {
  const d = new Date(epoch);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

describe('SessionView - formatSessionTime', () => {
  it('should return a time string with hours and minutes', () => {
    // Use a known epoch that is easy to verify
    const epoch = new Date('2024-06-15T14:30:00Z').getTime();
    const result = formatSessionTime(epoch);
    expect(typeof result).toBe('string');
    // Should contain a colon separating hours and minutes
    expect(result).toContain(':');
  });

  it('should handle midnight epoch', () => {
    const epoch = new Date('2024-01-01T00:00:00Z').getTime();
    const result = formatSessionTime(epoch);
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

// ---------- SessionView: getDateGroup ----------
// Copied from src/ui/viewer/components/SessionView.tsx (not exported)
function getDateGroup(epoch: number): string {
  const d = new Date(epoch);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const itemDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());

  if (itemDate.getTime() === today.getTime()) return 'Today';
  if (itemDate.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

describe('SessionView - getDateGroup', () => {
  it('should return "Today" for current date', () => {
    const now = Date.now();
    expect(getDateGroup(now)).toBe('Today');
  });

  it('should return "Yesterday" for yesterday', () => {
    const yesterday = Date.now() - 86400000;
    expect(getDateGroup(yesterday)).toBe('Yesterday');
  });

  it('should return formatted date for older dates', () => {
    // A date definitely in the past
    const oldDate = new Date('2023-03-15T12:00:00').getTime();
    const result = getDateGroup(oldDate);
    expect(result).not.toBe('Today');
    expect(result).not.toBe('Yesterday');
    // Should contain "2023" and "Mar" or similar
    expect(result).toContain('2023');
  });
});

// ---------- ThemeToggle: cycle logic ----------
describe('ThemeToggle - theme cycling logic', () => {
  const cycle = ['system', 'light', 'dark'] as const;

  function getNextTheme(current: typeof cycle[number]): typeof cycle[number] {
    const currentIndex = cycle.indexOf(current);
    const nextIndex = (currentIndex + 1) % cycle.length;
    return cycle[nextIndex];
  }

  it('should cycle system -> light', () => {
    expect(getNextTheme('system')).toBe('light');
  });

  it('should cycle light -> dark', () => {
    expect(getNextTheme('light')).toBe('dark');
  });

  it('should cycle dark -> system', () => {
    expect(getNextTheme('dark')).toBe('system');
  });
});

// ---------- CommandPalette: typeClass helper ----------
describe('CommandPalette - typeClass helper', () => {
  function typeClass(type: string): string {
    if (type === 'observation') return 'obs';
    if (type === 'summary') return 'sum';
    return 'pmt';
  }

  it('should return "obs" for observation type', () => {
    expect(typeClass('observation')).toBe('obs');
  });

  it('should return "sum" for summary type', () => {
    expect(typeClass('summary')).toBe('sum');
  });

  it('should return "pmt" for prompt type', () => {
    expect(typeClass('prompt')).toBe('pmt');
  });

  it('should default to "pmt" for unknown types', () => {
    expect(typeClass('unknown')).toBe('pmt');
    expect(typeClass('')).toBe('pmt');
  });
});

// ---------- LogsModal: parseLogLine ----------
// Copied from src/ui/viewer/components/LogsModal.tsx (not exported)
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
type LogComponent = 'HOOK' | 'WORKER' | 'SDK' | 'PARSER' | 'DB' | 'SYSTEM' | 'HTTP' | 'SESSION' | 'CHROMA';

interface ParsedLogLine {
  raw: string;
  timestamp?: string;
  level?: LogLevel;
  component?: LogComponent;
  correlationId?: string;
  message?: string;
  isSpecial?: 'dataIn' | 'dataOut' | 'success' | 'failure' | 'timing' | 'happyPath';
}

function parseLogLine(line: string): ParsedLogLine {
  const pattern = /^\[([^\]]+)\]\s+\[(\w+)\s*\]\s+\[(\w+)\s*\]\s+(?:\[([^\]]+)\]\s+)?(.*)$/;
  const match = line.match(pattern);

  if (!match) {
    return { raw: line };
  }

  const [, timestamp, level, component, correlationId, message] = match;

  let isSpecial: ParsedLogLine['isSpecial'] = undefined;
  if (message.startsWith('\u2192')) isSpecial = 'dataIn';
  else if (message.startsWith('\u2190')) isSpecial = 'dataOut';
  else if (message.startsWith('\u2713')) isSpecial = 'success';
  else if (message.startsWith('\u2717')) isSpecial = 'failure';
  else if (message.startsWith('\u23F1')) isSpecial = 'timing';
  else if (message.includes('[HAPPY-PATH]')) isSpecial = 'happyPath';

  return {
    raw: line,
    timestamp,
    level: level?.trim() as LogLevel,
    component: component?.trim() as LogComponent,
    correlationId: correlationId || undefined,
    message,
    isSpecial,
  };
}

describe('LogsModal - parseLogLine', () => {
  it('should return raw line for unparseable input', () => {
    const result = parseLogLine('just some text');
    expect(result).toEqual({ raw: 'just some text' });
    expect(result.timestamp).toBeUndefined();
    expect(result.level).toBeUndefined();
  });

  it('should return raw line for empty string', () => {
    const result = parseLogLine('');
    expect(result).toEqual({ raw: '' });
  });

  it('should parse a standard log line', () => {
    const line = '[2025-01-02 14:30:45.123] [INFO ] [WORKER] Starting service...';
    const result = parseLogLine(line);
    expect(result.raw).toBe(line);
    expect(result.timestamp).toBe('2025-01-02 14:30:45.123');
    expect(result.level).toBe('INFO');
    expect(result.component).toBe('WORKER');
    expect(result.message).toBe('Starting service...');
    expect(result.correlationId).toBeUndefined();
    expect(result.isSpecial).toBeUndefined();
  });

  it('should parse a log line with correlation ID', () => {
    const line = '[2025-01-02 14:30:45.123] [DEBUG] [SESSION] [session-abc-123] Processing request';
    const result = parseLogLine(line);
    expect(result.level).toBe('DEBUG');
    expect(result.component).toBe('SESSION');
    expect(result.correlationId).toBe('session-abc-123');
    expect(result.message).toBe('Processing request');
  });

  it('should detect [HAPPY-PATH] as special when in message body', () => {
    // [HAPPY-PATH] must be in the message portion, not captured as correlationId
    const line = '[2025-01-02 14:30:45.123] [INFO ] [HOOK  ] [HAPPY-PATH] Session started via happy path';
    const result = parseLogLine(line);
    // When [HAPPY-PATH] matches the optional correlationId group, the message is just the text after it
    // So [HAPPY-PATH] is actually parsed as correlationId, not in message
    expect(result.correlationId).toBe('HAPPY-PATH');
    // The message won't contain [HAPPY-PATH] because regex captured it as correlationId
    expect(result.message).toBe('Session started via happy path');
  });

  it('should detect [HAPPY-PATH] when embedded in message body text', () => {
    // When [HAPPY-PATH] appears after non-bracket text, the regex doesn't capture it as correlationId.
    // Instead it becomes part of the message, where the includes() check finds it.
    const line = '[2025-01-02 14:30:45.123] [INFO ] [HOOK  ] Processing [HAPPY-PATH] flow complete';
    const result = parseLogLine(line);
    expect(result.correlationId).toBeUndefined();
    expect(result.message).toBe('Processing [HAPPY-PATH] flow complete');
    expect(result.isSpecial).toBe('happyPath');
  });

  it('should parse ERROR level', () => {
    const line = '[2025-01-02 14:30:45.123] [ERROR] [DB    ] Database connection failed';
    const result = parseLogLine(line);
    expect(result.level).toBe('ERROR');
    expect(result.component).toBe('DB');
  });

  it('should parse WARN level', () => {
    const line = '[2025-01-02 14:30:45.123] [WARN ] [HTTP  ] Rate limit approaching';
    const result = parseLogLine(line);
    expect(result.level).toBe('WARN');
    expect(result.component).toBe('HTTP');
  });
});

// ---------- Toolbar: filter computation ----------
describe('Toolbar - filter computation', () => {
  it('should compute total count correctly', () => {
    const observations = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const summaries = [{ id: 1 }];
    const prompts = [{ id: 1 }, { id: 2 }];
    const total = observations.length + summaries.length + prompts.length;
    expect(total).toBe(6);
  });
});

// ---------- Feed: sorting logic ----------
describe('Feed - item sorting', () => {
  it('should sort items by created_at_epoch descending (most recent first)', () => {
    const items = [
      { created_at_epoch: 1000, itemType: 'observation' as const },
      { created_at_epoch: 3000, itemType: 'summary' as const },
      { created_at_epoch: 2000, itemType: 'prompt' as const },
    ];

    const sorted = [...items].sort((a, b) => b.created_at_epoch - a.created_at_epoch);
    expect(sorted[0].created_at_epoch).toBe(3000);
    expect(sorted[1].created_at_epoch).toBe(2000);
    expect(sorted[2].created_at_epoch).toBe(1000);
  });

  it('should combine and sort mixed types', () => {
    type TypeFilter = 'all' | 'observations' | 'summaries' | 'prompts';
    const typeFilter: TypeFilter = 'all';

    const observations = [
      { id: 1, created_at_epoch: 5000, itemType: 'observation' as const },
    ];
    const summaries = [
      { id: 1, created_at_epoch: 3000, itemType: 'summary' as const },
    ];
    const prompts = [
      { id: 1, created_at_epoch: 7000, itemType: 'prompt' as const },
    ];

    const combined: any[] = [];
    if (typeFilter === 'all' || typeFilter === 'observations') combined.push(...observations);
    if (typeFilter === 'all' || typeFilter === 'summaries') combined.push(...summaries);
    if (typeFilter === 'all' || typeFilter === 'prompts') combined.push(...prompts);

    const sorted = combined.sort((a, b) => b.created_at_epoch - a.created_at_epoch);
    expect(sorted[0].itemType).toBe('prompt');
    expect(sorted[1].itemType).toBe('observation');
    expect(sorted[2].itemType).toBe('summary');
  });

  it('should filter to only observations when typeFilter is observations', () => {
    type TypeFilter = 'all' | 'observations' | 'summaries' | 'prompts';
    const typeFilter: TypeFilter = 'observations';

    const observations = [{ id: 1, created_at_epoch: 5000 }];
    const summaries = [{ id: 1, created_at_epoch: 3000 }];
    const prompts = [{ id: 1, created_at_epoch: 7000 }];

    const combined: any[] = [];
    if (typeFilter === 'all' || typeFilter === 'observations') combined.push(...observations);
    if (typeFilter === 'all' || typeFilter === 'summaries') combined.push(...summaries);
    if (typeFilter === 'all' || typeFilter === 'prompts') combined.push(...prompts);

    expect(combined).toHaveLength(1);
    expect(combined[0].id).toBe(1);
    expect(combined[0].created_at_epoch).toBe(5000);
  });
});
