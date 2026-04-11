/**
 * SearchExplainer - Provides transparency into why a search result was returned
 *
 * Given a query and a result document, produces an ExplainedResult that describes
 * the match type, matched keywords, score, and which search source contributed.
 */

export interface ExplainedResult {
  id: number;
  matchScore: number;       // 0-1
  matchType: 'semantic' | 'keyword' | 'hybrid';
  matchedKeywords: string[];  // keywords from query found in result text
  source: string;             // 'vector' | 'fts5' | 'both'
}

export class SearchExplainer {
  /**
   * Explain why a search result matched a given query.
   *
   * @param query       - The original search query string
   * @param result      - The search result document (any shape; title/narrative/facts are inspected)
   * @param vectorScore - Score from vector search (0-1), if available
   * @param ftsScore    - Score from SQLite FTS5, if available (treat as 0-1; higher = better)
   */
  explain(
    query: string,
    result: any,
    vectorScore?: number,
    ftsScore?: number
  ): ExplainedResult {
    const hasVector = vectorScore !== undefined && vectorScore !== null;
    const hasFts = ftsScore !== undefined && ftsScore !== null;

    // Determine match type
    let matchType: ExplainedResult['matchType'];
    if (hasVector && hasFts) {
      matchType = 'hybrid';
    } else if (hasVector) {
      matchType = 'semantic';
    } else {
      matchType = 'keyword';
    }

    // Determine source label
    let source: string;
    if (hasVector && hasFts) {
      source = 'both';
    } else if (hasVector) {
      source = 'vector';
    } else {
      source = 'fts5';
    }

    // matchScore: max of available scores
    const effectiveVector = hasVector ? (vectorScore as number) : 0;
    const effectiveFts = hasFts ? (ftsScore as number) : 0;
    const matchScore = Math.max(effectiveVector, effectiveFts);

    // Extract keywords: split on whitespace, filter stopwords and short tokens
    const matchedKeywords = this.extractMatchedKeywords(query, result);

    return {
      id: result?.id ?? 0,
      matchScore,
      matchType,
      matchedKeywords,
      source,
    };
  }

  /**
   * Split the query into candidate keywords and check which ones appear
   * in the result's searchable text fields.
   */
  private extractMatchedKeywords(query: string, result: any): string[] {
    if (!query || !result) return [];

    const queryWords = this.tokenize(query);
    if (queryWords.length === 0) return [];

    // Collect all searchable text from the result
    const searchableText = this.collectResultText(result).toLowerCase();
    if (!searchableText) return [];

    return queryWords.filter(word => searchableText.includes(word.toLowerCase()));
  }

  /**
   * Tokenize a query string into meaningful words.
   * Strips punctuation, lowercases, drops short tokens and stopwords.
   */
  private tokenize(text: string): string[] {
    const STOPWORDS = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
      'for', 'of', 'with', 'by', 'from', 'is', 'was', 'are', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
      'not', 'no', 'nor', 'so', 'yet', 'both', 'as', 'if', 'than',
    ]);

    return text
      .split(/[\s,;:.!?()[\]{}"'<>\/\\|@#$%^&*+=~`]+/)
      .map(w => w.trim())
      .filter(w => w.length >= 2)
      .filter(w => !STOPWORDS.has(w.toLowerCase()))
      .map(w => w.toLowerCase());
  }

  /**
   * Gather text from known result fields that are likely to contain searchable content.
   * Handles both structured session summaries and flat observation objects.
   */
  private collectResultText(result: any): string {
    const parts: string[] = [];

    // Common fields across result types
    const textFields = [
      'title', 'narrative', 'facts', 'text',
      'request', 'investigated', 'learned', 'completed', 'next_steps', 'notes',
      'summary', 'content', 'description', 'key_outcomes',
    ];

    for (const field of textFields) {
      const val = result[field];
      if (typeof val === 'string' && val.length > 0) {
        parts.push(val);
      } else if (Array.isArray(val)) {
        parts.push(val.filter(v => typeof v === 'string').join(' '));
      }
    }

    return parts.join(' ');
  }
}
