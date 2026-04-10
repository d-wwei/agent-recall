/**
 * TypeScript types for database query results
 * Provides type safety for bun:sqlite query results
 */

/**
 * Schema information from sqlite3 PRAGMA table_info
 */
export interface TableColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

/**
 * Index information from sqlite3 PRAGMA index_list
 */
export interface IndexInfo {
  seq: number;
  name: string;
  unique: number;
  origin: string;
  partial: number;
}

/**
 * Table name from sqlite_master
 */
export interface TableNameRow {
  name: string;
}

/**
 * Schema version record
 */
export interface SchemaVersion {
  version: number;
}

/**
 * SDK Session database record
 */
export interface SdkSessionRecord {
  id: number;
  content_session_id: string;
  memory_session_id: string | null;
  project: string;
  user_prompt: string | null;
  started_at: string;
  started_at_epoch: number;
  completed_at: string | null;
  completed_at_epoch: number | null;
  status: 'active' | 'completed' | 'failed';
  worker_port?: number;
  prompt_counter?: number;
}

/**
 * Observation database record — unified with all 22 columns from the observations table.
 *
 * Core fields are required; enrichment fields added by later migrations are optional.
 * Phase 1 fields: confidence, tags, has_preference, event_date, last_referenced_at
 * Phase 3 fields: valid_until, superseded_by, related_observations
 */
export interface ObservationRecord {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: 'decision' | 'bugfix' | 'feature' | 'refactor' | 'discovery' | 'change';
  created_at: string;
  created_at_epoch: number;
  title?: string | null;
  subtitle?: string | null;
  facts?: string | null;           // JSON array of fact strings
  narrative?: string | null;
  concepts?: string | null;        // JSON array of concept strings
  files_read?: string | null;      // JSON array of file paths
  files_modified?: string | null;  // JSON array of file paths
  prompt_number?: number | null;
  discovery_tokens?: number;
  content_hash?: string | null;
  scope?: string;                  // 'project' | 'global', default 'project'
  // Phase 1 enrichment fields
  confidence?: string | null;      // 'high' | 'medium' | 'low'
  tags?: string | null;            // JSON array of tag strings
  has_preference?: number;         // 0 | 1
  event_date?: string | null;
  last_referenced_at?: string | null;
  // Phase 3 lifecycle fields
  valid_until?: string | null;
  superseded_by?: number | null;
  related_observations?: string | null;  // JSON array of observation IDs
}

/**
 * Session Summary database record
 */
export interface SessionSummaryRecord {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  created_at: string;
  created_at_epoch: number;
  prompt_number?: number;
  discovery_tokens?: number;
}

/**
 * User Prompt database record
 */
export interface UserPromptRecord {
  id: number;
  content_session_id: string;
  prompt_number: number;
  prompt_text: string;
  project?: string;  // From JOIN with sdk_sessions
  created_at: string;
  created_at_epoch: number;
}

/**
 * Latest user prompt with session join
 */
export interface LatestPromptResult {
  id: number;
  content_session_id: string;
  memory_session_id: string;
  project: string;
  prompt_number: number;
  prompt_text: string;
  created_at_epoch: number;
}

/**
 * Observation with context (for time-based queries).
 * Extends ObservationRecord — kept as a separate interface for backward compatibility.
 */
export interface ObservationWithContext extends ObservationRecord {
  // No additional fields — inherits all from ObservationRecord.
  // Preserves the `type: string` widening for contexts where exact type union is not enforced.
}
