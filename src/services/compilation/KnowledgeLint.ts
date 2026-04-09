/**
 * KnowledgeLint — post-compilation quality pass for knowledge hygiene.
 *
 * Runs four checks on observations and compiled_knowledge for a project:
 *   1. Contradiction detection — two observations sharing a modified file but
 *      with conflicting types (bugfix vs feature) within 7 days.
 *   2. Staleness marking — observations older than 30 days with no recent
 *      reference get their valid_until set to NOW (effectively expired).
 *   3. Orphan detection — observations older than 90 days with no
 *      last_referenced_at are flagged for review.
 *   4. Low-confidence audit — any observation with confidence = 'low' is
 *      flagged for human review.
 *
 * Protected compiled_knowledge entries (protected = 1) are never touched.
 */

import { Database } from 'bun:sqlite';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface LintWarning {
  type: 'contradiction' | 'stale' | 'orphan' | 'low_confidence';
  observationId?: number;
  compiledPageId?: number;
  description: string;
}

export interface LintResult {
  warnings: LintWarning[];
  actionsApplied: number;
}

// ─── Internal row shapes ──────────────────────────────────────────────────────

interface ObsRow {
  id: number;
  type: string;
  files_modified: string | null;
  created_at_epoch: number;
  last_referenced_at: string | null;
}

// ─── Implementation ───────────────────────────────────────────────────────────

export class KnowledgeLint {
  constructor(private db: Database) {}

  /**
   * Run all lint checks for the given project.
   *
   * @param project - Project scope for all queries
   * @returns LintResult with accumulated warnings and count of DB mutations
   */
  run(project: string): LintResult {
    const warnings: LintWarning[] = [];
    let actionsApplied = 0;

    // 1. Contradiction detection
    warnings.push(...this.detectContradictions(project));

    // 2. Staleness marking — mutates rows; returns count of rows updated
    actionsApplied += this.markStale(project);

    // 3. Orphan detection
    warnings.push(...this.detectOrphans(project));

    // 4. Low-confidence audit
    warnings.push(...this.auditLowConfidence(project));

    return { warnings, actionsApplied };
  }

  // ─── Private checks ────────────────────────────────────────────────────────

  /**
   * Contradiction detection.
   *
   * Heuristic: two observations for the same project that both list the same
   * file in files_modified, whose types are in the conflicting pair
   * {bugfix, feature}, and which were created within 7 days of each other.
   *
   * Only unprotected observations are considered; we skip any whose
   * compiled_knowledge entry is protected (checked indirectly — we only
   * read the observations table here; the protection check is relevant for
   * staleness mutation, not for warning generation).
   */
  private detectContradictions(project: string): LintWarning[] {
    const warnings: LintWarning[] = [];

    let rows: ObsRow[];
    try {
      rows = this.db
        .prepare(
          `SELECT id, type, files_modified, created_at_epoch, last_referenced_at
           FROM observations
           WHERE project = ?
             AND files_modified IS NOT NULL
             AND type IN ('bugfix', 'feature')
           ORDER BY created_at_epoch ASC`
        )
        .all(project) as ObsRow[];
    } catch {
      // observations table may not exist in older schemas — skip silently.
      return warnings;
    }

    if (rows.length < 2) return warnings;

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // Build a map: file → list of {id, type, epoch}
    const fileMap = new Map<string, Array<{ id: number; type: string; epoch: number }>>();

    for (const row of rows) {
      const files = this.parseJsonArray(row.files_modified);
      for (const file of files) {
        if (!fileMap.has(file)) fileMap.set(file, []);
        fileMap.get(file)!.push({ id: row.id, type: row.type, epoch: row.created_at_epoch });
      }
    }

    // For each file, look for a bugfix+feature pair within 7 days
    for (const [file, entries] of fileMap) {
      const bugfixes = entries.filter(e => e.type === 'bugfix');
      const features = entries.filter(e => e.type === 'feature');

      for (const bf of bugfixes) {
        for (const ft of features) {
          const delta = Math.abs(bf.epoch - ft.epoch);
          if (delta <= sevenDaysMs) {
            warnings.push({
              type: 'contradiction',
              observationId: bf.id,
              description:
                `Contradicting observations on file "${file}": ` +
                `obs #${bf.id} (bugfix) and obs #${ft.id} (feature) within 7 days`,
            });
            // One warning per file is enough — avoid combinatorial explosion
            break;
          }
        }
      }
    }

    return warnings;
  }

  /**
   * Staleness marking.
   *
   * Observations where:
   *   - created_at_epoch < NOW - 30 days, AND
   *   - last_referenced_at IS NULL OR last_referenced_at epoch < NOW - 30 days
   *
   * Get valid_until set to the current ISO timestamp, effectively expiring
   * them from active use.
   *
   * Protected compiled_knowledge pages are never touched, but observations
   * themselves don't have a protected flag — the protection is on the
   * compiled_knowledge side.  Observations with valid_until already set are
   * skipped (idempotent).
   *
   * @returns Number of rows updated.
   */
  private markStale(project: string): number {
    const now = Date.now();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const cutoffEpoch = now - thirtyDaysMs;
    const cutoffIso = new Date(cutoffEpoch).toISOString();
    const nowIso = new Date(now).toISOString();

    try {
      const result = this.db
        .prepare(
          `UPDATE observations
           SET valid_until = ?
           WHERE project = ?
             AND created_at_epoch < ?
             AND valid_until IS NULL
             AND (
               last_referenced_at IS NULL
               OR datetime(last_referenced_at) < datetime(?)
             )`
        )
        .run(nowIso, project, cutoffEpoch, cutoffIso);

      return (result.changes as number) ?? 0;
    } catch {
      // valid_until column may not exist in older schemas — skip.
      return 0;
    }
  }

  /**
   * Orphan detection.
   *
   * Observations older than 90 days with last_referenced_at IS NULL are
   * flagged.  We do NOT delete them — only warn.
   */
  private detectOrphans(project: string): LintWarning[] {
    const warnings: LintWarning[] = [];

    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const cutoffEpoch = Date.now() - ninetyDaysMs;

    let rows: Array<{ id: number }>;
    try {
      rows = this.db
        .prepare(
          `SELECT id FROM observations
           WHERE project = ?
             AND created_at_epoch < ?
             AND last_referenced_at IS NULL`
        )
        .all(project, cutoffEpoch) as Array<{ id: number }>;
    } catch {
      return warnings;
    }

    for (const row of rows) {
      warnings.push({
        type: 'orphan',
        observationId: row.id,
        description: `Observation #${row.id} is older than 90 days and has never been referenced`,
      });
    }

    return warnings;
  }

  /**
   * Low-confidence audit.
   *
   * Any observation with confidence = 'low' is added to warnings for human
   * review.  No mutations are performed.
   */
  private auditLowConfidence(project: string): LintWarning[] {
    const warnings: LintWarning[] = [];

    let rows: Array<{ id: number }>;
    try {
      rows = this.db
        .prepare(
          `SELECT id FROM observations
           WHERE project = ?
             AND confidence = 'low'`
        )
        .all(project) as Array<{ id: number }>;
    } catch {
      return warnings;
    }

    for (const row of rows) {
      warnings.push({
        type: 'low_confidence',
        observationId: row.id,
        description: `Observation #${row.id} has low confidence and should be reviewed`,
      });
    }

    return warnings;
  }

  // ─── Utilities ─────────────────────────────────────────────────────────────

  /** Safely parse a JSON string array; returns [] on any parse failure. */
  private parseJsonArray(raw: string | null): string[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : [];
    } catch {
      return [];
    }
  }
}
