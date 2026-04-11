/**
 * Shared types for the compilation pipeline.
 *
 * The pipeline converts fragmented observations into structured knowledge pages
 * through four stages: Orient, Gather, Consolidate, Prune.
 */

import { Database } from 'bun:sqlite';

// ─── Pipeline Context ────────────────────────────────────────────────────────

/** Passed through all pipeline stages to share project scope and DB access. */
export interface CompilationContext {
  project: string;
  db: Database;
  /** Epoch ms of the last successful compilation (0 = never compiled). */
  lastCompilationEpoch: number;
}

// ─── Intermediate Types ──────────────────────────────────────────────────────

/** A group of observations sharing the same topic (concept). */
export interface TopicGroup {
  topic: string;
  observations: ObservationRow[];
}

/**
 * Minimal observation shape used within the compilation pipeline.
 * Matches the columns queried from the observations table.
 */
export interface ObservationRow {
  id: number;
  type: string;
  title: string | null;
  subtitle: string | null;
  narrative: string | null;
  facts: string | null;
  concepts: string | null;
  project: string;
  created_at_epoch: number;
}

// ─── Output Types ────────────────────────────────────────────────────────────

/** A single evidence entry linking compiled knowledge to a source observation. */
export interface EvidenceEntry {
  observationId: number;
  date: number;          // created_at_epoch
  type: string;
  title: string | null;
  summary: string;       // truncated narrative
}

/** A single compiled knowledge page ready to be written to the database. */
export interface CompiledPage {
  topic: string;
  content: string;
  sourceObservationIds: number[];
  confidence: 'high' | 'medium' | 'low';
  classification: 'status' | 'fact' | 'event';
  evidenceTimeline: EvidenceEntry[];
  /** AI-detected superseded observations (present only when AI merge ran). */
  aiSuperseded?: Array<{ oldId: number; newId: number; reason: string }>;
  /** Total tokens consumed by LLM calls for this page (present only when AI merge ran). */
  tokensUsed?: number;
}

/** Result from an AI-powered merge operation. */
export interface AIMergeResult {
  content: string;
  conflicts: Array<{ oldId: number; newId: number; description: string }>;
  superseded: Array<{ oldId: number; newId: number; reason: string }>;
  tokensUsed: number;
}

/** Summary returned after a full compilation run. */
export interface CompilationResult {
  pagesCreated: number;
  pagesUpdated: number;
  observationsProcessed: number;
  errors: string[];
  /** Total tokens consumed by LLM calls across the entire run (present only when AI merge ran). */
  tokensUsed?: number;
}
