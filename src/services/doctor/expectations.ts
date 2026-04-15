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
// All 21 expectations
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
  {
    id: 'E-103',
    name: 'Active Session Accumulation',
    category: 'Worker Service',
    severity: 'MEDIUM',
    threshold: 'PASS <= 5; WARN <= 15; FAIL > 15',
  },
  {
    id: 'E-104',
    name: 'Session Completed At',
    category: 'Worker Service',
    severity: 'HIGH',
    threshold: 'PASS >= 80%; WARN >= 50%; FAIL < 50%',
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
  {
    id: 'E-205',
    name: 'Facts/Concepts Coverage',
    category: 'Observation Capture',
    severity: 'MEDIUM',
    threshold: 'PASS >= 50%; WARN >= 30%; FAIL < 30%',
  },

  // Category 3: Session Summaries
  {
    id: 'E-301',
    name: 'Summary Coverage',
    category: 'Session Summaries',
    severity: 'HIGH',
    threshold: '>=50% total AND >=70% recent 7d completed; fallback to total if no recent sessions',
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
    threshold: '>0 total AND ran in last 7 days; WARN if >0 but stale',
  },
  {
    id: 'E-402',
    name: 'Compiled Knowledge',
    category: 'Knowledge Compilation',
    severity: 'CRITICAL',
    threshold: '>0 total AND new/updated pages in last 7 days; WARN if stale',
  },
  {
    id: 'E-403',
    name: 'Knowledge Page Updates',
    category: 'Knowledge Compilation',
    severity: 'MEDIUM',
    threshold: 'PASS >= 10%; WARN > 0%; FAIL = 0%',
  },

  // Category 5: Entity Extraction
  {
    id: 'E-601',
    name: 'Entity Extraction',
    category: 'Entity Extraction',
    severity: 'HIGH',
    threshold: '>10 total AND new entities in last 7 days; WARN if stale',
  },
  {
    id: 'E-602',
    name: 'Fact Density',
    category: 'Entity Extraction',
    severity: 'HIGH',
    threshold: 'PASS >= 2.0 facts/entity; WARN >= 1.0; FAIL < 1.0',
  },

  // Category 6: Agent Diary
  {
    id: 'E-701',
    name: 'Diary Entries',
    category: 'Agent Diary',
    severity: 'LOW',
    threshold: '>3 total AND >=2 active days in last 7 days; WARN if stale',
  },

  // Category 7: Search & Retrieval
  {
    id: 'E-801',
    name: 'Vector Sync',
    category: 'Search & Retrieval',
    severity: 'HIGH',
    threshold: '>=50% coverage; WARN >=10%; FAIL <10% or 0',
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
    threshold: '<=2% PASS, 2-5% WARN, >5% FAIL',
  },
  {
    id: 'E-1002',
    name: 'Trend Degradation',
    category: 'Error Health',
    severity: 'HIGH',
    threshold: 'PASS no decline; WARN 1 metric declining 3x; FAIL 2+ declining',
  },
];

/**
 * Lookup expectation by ID
 */
export function getExpectation(id: string): ExpectationDef | undefined {
  return EXPECTATIONS.find((e) => e.id === id);
}
