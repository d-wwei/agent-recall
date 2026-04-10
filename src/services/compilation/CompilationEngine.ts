/**
 * CompilationEngine — orchestrator for the 4-stage knowledge compilation pipeline.
 *
 * Pipeline:
 *   1. GateKeeper.check()   — verify compilation is allowed
 *   2. OrientStage          — load existing compiled knowledge
 *   3. GatherStage          — query + group + filter observations
 *   4. ConsolidateStage     — merge into compiled pages
 *   5. PruneStage           — write pages + update observation metadata
 *   6. GateKeeper.recordCompilationTime() — mark completion
 *
 * If GateKeeper blocks the run (e.g. too soon, feature disabled, concurrent
 * compilation), tryCompile() returns null. A non-null CompilationResult
 * indicates the pipeline ran (even if zero pages were produced).
 */

import { Database } from 'bun:sqlite';
import { GateKeeper } from './GateKeeper.js';
import { LockManager } from '../concurrency/LockManager.js';
import { OrientStage } from './stages/OrientStage.js';
import { GatherStage } from './stages/GatherStage.js';
import { ConsolidateStage } from './stages/ConsolidateStage.js';
import { PruneStage } from './stages/PruneStage.js';
import { EntityExtractor } from '../knowledge-graph/EntityExtractor.js';
import type { CompilationContext, CompilationResult } from './types.js';

export class CompilationEngine {
  private readonly gateKeeper: GateKeeper;
  private readonly orient = new OrientStage();
  private readonly gather = new GatherStage();
  private readonly consolidate = new ConsolidateStage();
  private readonly prune = new PruneStage();

  constructor(
    private readonly db: Database,
    lockManager: LockManager,
    settings: Record<string, string>
  ) {
    this.gateKeeper = new GateKeeper(db, lockManager, settings);
  }

  /**
   * Attempt a full compilation run for the given project.
   *
   * @returns CompilationResult if the pipeline ran, or null if the
   *          GateKeeper blocked execution.
   */
  async tryCompile(project: string): Promise<CompilationResult | null> {
    // 1. Gate check
    const gate = this.gateKeeper.check(project);
    this.gateKeeper.recordScanTime();

    if (!gate.canProceed) {
      return null;
    }

    try {
      const ctx: CompilationContext = {
        project,
        db: this.db,
        lastCompilationEpoch: 0, // Will use gate's internal tracking
      };

      // 2. Orient — load existing knowledge
      const existingKnowledge = this.orient.execute(ctx);

      // 3. Gather — query, filter, group observations
      const groups = this.gather.execute(ctx);

      // 3b. Entity extraction — populate knowledge graph from gathered observations
      try {
        const extractor = new EntityExtractor(this.db);
        const allObs = groups.flatMap(g => g.observations);
        for (const obs of allObs) {
          extractor.extractFromObservation(obs, project);
        }
      } catch {
        // Entity extraction is non-blocking — compilation continues on failure
      }

      if (groups.length === 0) {
        // Nothing to compile — still a successful run, just empty
        this.gateKeeper.recordCompilationTime();
        return {
          pagesCreated: 0,
          pagesUpdated: 0,
          observationsProcessed: 0,
          errors: [],
        };
      }

      // 4. Consolidate — merge into compiled pages
      const pages = this.consolidate.execute(groups, existingKnowledge, ctx);

      // 5. Prune — write to DB + update observation metadata
      const result = this.prune.execute(pages, existingKnowledge, ctx);

      // 6. Record completion
      this.gateKeeper.recordCompilationTime();

      return result;
    } catch (err) {
      // Always release the lock on failure
      this.gateKeeper.recordCompilationTime();
      throw err;
    }
  }

  // ─── Testing helpers ────────────────────────────────────────────────────────

  /** Expose GateKeeper for test-subclass time-travel. */
  get _gateKeeper(): GateKeeper {
    return this.gateKeeper;
  }
}
