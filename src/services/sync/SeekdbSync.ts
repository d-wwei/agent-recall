/**
 * SeekdbSync Service
 *
 * Embedded vector search backend using seekdb + @seekdb/default-embed.
 * Drop-in replacement for ChromaSync's vector query interface.
 *
 * Unlike ChromaSync (which communicates via MCP to an external chroma-mcp process),
 * SeekdbSync runs entirely in-process with no external dependencies beyond the
 * seekdb npm package. This eliminates the uv/uvx requirement and the MCP protocol
 * overhead.
 *
 * Design decisions:
 * - Uses the same return format as ChromaSync.queryChroma() so SearchManager's
 *   fusion ranking code works without changes.
 * - Collection name follows same sanitization rules as ChromaSync.
 * - Metadata values are sanitized (no null/undefined/empty) before storage.
 * - Embedding model: Xenova/all-MiniLM-L6-v2 (same as PoC, 384-dim, ~25MB).
 */

import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { logger } from '../../utils/logger.js';

// seekdb types — imported dynamically to handle missing packages gracefully
type SeekdbClientType = any;
type SeekdbCollectionType = any;
type EmbeddingFunctionType = any;

export class SeekdbSync {
  private client: SeekdbClientType | null = null;
  private embedder: EmbeddingFunctionType | null = null;
  private collection: SeekdbCollectionType | null = null;
  private initialized = false;
  private project: string;
  private collectionName: string;
  private dataDir: string;

  constructor(project: string, dataDir: string) {
    this.project = project;
    this.dataDir = dataDir;

    // seekdb only allows [a-zA-Z0-9_] in collection names (stricter than ChromaDB)
    const sanitized = project
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    this.collectionName = `ar__${sanitized || 'unknown'}`;
  }

  /**
   * Initialize the seekdb client, embedding function, and collection.
   * Must be called before any sync or query operations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure data directory exists
    const vectorDir = join(this.dataDir, 'vector-db');
    if (!existsSync(vectorDir)) {
      mkdirSync(vectorDir, { recursive: true });
    }

    const dbPath = join(vectorDir, 'seekdb.db');

    try {
      const { SeekdbClient } = await import('seekdb');
      const { DefaultEmbeddingFunction } = await import('@seekdb/default-embed');

      this.client = new SeekdbClient({ path: dbPath });
      this.embedder = new DefaultEmbeddingFunction({
        modelName: 'Xenova/all-MiniLM-L6-v2',
      });

      // getOrCreateCollection is idempotent
      this.collection = await this.client.getOrCreateCollection({
        name: this.collectionName,
        embeddingFunction: this.embedder,
      });

      this.initialized = true;
      logger.info('SEEKDB_SYNC', 'Initialized', {
        project: this.project,
        collection: this.collectionName,
        dbPath,
      });
    } catch (error) {
      logger.error('SEEKDB_SYNC', 'Initialization failed', {
        project: this.project,
      }, error as Error);
      throw error;
    }
  }

  /**
   * Sanitize metadata: enforce string|number types, remove invalid values.
   * seekdb (like ChromaDB) stores metadata as JSON in SQLite — non-primitive
   * values or control characters cause "Invalid JSON text" errors.
   */
  private sanitizeMetadata(metadata: Record<string, any>): Record<string, string | number> {
    const result: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'number') {
        result[key] = isFinite(value) ? value : 0;
      } else if (typeof value === 'boolean') {
        result[key] = value ? 1 : 0;
      } else if (typeof value === 'string') {
        // Strip characters that break seekdb's internal SQLite JSON handling:
        // - Control characters (C0 range except \t)
        // - Double quotes, backslashes, newlines/carriage returns
        //   (seekdb embeds metadata in JSON via SQLite json functions without proper escaping)
        result[key] = value
          .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
          .replace(/["\\\n\r]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1000);
      } else {
        // Convert objects/arrays to JSON string
        try {
          result[key] = JSON.stringify(value).slice(0, 1000);
        } catch {
          // Skip values that can't be serialized
        }
      }
    }
    return result;
  }

  /**
   * Sanitize document text for SeekDB storage.
   * Strips control characters that cause JSON serialization errors.
   */
  private sanitizeDocument(doc: string): string {
    return doc.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
   * Upsert a single document (observation) into the collection.
   */
  async syncObservation(
    id: number,
    document: string,
    metadata: Record<string, any>
  ): Promise<void> {
    await this.ensureInitialized();

    const cleanMeta = this.sanitizeMetadata({
      ...metadata,
      doc_type: metadata.doc_type || 'observation',
    });

    try {
      await this.collection!.upsert({
        ids: [`obs_${id}`],
        documents: [this.sanitizeDocument(document)],
        metadatas: [cleanMeta],
      });

      logger.debug('SEEKDB_SYNC', 'Observation synced', { id, project: this.project });
    } catch (error) {
      logger.error('SEEKDB_SYNC', 'syncObservation failed', {
        id,
        project: this.project,
      }, error as Error);
      throw error;
    }
  }

  /**
   * Upsert a single document (summary) into the collection.
   */
  async syncSummary(
    id: number,
    document: string,
    metadata: Record<string, any>
  ): Promise<void> {
    await this.ensureInitialized();

    const cleanMeta = this.sanitizeMetadata({
      ...metadata,
      doc_type: metadata.doc_type || 'session_summary',
    });

    try {
      await this.collection!.upsert({
        ids: [`summary_${id}`],
        documents: [this.sanitizeDocument(document)],
        metadatas: [cleanMeta],
      });

      logger.debug('SEEKDB_SYNC', 'Summary synced', { id, project: this.project });
    } catch (error) {
      logger.error('SEEKDB_SYNC', 'syncSummary failed', {
        id,
        project: this.project,
      }, error as Error);
      throw error;
    }
  }

  /**
   * Upsert a batch of documents into the collection.
   * Used for backfill and multi-field observations.
   */
  async upsertDocuments(
    ids: string[],
    documents: string[],
    metadatas: Record<string, any>[]
  ): Promise<void> {
    await this.ensureInitialized();

    if (ids.length === 0) return;

    const cleanMetadatas = metadatas.map(m => this.sanitizeMetadata(m));

    try {
      // Batch in chunks of 100 to avoid memory pressure
      const BATCH_SIZE = 100;
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        const batchIds = ids.slice(i, i + BATCH_SIZE);
        const batchDocs = documents.slice(i, i + BATCH_SIZE);
        const batchMetas = cleanMetadatas.slice(i, i + BATCH_SIZE);

        await this.collection!.upsert({
          ids: batchIds,
          documents: batchDocs.map(d => this.sanitizeDocument(d)),
          metadatas: batchMetas,
        });
      }

      logger.debug('SEEKDB_SYNC', 'Batch upsert complete', {
        count: ids.length,
        project: this.project,
      });
    } catch (error) {
      logger.error('SEEKDB_SYNC', 'Batch upsert failed', {
        count: ids.length,
        project: this.project,
      }, error as Error);
      throw error;
    }
  }

  /**
   * Query the collection for semantically similar documents.
   * Returns ChromaSync-compatible format for drop-in replacement.
   */
  async query(
    queryText: string,
    limit: number,
    filter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    await this.ensureInitialized();

    try {
      const queryOptions: any = {
        queryTexts: [queryText],
        nResults: limit,
        include: ['documents', 'metadatas', 'distances'],
      };

      if (filter && Object.keys(filter).length > 0) {
        queryOptions.where = filter;
      }

      const results = await this.collection!.query(queryOptions);

      // seekdb returns nested arrays (one per query text), same as ChromaDB
      const docIds = results.ids?.[0] || [];
      const rawMetadatas = results.metadatas?.[0] || [];
      const rawDistances = results.distances?.[0] || [];

      // Deduplicate by sqlite_id, keeping best (first) distance per ID
      // Same logic as ChromaSync.queryChroma()
      const ids: number[] = [];
      const metadatas: any[] = [];
      const distances: number[] = [];
      const seen = new Set<number>();

      for (let i = 0; i < docIds.length; i++) {
        const docId = docIds[i];

        // Extract sqlite_id from document ID (three formats):
        // - obs_{id}_narrative, obs_{id}_fact_0, etc
        // - summary_{id}_request, summary_{id}_learned, etc
        // - prompt_{id}
        // - obs_{id} (simple format from syncObservation)
        // - summary_{id} (simple format from syncSummary)
        const obsMatch = docId.match(/obs_(\d+)/);
        const summaryMatch = docId.match(/summary_(\d+)/);
        const promptMatch = docId.match(/prompt_(\d+)/);

        let sqliteId: number | null = null;
        if (obsMatch) {
          sqliteId = parseInt(obsMatch[1], 10);
        } else if (summaryMatch) {
          sqliteId = parseInt(summaryMatch[1], 10);
        } else if (promptMatch) {
          sqliteId = parseInt(promptMatch[1], 10);
        }

        if (sqliteId !== null && !seen.has(sqliteId)) {
          seen.add(sqliteId);
          ids.push(sqliteId);
          metadatas.push(rawMetadatas[i] ?? null);
          distances.push(rawDistances[i] ?? 0);
        }
      }

      return { ids, distances, metadatas };
    } catch (error) {
      logger.error('SEEKDB_SYNC', 'Query failed', {
        project: this.project,
        queryText: queryText.slice(0, 100),
      }, error as Error);
      throw error;
    }
  }

  /**
   * Get the count of documents in the collection.
   */
  async count(): Promise<number> {
    await this.ensureInitialized();
    try {
      return await this.collection!.count();
    } catch {
      return 0;
    }
  }

  /**
   * Close the seekdb client and release resources.
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        // seekdb clients may or may not have a close method
        if (typeof this.client.close === 'function') {
          await this.client.close();
        }
      } catch {
        // Best-effort cleanup
      }
      this.client = null;
      this.collection = null;
      this.embedder = null;
      this.initialized = false;

      logger.info('SEEKDB_SYNC', 'Closed', { project: this.project });
    }
  }

  /**
   * Internal: ensure initialize() has been called.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
