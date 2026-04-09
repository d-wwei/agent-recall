/**
 * TokenBudgetManager - L0–L3 layered token budget allocation
 *
 * Manages a total token budget across four context layers with fixed
 * percentage allocations. The last layer (L3) absorbs rounding remainder
 * so the sum always equals exactly totalBudget.
 *
 * Layer allocations:
 *   L0  8%  — persona + RECALL_PROTOCOL
 *   L1 15%  — active task + project index + next_steps
 *   L2 60%  — compiled knowledge + observations
 *   L3 17%  — deep search results
 */

export type Layer = 'L0' | 'L1' | 'L2' | 'L3';

const LAYER_PERCENTAGES: Record<Layer, number> = {
  L0: 0.08,
  L1: 0.15,
  L2: 0.60,
  L3: 0.17,
};

const LAYER_ORDER: Layer[] = ['L0', 'L1', 'L2', 'L3'];

const DEFAULT_BUDGET = 3000;
const MIN_BUDGET = 1500;
const MAX_BUDGET = 8000;

export class TokenBudgetManager {
  readonly totalBudget: number;

  private readonly allocations: Record<Layer, number>;
  private readonly consumed: Record<Layer, number>;

  constructor(totalBudget: number = DEFAULT_BUDGET) {
    this.totalBudget = Math.min(Math.max(totalBudget, MIN_BUDGET), MAX_BUDGET);

    // Compute allocations: floor for first 3 layers, remainder for last
    const allocations = {} as Record<Layer, number>;
    let allocated = 0;

    for (let i = 0; i < LAYER_ORDER.length - 1; i++) {
      const layer = LAYER_ORDER[i];
      allocations[layer] = Math.floor(this.totalBudget * LAYER_PERCENTAGES[layer]);
      allocated += allocations[layer];
    }

    // Last layer gets the exact remainder so sum == totalBudget
    const lastLayer = LAYER_ORDER[LAYER_ORDER.length - 1];
    allocations[lastLayer] = this.totalBudget - allocated;

    this.allocations = allocations;
    this.consumed = { L0: 0, L1: 0, L2: 0, L3: 0 };
  }

  /**
   * Returns the token budget allocated to a layer.
   */
  getBudget(layer: Layer): number {
    return this.allocations[layer];
  }

  /**
   * Returns tokens remaining in a layer (budget minus consumed).
   */
  remaining(layer: Layer): number {
    return this.allocations[layer] - this.consumed[layer];
  }

  /**
   * Returns true if the given number of tokens fits within the layer's
   * remaining budget.
   */
  canFit(layer: Layer, tokens: number): boolean {
    return tokens <= this.remaining(layer);
  }

  /**
   * Records consumption of tokens from a layer.
   * Does not enforce the budget limit — callers should check canFit first.
   */
  consume(layer: Layer, tokens: number): void {
    this.consumed[layer] += tokens;
  }

  /**
   * Rough token estimation: ceil(text.length / 4).
   * Empty or whitespace-only strings return 0.
   */
  static estimateTokens(text: string): number {
    if (!text || text.length === 0) return 0;
    return Math.ceil(text.length / 4);
  }
}
