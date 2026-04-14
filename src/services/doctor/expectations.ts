/**
 * Expectation definitions — mirrors monitor/EXPECTATIONS.md exactly
 *
 * IDs, thresholds, severities, and weights must stay in sync with
 * the external audit script. Do NOT modify without updating EXPECTATIONS.md.
 */

import type { ExpectationDef, Severity } from './types.js';

// ---------------------------------------------------------------------------
// Severity weights (used in score calculation)
// ---------------------------------------------------------------------------

export const SEVERITY_WEIGHTS: Record<Severity, number> = {
  CRITICAL: 3,
  HIGH: 2,
  MEDIUM: 1,
  LOW: 0.5,
};

// ---------------------------------------------------------------------------
// Grade thresholds
// ---------------------------------------------------------------------------

export function gradeFromScore(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

// ---------------------------------------------------------------------------
// CRITICAL expectation IDs (used by runQuick)
// ---------------------------------------------------------------------------

export const CRITICAL_IDS = ['E-201', 'E-401', 'E-402'] as const;

// ---------------------------------------------------------------------------
// All 16 expectations
// ---------------------------------------------------------------------------

export const EXPECTATIONS: ExpectationDef[] = [
  // Category 1: Worker Service Lifecycle
  {
    id: 'E-101',
    name: 'Worker Health',
    category: 'Worker Service',
    severity: 'HIGH',
    threshold: 'Worker responds on port 37777',
  },

  // Category 2: Observation Capture
  {
    id: 'E-201',
    name: 'Observation Rate',
    category: 'Observation Capture',
    severity: 'CRITICAL',
    threshold: '>=3 observations per session',
  },
  {
    id: 'E-202',
    name: 'Observation Type Diversity',
    category: 'Observation Capture',
    severity: 'MEDIUM',
    threshold: '>=4 distinct observation types',
  },
  {
    id: 'E-203',
    name: 'Observation Quality',
    category: 'Observation Capture',
    severity: 'HIGH',
    threshold: '>=80% observations have title',
  },
  {
    id: 'E-204',
    name: 'Deduplication',
    category: 'Observation Capture',
    severity: 'MEDIUM',
    threshold: '>=95% unique content hashes',
  },

  // Category 3: Session Summaries
  {
    id: 'E-301',
    name: 'Summary Coverage',
    category: 'Session Summaries',
    severity: 'HIGH',
    threshold: '>=50% of sessions have summaries',
  },
  {
    id: 'E-302',
    name: 'Summary Structure',
    category: 'Session Summaries',
    severity: 'HIGH',
    threshold: '>=70% summaries fully structured',
  },

  // Category 4: Knowledge Compilation
  {
    id: 'E-401',
    name: 'Compilation Runs',
    category: 'Knowledge Compilation',
    severity: 'CRITICAL',
    threshold: '>0 compilation runs',
  },
  {
    id: 'E-402',
    name: 'Compiled Knowledge',
    category: 'Knowledge Compilation',
    severity: 'CRITICAL',
    threshold: '>0 knowledge pages',
  },

  // Category 5: Entity Extraction
  {
    id: 'E-601',
    name: 'Entity Extraction',
    category: 'Entity Extraction',
    severity: 'HIGH',
    threshold: '>10 entities',
  },
  {
    id: 'E-602',
    name: 'Fact Linking',
    category: 'Entity Extraction',
    severity: 'HIGH',
    threshold: '>0 facts',
  },

  // Category 6: Agent Diary
  {
    id: 'E-701',
    name: 'Diary Entries',
    category: 'Agent Diary',
    severity: 'LOW',
    threshold: '>3 diary entries',
  },

  // Category 7: Search & Retrieval
  {
    id: 'E-801',
    name: 'Vector Sync',
    category: 'Search & Retrieval',
    severity: 'HIGH',
    threshold: '>0 sync records',
  },
  {
    id: 'E-802',
    name: 'FTS Index',
    category: 'Search & Retrieval',
    severity: 'HIGH',
    threshold: 'FTS observation count > 0',
  },

  // Category 8: User Prompt Recording
  {
    id: 'E-901',
    name: 'Prompt Capture',
    category: 'User Prompts',
    severity: 'MEDIUM',
    threshold: '>0 prompts captured',
  },

  // Category 9: Error Health
  {
    id: 'E-1001',
    name: 'Error Rate',
    category: 'Error Health',
    severity: 'HIGH',
    threshold: '<=5% error rate in logs',
  },
];

/**
 * Lookup expectation by ID
 */
export function getExpectation(id: string): ExpectationDef | undefined {
  return EXPECTATIONS.find((e) => e.id === id);
}
