/**
 * Doctor Module — Type definitions for health audit reports
 */

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type Score = 'PASS' | 'WARN' | 'FAIL' | 'INFO';
export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface ExpectationDef {
  id: string;
  name: string;
  category: string;
  severity: Severity;
  threshold: string;
}

export interface ExpectationResult {
  id: string;
  score: Score;
  result: string;
  value: number | string | null;
  severity: Severity;
}

export interface DoctorReport {
  score: number;
  grade: Grade;
  mode: 'full' | 'quick' | 'deep';
  results: Record<string, ExpectationResult>;
  critical_failures: string[];
  recommendations: string[];
  created_at: string;
}

export interface DoctorHistoryEntry {
  id: number;
  score: number;
  grade: Grade;
  mode: string;
  critical_failures: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// Deep analysis types
// ---------------------------------------------------------------------------

export interface DeepReport extends DoctorReport {
  mode: 'deep';
  daily_breakdown: DailyBreakdown[];
  session_status: SessionStatusBreakdown;
  obs_per_session: ObsPerSessionEntry[];
  observation_quality: ObservationQuality;
  summary_quality: SummaryQuality;
  log_analysis: LogAnalysis;
}

export interface DailyBreakdown {
  date: string;
  observations: number;
  sessions: number;
  summaries: number;
  prompts: number;
}

export interface SessionStatusBreakdown {
  completed: number;
  interrupted: number;
  failed: number;
  active: number;
}

export interface ObsPerSessionEntry {
  obs_count: number;
  session_count: number;
}

export interface ObservationQuality {
  total: number;
  has_title: number;
  has_narrative: number;
  has_facts: number;
  has_concepts: number;
  unique_hashes: number;
  type_distribution: Array<{ type: string; count: number }>;
}

export interface SummaryQuality {
  total: number;
  has_request: number;
  has_next_steps: number;
  has_learned: number;
  has_completed: number;
  fully_structured: number;
}

export interface LogAnalysis {
  total_lines: number;
  errors: number;
  warnings: number;
  session_starts: number;
  extraction_events: number;
  context_events: number;
  compilation_events: number;
  top_error_patterns: Array<{ pattern: string; count: number }>;
}
