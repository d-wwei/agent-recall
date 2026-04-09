/**
 * HotColdManager — data lifecycle management for observations.
 *
 * Categorizes observations by age and applies appropriate lifecycle actions:
 *   - Hot  (≤7 days):    No action. Full retention.
 *   - Warm (7-30 days):  Count for future search weight adjustment.
 *   - Cold (30+ days):   Link similar observations for future compilation merge.
 *   - Archive (90+ days): Set valid_until to expire them from active use.
 */

import { Database } from 'bun:sqlite';

export interface HotColdResult {
  hotCount: number;    // ≤7 days, unchanged
  warmCount: number;   // 7-30 days, weight reduced (marker set for future use)
  coldMerged: number;  // 30+ days, related_observations links set
  archived: number;    // 90+ days, valid_until set to now
}

// Age boundaries in milliseconds
const HOT_THRESHOLD_MS  = 7  * 24 * 60 * 60 * 1000;   //  7 days
const WARM_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
const ARCHIVE_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export type DataAge = 'hot' | 'warm' | 'cold' | 'archive';

export class HotColdManager {
  constructor(private db: Database) {}

  /**
   * Process all observations for a given project, applying lifecycle rules.
   *
   * @param project - Project name to scope the operation
   * @returns Counts per age bucket after processing
   */
  process(project: string): HotColdResult {
    const now = Date.now();

    const hotBefore    = now - HOT_THRESHOLD_MS;
    const warmBefore   = now - WARM_THRESHOLD_MS;
    const archiveBefore = now - ARCHIVE_THRESHOLD_MS;

    // ── Hot: created in the last 7 days ───────────────────────────────────────
    const hotRow = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM observations
       WHERE project = ? AND created_at_epoch > ?`
    ).get(project, hotBefore) as { cnt: number };
    const hotCount = hotRow.cnt;

    // ── Warm: 7-30 days old ───────────────────────────────────────────────────
    // For now: just count. The search_weight_modifier field doesn't exist yet,
    // but we still return the correct count so callers can act on it.
    const warmRow = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM observations
       WHERE project = ? AND created_at_epoch <= ? AND created_at_epoch > ?`
    ).get(project, hotBefore, warmBefore) as { cnt: number };
    const warmCount = warmRow.cnt;

    // ── Cold: 30-90 days old — link similar observations ───────────────────────
    // Group by first concept (same concept = related). For each group, link
    // every observation to the others by setting related_observations JSON.
    const coldObs = this.db.prepare(
      `SELECT id, concepts, related_observations FROM observations
       WHERE project = ? AND created_at_epoch <= ? AND created_at_epoch > ?
       AND (valid_until IS NULL OR valid_until = '')`
    ).all(project, warmBefore, archiveBefore) as Array<{
      id: number;
      concepts: string | null;
      related_observations: string | null;
    }>;

    const coldMerged = this._linkColdObservations(coldObs);

    // ── Archive: 90+ days old — expire from active use ────────────────────────
    const nowIso = new Date(now).toISOString();
    const archiveResult = this.db.prepare(
      `UPDATE observations
       SET valid_until = ?
       WHERE project = ? AND created_at_epoch <= ?
         AND (valid_until IS NULL OR valid_until = '')`
    ).run(nowIso, project, archiveBefore);

    const archived = archiveResult.changes;

    return { hotCount, warmCount, coldMerged, archived };
  }

  /**
   * Return the age bucket for a single observation.
   *
   * @param observationId - Primary key of the observation
   * @returns Age classification, or 'hot' if observation not found
   */
  getDataAge(observationId: number): DataAge {
    const row = this.db.prepare(
      `SELECT created_at_epoch FROM observations WHERE id = ?`
    ).get(observationId) as { created_at_epoch: number } | null;

    if (!row) return 'hot';

    const ageMs = Date.now() - row.created_at_epoch;

    if (ageMs >= ARCHIVE_THRESHOLD_MS) return 'archive';
    if (ageMs >= WARM_THRESHOLD_MS)    return 'cold';
    if (ageMs >= HOT_THRESHOLD_MS)     return 'warm';
    return 'hot';
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Group cold observations by first concept and update related_observations
   * to link observations within the same concept group.
   *
   * @returns Number of observations that received new links
   */
  private _linkColdObservations(
    rows: Array<{ id: number; concepts: string | null; related_observations: string | null }>
  ): number {
    if (rows.length === 0) return 0;

    // Group by first concept
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      let concepts: string[] = [];
      try {
        concepts = JSON.parse(row.concepts || '[]');
      } catch {
        concepts = [];
      }
      const key = concepts[0] ?? 'general';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row.id);
    }

    // Build a map of existing related_observations so we don't overwrite user data
    const existingRelated = new Map<number, number[]>();
    for (const row of rows) {
      try {
        existingRelated.set(row.id, JSON.parse(row.related_observations || '[]'));
      } catch {
        existingRelated.set(row.id, []);
      }
    }

    const stmt = this.db.prepare(
      `UPDATE observations SET related_observations = ? WHERE id = ?`
    );

    let updatedCount = 0;

    for (const [, ids] of groups) {
      if (ids.length < 2) continue; // nothing to link for singletons

      for (const id of ids) {
        const siblings = ids.filter(sibling => sibling !== id);
        const existing = existingRelated.get(id) ?? [];
        const merged = Array.from(new Set([...existing, ...siblings]));

        // Only update if the set actually changed
        if (merged.length !== existing.length || !merged.every(v => existing.includes(v))) {
          stmt.run(JSON.stringify(merged), id);
          updatedCount++;
        }
      }
    }

    return updatedCount;
  }
}
