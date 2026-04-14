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
  mode: 'full' | 'quick';
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
