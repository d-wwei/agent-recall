# Phase 2: Smart Retrieval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform context injection from "push recent N observations" to "L0-L3 tiered budget with project index and on-demand pull". Add temporal query parsing, preference detection, incremental bootstrap, and summary streamlining.

**Architecture:** Phase 2 refactors ContextBuilder to use a TokenBudgetManager (percentage-based allocation across 4 tiers), adds TemporalParser for natural-language date queries, extends PersonaService with completeness tracking, and creates preference synthetic documents for ChromaDB.

**Tech Stack:** TypeScript (strict), SQLite (bun:sqlite), ChromaDB (via MCP), Bun test

**Spec:** `docs/superpowers/specs/2026-04-09-agent-recall-optimization-exec.md` (Phase 2 section)

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/services/context/TokenBudgetManager.ts` | L0-L3 percentage-based token budget allocation and enforcement |
| `src/services/worker/search/TemporalParser.ts` | Natural-language time expressions → date ranges + temporal boost |
| `src/services/persona/CompletenessChecker.ts` | Profile completeness scoring + stale field detection |
| `tests/services/token-budget-manager.test.ts` | TokenBudgetManager unit tests |
| `tests/services/temporal-parser.test.ts` | TemporalParser unit tests |
| `tests/services/completeness-checker.test.ts` | CompletenessChecker unit tests |

### Modified Files

| File | Changes |
|------|---------|
| `src/services/context/ContextBuilder.ts` | Refactor to use TokenBudgetManager for section allocation |
| `src/services/context/ObservationCompiler.ts` | Add token-based limiting (not just count-based) |
| `src/services/persona/PersonaService.ts` | Add completeness check + stale detection + incremental bootstrap triggers |
| `src/services/worker/SearchManager.ts` | Integrate TemporalParser for query preprocessing |
| `src/services/worker/search/FusionRanker.ts` | Add temporal boost integration point |
| `src/services/sync/ChromaSync.ts` | Sync preference synthetic documents |
| `src/sdk/prompts.ts` | Already outputs has_preference (Phase 1); no changes needed |

---

## Batch 1: Core Infrastructure (parallel, no dependencies)

---

### Task 1: TokenBudgetManager

**Files:**
- Create: `src/services/context/TokenBudgetManager.ts`
- Create: `tests/services/token-budget-manager.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/token-budget-manager.test.ts
import { describe, test, expect } from 'bun:test';
import { TokenBudgetManager } from '../../src/services/context/TokenBudgetManager.js';

describe('TokenBudgetManager', () => {
  describe('default budget (3000 tokens)', () => {
    const mgr = new TokenBudgetManager();

    test('total budget is 3000', () => {
      expect(mgr.totalBudget).toBe(3000);
    });

    test('L0 gets 8% (~240 tokens)', () => {
      expect(mgr.getBudget('L0')).toBe(240);
    });

    test('L1 gets 15% (~450 tokens)', () => {
      expect(mgr.getBudget('L1')).toBe(450);
    });

    test('L2 gets 60% (~1800 tokens)', () => {
      expect(mgr.getBudget('L2')).toBe(1800);
    });

    test('L3 gets 17% (~510 tokens)', () => {
      expect(mgr.getBudget('L3')).toBe(510);
    });

    test('all layers sum to total budget', () => {
      const sum = mgr.getBudget('L0') + mgr.getBudget('L1') + mgr.getBudget('L2') + mgr.getBudget('L3');
      expect(sum).toBe(3000);
    });
  });

  describe('custom budget', () => {
    test('respects custom total (6000)', () => {
      const mgr = new TokenBudgetManager(6000);
      expect(mgr.getBudget('L0')).toBe(480);
      expect(mgr.getBudget('L2')).toBe(3600);
    });

    test('clamps to minimum 1500', () => {
      const mgr = new TokenBudgetManager(500);
      expect(mgr.totalBudget).toBe(1500);
    });

    test('clamps to maximum 8000', () => {
      const mgr = new TokenBudgetManager(20000);
      expect(mgr.totalBudget).toBe(8000);
    });
  });

  describe('token tracking', () => {
    test('canFit returns true when under budget', () => {
      const mgr = new TokenBudgetManager();
      expect(mgr.canFit('L0', 200)).toBe(true);
    });

    test('canFit returns false when over budget', () => {
      const mgr = new TokenBudgetManager();
      expect(mgr.canFit('L0', 500)).toBe(false);
    });

    test('consume reduces remaining budget', () => {
      const mgr = new TokenBudgetManager();
      mgr.consume('L0', 100);
      expect(mgr.remaining('L0')).toBe(140);
    });

    test('consume does not allow exceeding budget', () => {
      const mgr = new TokenBudgetManager();
      mgr.consume('L0', 240);
      expect(mgr.canFit('L0', 1)).toBe(false);
    });
  });

  describe('estimateTokens', () => {
    test('estimates ~1 token per 4 chars', () => {
      expect(TokenBudgetManager.estimateTokens('hello world')).toBe(3); // 11 chars / 4 = 2.75 → 3
    });

    test('empty string = 0 tokens', () => {
      expect(TokenBudgetManager.estimateTokens('')).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/services/token-budget-manager.test.ts`

- [ ] **Step 3: Implement TokenBudgetManager**

```typescript
// src/services/context/TokenBudgetManager.ts

export type Layer = 'L0' | 'L1' | 'L2' | 'L3';

const LAYER_PERCENTAGES: Record<Layer, number> = {
  L0: 0.08,  // persona + RECALL_PROTOCOL
  L1: 0.15,  // active task + project index + next_steps
  L2: 0.60,  // compiled knowledge + recent observations
  L3: 0.17,  // deep search results
};

const MIN_BUDGET = 1500;
const MAX_BUDGET = 8000;
const CHARS_PER_TOKEN = 4;

export class TokenBudgetManager {
  readonly totalBudget: number;
  private budgets: Record<Layer, number>;
  private consumed: Record<Layer, number>;

  constructor(totalBudget: number = 3000) {
    this.totalBudget = Math.max(MIN_BUDGET, Math.min(MAX_BUDGET, totalBudget));

    this.budgets = {} as Record<Layer, number>;
    this.consumed = { L0: 0, L1: 0, L2: 0, L3: 0 };

    // Allocate by percentage, ensure they sum exactly to totalBudget
    let allocated = 0;
    const layers: Layer[] = ['L0', 'L1', 'L2', 'L3'];
    for (let i = 0; i < layers.length - 1; i++) {
      this.budgets[layers[i]] = Math.floor(this.totalBudget * LAYER_PERCENTAGES[layers[i]]);
      allocated += this.budgets[layers[i]];
    }
    // Last layer gets the remainder to avoid rounding errors
    this.budgets.L3 = this.totalBudget - allocated;
  }

  getBudget(layer: Layer): number {
    return this.budgets[layer];
  }

  remaining(layer: Layer): number {
    return this.budgets[layer] - this.consumed[layer];
  }

  canFit(layer: Layer, tokens: number): boolean {
    return this.remaining(layer) >= tokens;
  }

  consume(layer: Layer, tokens: number): void {
    this.consumed[layer] += tokens;
  }

  static estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test tests/services/token-budget-manager.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/services/context/TokenBudgetManager.ts tests/services/token-budget-manager.test.ts
git commit -m "feat(context): add TokenBudgetManager with L0-L3 percentage allocation (3.1)"
```

---

### Task 2: Temporal Parser

**Files:**
- Create: `src/services/worker/search/TemporalParser.ts`
- Create: `tests/services/temporal-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/temporal-parser.test.ts
import { describe, test, expect } from 'bun:test';
import { TemporalParser, type TemporalResult } from '../../src/services/worker/search/TemporalParser.js';

describe('TemporalParser', () => {
  const parser = new TemporalParser();
  // Fix "now" for deterministic tests
  const now = new Date('2026-04-09T12:00:00Z');

  describe('English patterns', () => {
    test('parses "last week"', () => {
      const result = parser.parse('changes from last week', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(7);
    });

    test('parses "yesterday"', () => {
      const result = parser.parse('what happened yesterday', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(1);
    });

    test('parses "3 days ago"', () => {
      const result = parser.parse('changes from 3 days ago', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(3);
    });

    test('parses "last month"', () => {
      const result = parser.parse('what did we do last month', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(30);
    });

    test('parses "past 2 weeks"', () => {
      const result = parser.parse('recent changes in past 2 weeks', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(14);
    });
  });

  describe('Chinese patterns', () => {
    test('parses "上周"', () => {
      const result = parser.parse('上周做了什么', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(7);
    });

    test('parses "昨天"', () => {
      const result = parser.parse('昨天的改动', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(1);
    });

    test('parses "三天前"', () => {
      const result = parser.parse('三天前的决策', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(3);
    });

    test('parses "上个月"', () => {
      const result = parser.parse('上个月的进展', now);
      expect(result).not.toBeNull();
      expect(result!.windowDays).toBe(30);
    });
  });

  describe('no temporal expression', () => {
    test('returns null for non-temporal queries', () => {
      expect(parser.parse('how does auth work', now)).toBeNull();
    });
  });

  describe('temporal boost', () => {
    test('calculates boost for matching date', () => {
      const result = parser.parse('last week', now)!;
      const targetEpoch = now.getTime() - 3 * 24 * 60 * 60 * 1000; // 3 days ago
      const boost = result.calculateBoost(targetEpoch);
      expect(boost).toBeGreaterThan(0);
      expect(boost).toBeLessThanOrEqual(0.4);
    });

    test('boost is 0 for dates outside window', () => {
      const result = parser.parse('yesterday', now)!;
      const targetEpoch = now.getTime() - 30 * 24 * 60 * 60 * 1000; // 30 days ago
      const boost = result.calculateBoost(targetEpoch);
      expect(boost).toBe(0);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement TemporalParser**

```typescript
// src/services/worker/search/TemporalParser.ts

export interface TemporalResult {
  anchorDate: Date;        // center of the time window
  windowDays: number;      // width of the time window
  calculateBoost: (targetEpoch: number) => number;
}

interface TemporalPattern {
  regex: RegExp;
  windowDays: number | ((match: RegExpMatchArray) => number);
}

const CHINESE_NUMS: Record<string, number> = {
  '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5,
  '六': 6, '七': 7, '八': 8, '九': 9, '十': 10,
};

const PATTERNS: TemporalPattern[] = [
  // English
  { regex: /\byesterday\b/i, windowDays: 1 },
  { regex: /\blast\s+week\b/i, windowDays: 7 },
  { regex: /\blast\s+month\b/i, windowDays: 30 },
  { regex: /\btoday\b/i, windowDays: 1 },
  { regex: /\bthis\s+week\b/i, windowDays: 7 },
  { regex: /\brecently\b/i, windowDays: 7 },
  { regex: /(\d+)\s+days?\s+ago\b/i, windowDays: (m) => parseInt(m[1]) },
  { regex: /(\d+)\s+weeks?\s+ago\b/i, windowDays: (m) => parseInt(m[1]) * 7 },
  { regex: /(\d+)\s+months?\s+ago\b/i, windowDays: (m) => parseInt(m[1]) * 30 },
  { regex: /past\s+(\d+)\s+days?\b/i, windowDays: (m) => parseInt(m[1]) },
  { regex: /past\s+(\d+)\s+weeks?\b/i, windowDays: (m) => parseInt(m[1]) * 7 },
  // Chinese
  { regex: /昨天/, windowDays: 1 },
  { regex: /今天/, windowDays: 1 },
  { regex: /上周/, windowDays: 7 },
  { regex: /上个月/, windowDays: 30 },
  { regex: /最近/, windowDays: 7 },
  { regex: /([一二两三四五六七八九十\d]+)\s*天前/, windowDays: (m) => {
    const n = CHINESE_NUMS[m[1]] || parseInt(m[1]);
    return isNaN(n) ? 7 : n;
  }},
  { regex: /([一二两三四五六七八九十\d]+)\s*周前/, windowDays: (m) => {
    const n = CHINESE_NUMS[m[1]] || parseInt(m[1]);
    return isNaN(n) ? 7 : n * 7;
  }},
];

export class TemporalParser {
  parse(query: string, now: Date = new Date()): TemporalResult | null {
    for (const pattern of PATTERNS) {
      const match = query.match(pattern.regex);
      if (match) {
        const windowDays = typeof pattern.windowDays === 'function'
          ? pattern.windowDays(match)
          : pattern.windowDays;

        const anchorDate = new Date(now.getTime() - (windowDays / 2) * 24 * 60 * 60 * 1000);
        const windowMs = windowDays * 24 * 60 * 60 * 1000;
        const nowMs = now.getTime();

        return {
          anchorDate,
          windowDays,
          calculateBoost: (targetEpoch: number): number => {
            const daysDiff = Math.abs(nowMs - targetEpoch) / (24 * 60 * 60 * 1000);
            if (daysDiff > windowDays) return 0;
            return Math.max(0, 0.40 * (1.0 - daysDiff / windowDays));
          },
        };
      }
    }
    return null;
  }
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/search/TemporalParser.ts tests/services/temporal-parser.test.ts
git commit -m "feat(search): add temporal parser for natural-language date queries (2.2)"
```

---

### Task 3: Incremental Bootstrap — Completeness Checker

**Files:**
- Create: `src/services/persona/CompletenessChecker.ts`
- Create: `tests/services/completeness-checker.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tests/services/completeness-checker.test.ts
import { describe, test, expect } from 'bun:test';
import { CompletenessChecker, type CompletenessReport } from '../../src/services/persona/CompletenessChecker.js';
import type { MergedPersona } from '../../src/services/persona/PersonaTypes.js';

describe('CompletenessChecker', () => {
  const checker = new CompletenessChecker();

  test('empty persona returns 0% completeness', () => {
    const persona: MergedPersona = { agent_soul: null, user: null, style: null, workflow: null };
    const report = checker.check(persona);
    expect(report.percentage).toBe(0);
    expect(report.gaps.length).toBeGreaterThan(0);
  });

  test('full persona returns 100%', () => {
    const persona: MergedPersona = {
      agent_soul: { name: 'TestBot', running_environment: 'test', channels: [], self_description: 'A bot', core_values: ['help'], vibe: 'friendly', boundaries: [] },
      user: { name: 'Eli', role: 'PM', language: 'zh', timezone: 'EST', profession: 'tech', background: 'AI' },
      style: { tone: 'direct', brevity: 'concise', formatting: 'markdown', output_structure: 'structured', disliked_phrasing: [] },
      workflow: { preferred_role: 'assistant', decision_style: 'pragmatic', recurring_tasks: ['reports'], template_needs: [] },
    };
    const report = checker.check(persona);
    expect(report.percentage).toBe(100);
    expect(report.gaps).toHaveLength(0);
  });

  test('partial persona returns proportional percentage', () => {
    const persona: MergedPersona = {
      agent_soul: { name: 'Bot' } as any,
      user: { name: 'Eli', role: 'PM' } as any,
      style: null,
      workflow: null,
    };
    const report = checker.check(persona);
    expect(report.percentage).toBeGreaterThan(0);
    expect(report.percentage).toBeLessThan(100);
  });

  test('identifies specific gaps', () => {
    const persona: MergedPersona = {
      agent_soul: { name: 'Bot' } as any,
      user: null,
      style: null,
      workflow: null,
    };
    const report = checker.check(persona);
    expect(report.gaps).toContain('user');
    expect(report.gaps).toContain('style');
    expect(report.gaps).toContain('workflow');
  });

  test('stale detection marks fields older than 90 days', () => {
    const now = new Date('2026-04-09T00:00:00Z');
    const oldDate = new Date('2025-12-01T00:00:00Z'); // ~130 days ago
    const report = checker.checkStaleness(
      { user: oldDate.toISOString(), style: now.toISOString() },
      now
    );
    expect(report.staleFields).toContain('user');
    expect(report.staleFields).not.toContain('style');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement CompletenessChecker**

```typescript
// src/services/persona/CompletenessChecker.ts
import type { MergedPersona } from './PersonaTypes.js';

export interface CompletenessReport {
  percentage: number;          // 0-100
  gaps: string[];              // missing profile types
  missingFields: string[];     // specific empty fields
}

export interface StalenessReport {
  staleFields: string[];       // fields > 90 days since update
}

// Required fields per profile type
const REQUIRED_FIELDS: Record<string, string[]> = {
  agent_soul: ['name'],
  user: ['name', 'role'],
  style: ['tone'],
  workflow: ['preferred_role'],
};

// Recommended fields (contribute to percentage but not "gaps")
const RECOMMENDED_FIELDS: Record<string, string[]> = {
  agent_soul: ['self_description', 'core_values', 'vibe'],
  user: ['language', 'timezone', 'profession'],
  style: ['brevity', 'formatting', 'output_structure'],
  workflow: ['decision_style', 'recurring_tasks'],
};

const STALE_THRESHOLD_DAYS = 90;

export class CompletenessChecker {
  check(persona: MergedPersona): CompletenessReport {
    const gaps: string[] = [];
    const missingFields: string[] = [];
    let filled = 0;
    let total = 0;

    for (const [profileType, requiredFields] of Object.entries(REQUIRED_FIELDS)) {
      const profile = (persona as any)[profileType];
      if (!profile) {
        gaps.push(profileType);
        total += requiredFields.length + (RECOMMENDED_FIELDS[profileType]?.length || 0);
        continue;
      }

      for (const field of requiredFields) {
        total++;
        if (profile[field] && String(profile[field]).trim()) {
          filled++;
        } else {
          missingFields.push(`${profileType}.${field}`);
        }
      }

      for (const field of (RECOMMENDED_FIELDS[profileType] || [])) {
        total++;
        if (profile[field] && (Array.isArray(profile[field]) ? profile[field].length > 0 : String(profile[field]).trim())) {
          filled++;
        }
      }
    }

    const percentage = total === 0 ? 0 : Math.round((filled / total) * 100);
    return { percentage, gaps, missingFields };
  }

  checkStaleness(
    updatedAtMap: Record<string, string>,
    now: Date = new Date()
  ): StalenessReport {
    const staleFields: string[] = [];
    const cutoff = now.getTime() - STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    for (const [field, updatedAt] of Object.entries(updatedAtMap)) {
      if (new Date(updatedAt).getTime() < cutoff) {
        staleFields.push(field);
      }
    }

    return { staleFields };
  }
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/services/persona/CompletenessChecker.ts tests/services/completeness-checker.test.ts
git commit -m "feat(persona): add completeness checker with stale detection (0.2)"
```

---

## Batch 2: Integration (depends on Batch 1)

---

### Task 4: Integrate TokenBudgetManager into ContextBuilder

**Files:**
- Modify: `src/services/context/ContextBuilder.ts`
- Modify: `src/services/context/ObservationCompiler.ts`

- [ ] **Step 1: Import TokenBudgetManager in ContextBuilder**

In `src/services/context/ContextBuilder.ts`, add import:
```typescript
import { TokenBudgetManager } from './TokenBudgetManager.js';
```

- [ ] **Step 2: Create budget manager early in generateContext**

After loading config, create a TokenBudgetManager:
```typescript
const budgetManager = new TokenBudgetManager(config.tokenBudget || 3000);
```

- [ ] **Step 3: Enforce L0 budget for persona + RECALL_PROTOCOL**

Before rendering persona and recall protocol, check and consume budget:
```typescript
// Render persona
const personaLines = persona ? renderPersona(persona, useColors) : [];
const personaTokens = TokenBudgetManager.estimateTokens(personaLines.join('\n'));
budgetManager.consume('L0', personaTokens);

// Render RECALL_PROTOCOL
const protocolLines = renderRecallProtocol(useColors);
const protocolTokens = TokenBudgetManager.estimateTokens(protocolLines.join('\n'));
budgetManager.consume('L0', protocolTokens);
```

- [ ] **Step 4: Enforce L1 budget for active task + next_steps**

Render active task and next_steps within L1 budget:
```typescript
if (activeTask) {
  const taskLines = renderActiveTask(activeTask, useColors);
  const taskTokens = TokenBudgetManager.estimateTokens(taskLines.join('\n'));
  if (budgetManager.canFit('L1', taskTokens)) {
    output.push(...taskLines);
    budgetManager.consume('L1', taskTokens);
  }
}
```

- [ ] **Step 5: Enforce L2 budget for observations/timeline**

In the timeline rendering section, limit observations by token budget instead of just count:
```typescript
// Trim observations to fit L2 budget
const l2Budget = budgetManager.remaining('L2');
let tokenCount = 0;
const fittedObservations = observations.filter(obs => {
  const obsTokens = TokenBudgetManager.estimateTokens(
    [obs.title, obs.narrative, obs.facts?.join(', ')].filter(Boolean).join(' ')
  );
  if (tokenCount + obsTokens <= l2Budget) {
    tokenCount += obsTokens;
    return true;
  }
  return false;
});
```

- [ ] **Step 6: Run tests**

Run: `bun test`

- [ ] **Step 7: Commit**

```bash
git add src/services/context/ContextBuilder.ts src/services/context/ObservationCompiler.ts
git commit -m "feat(context): enforce L0-L3 token budgets in ContextBuilder (3.1)"
```

---

### Task 5: Integrate TemporalParser into SearchManager

**Files:**
- Modify: `src/services/worker/SearchManager.ts`
- Modify: `src/services/worker/search/FusionRanker.ts`

- [ ] **Step 1: Import and instantiate TemporalParser in SearchManager**

```typescript
import { TemporalParser } from './search/TemporalParser.js';

// In constructor or as class property:
private temporalParser: TemporalParser = new TemporalParser();
```

- [ ] **Step 2: Add temporal preprocessing before Chroma query**

In the search method, before calling Chroma:
```typescript
const temporalResult = this.temporalParser.parse(query);
if (temporalResult) {
  // Convert temporal window to dateRange filter
  const windowMs = temporalResult.windowDays * 24 * 60 * 60 * 1000;
  if (!options.dateRange) {
    options.dateRange = {
      start: new Date(Date.now() - windowMs).toISOString(),
      end: new Date().toISOString(),
    };
  }
}
```

- [ ] **Step 3: Apply temporal boost in fusion ranking**

After fusion ranking, if temporal result exists, apply boost:
```typescript
if (temporalResult && rankedResults.length > 0) {
  for (const result of rankedResults) {
    const boost = temporalResult.calculateBoost(result.createdAtEpoch);
    result.finalScore *= (1 + boost);
  }
  rankedResults.sort((a, b) => b.finalScore - a.finalScore);
}
```

- [ ] **Step 4: Run benchmark to validate**

Run: `npm run benchmark` — temporal queries should show improvement.

- [ ] **Step 5: Commit**

```bash
git add src/services/worker/SearchManager.ts
git commit -m "feat(search): integrate temporal parser for date-aware queries (2.2)"
```

---

### Task 6: Integrate CompletenessChecker into PersonaService

**Files:**
- Modify: `src/services/persona/PersonaService.ts`
- Modify: `src/services/context/ContextBuilder.ts`

- [ ] **Step 1: Add completeness check to PersonaService**

```typescript
import { CompletenessChecker, type CompletenessReport, type StalenessReport } from './CompletenessChecker.js';

// Add method:
checkCompleteness(project: string): CompletenessReport {
  const persona = this.getMergedPersona(project);
  const checker = new CompletenessChecker();
  return checker.check(persona);
}

checkStaleness(project: string): StalenessReport {
  const checker = new CompletenessChecker();
  // Get updated_at timestamps from agent_profiles
  const profiles = this.db.prepare(
    "SELECT profile_type, updated_at FROM agent_profiles WHERE scope = ? OR scope = 'global'"
  ).all(project) as { profile_type: string; updated_at: string }[];

  const updatedAtMap: Record<string, string> = {};
  for (const p of profiles) {
    updatedAtMap[p.profile_type] = p.updated_at;
  }
  return checker.checkStaleness(updatedAtMap);
}
```

- [ ] **Step 2: Add incremental bootstrap triggers in ContextBuilder**

In `generateContext`, after loading persona, check completeness:
```typescript
const personaService = new PersonaService(db.db);
const bootstrapStatus = personaService.getBootstrapStatus(project);

if (bootstrapStatus?.status === 'completed') {
  const completeness = personaService.checkCompleteness(project);
  const staleness = personaService.checkStaleness(project);

  if (completeness.percentage < 80 && completeness.gaps.length > 0) {
    // Add hint to context: "Some profile areas are incomplete"
    output.push(`\n> Note: Profile ${completeness.percentage}% complete. Missing: ${completeness.gaps.join(', ')}`);
  }

  if (staleness.staleFields.length > 0) {
    output.push(`\n> Note: Some profile fields haven't been updated in 90+ days: ${staleness.staleFields.join(', ')}`);
  }
}
```

- [ ] **Step 3: Run tests**

Run: `bun test`

- [ ] **Step 4: Commit**

```bash
git add src/services/persona/PersonaService.ts src/services/context/ContextBuilder.ts
git commit -m "feat(persona): add completeness + staleness checks with incremental bootstrap triggers (0.2)"
```

---

### Task 7: Wake-Up Summary Streamlining

**Files:**
- Modify: `src/services/context/ContextBuilder.ts`
- Modify: `src/services/context/sections/TimelineRenderer.ts`

- [ ] **Step 1: Streamline observations in L1 context**

In ContextBuilder, when rendering the timeline for the context injection, limit each observation to title + first fact only (not full narrative):

```typescript
// When building the L1-level timeline preview:
const streamlinedObs = observations.map(obs => ({
  ...obs,
  narrative: null,  // Don't include full narrative in L1
  facts: obs.facts?.slice(0, 1) || [],  // Only first fact
}));
```

Only use the full observation data when rendering L2 (on-demand deep context).

- [ ] **Step 2: Update TimelineRenderer to support streamlined mode**

Add optional `streamlined: boolean` parameter to `renderTimeline`:
```typescript
export function renderTimeline(
  timeline: TimelineItem[],
  fullObservationIds: Set<number>,
  config: ContextConfig,
  cwd: string,
  useColors: boolean,
  streamlined: boolean = false
): string[]
```

When `streamlined = true`, render each observation as a single line:
`- [{type}] {title}: {first_fact}`

Instead of the full multi-line format with narrative and all facts.

- [ ] **Step 3: Run tests**

Run: `bun test`

- [ ] **Step 4: Commit**

```bash
git add src/services/context/ContextBuilder.ts src/services/context/sections/TimelineRenderer.ts
git commit -m "feat(context): streamline wake-up summary — title+first fact in L1 (4.3)"
```

---

### Task 8: Preference Synthetic Documents

**Files:**
- Modify: `src/services/sync/ChromaSync.ts`

- [ ] **Step 1: Add preference synthetic document generation**

In ChromaSync, after syncing an observation that has `has_preference = true`, also create a synthetic document:

```typescript
// In syncObservation, after the main document sync:
if (obs.has_preference) {
  const syntheticDoc = `User preference: ${obs.narrative || obs.title}`;
  const syntheticId = `pref_${observationId}`;
  await this.addDocument(syntheticId, syntheticDoc, {
    ...baseMetadata,
    doc_type: 'preference_synthetic',
    field_type: 'preference',
  });
}
```

- [ ] **Step 2: Run tests**

Run: `bun test`

- [ ] **Step 3: Commit**

```bash
git add src/services/sync/ChromaSync.ts
git commit -m "feat(search): generate preference synthetic documents for ChromaDB (2.3)"
```

---

### Task 9: Integration Wiring + Final Test

**Files:**
- Various integration points

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Verify: All Phase 2 tests pass, no regressions.

- [ ] **Step 2: Run benchmark**

Run: `npm run benchmark`
Compare against Phase 1 baseline. Temporal queries should improve.

- [ ] **Step 3: Final commit**

```bash
git commit -m "feat(phase2): Phase 2 Smart Retrieval complete — L0-L3 budgets, temporal parsing, incremental bootstrap, preference synthesis"
```

---

## Phase 2 Summary

| Item | Task(s) | Description |
|------|---------|-------------|
| 3.1 Tiered Memory Stack | Tasks 1, 4 | TokenBudgetManager + ContextBuilder integration |
| 2.2 Temporal Parsing | Tasks 2, 5 | TemporalParser + SearchManager integration |
| 0.2 Incremental Bootstrap | Tasks 3, 6 | CompletenessChecker + PersonaService + ContextBuilder |
| 4.3 Wake-Up Streamlining | Task 7 | Title+first-fact in L1, full data in L2 |
| 2.3 Preference Synthesis | Task 8 | Synthetic docs in ChromaDB for preferences |
| Integration | Task 9 | Final verification |
