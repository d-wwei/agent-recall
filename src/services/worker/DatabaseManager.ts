/**
 * DatabaseManager: Single long-lived database connection
 *
 * Responsibility:
 * - Manage single database connection for worker lifetime
 * - Provide centralized access to SessionStore and SessionSearch
 * - High-level database operations
 * - ChromaSync integration
 */

import { SessionStore } from '../sqlite/SessionStore.js';
import { SessionSearch } from '../sqlite/SessionSearch.js';
import { ChromaSync } from '../sync/ChromaSync.js';
import { SeekdbSync } from '../sync/SeekdbSync.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import type { DBSession } from '../worker-types.js';

export class DatabaseManager {
  private sessionStore: SessionStore | null = null;
  private sessionSearch: SessionSearch | null = null;
  private chromaSync: ChromaSync | null = null;
  private seekdbSync: SeekdbSync | null = null;

  /**
   * Initialize database connection (once, stays open)
   */
  async initialize(): Promise<void> {
    // Open database connection (ONCE)
    this.sessionStore = new SessionStore();
    this.sessionSearch = new SessionSearch();

    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    const vectorBackend = settings.AGENT_RECALL_VECTOR_BACKEND || 'seekdb';

    if (vectorBackend === 'seekdb') {
      // Embedded vector search via seekdb (default, no external deps)
      try {
        const dataDir = settings.CLAUDE_MEM_DATA_DIR;
        this.seekdbSync = new SeekdbSync('agent-recall', dataDir);
        await this.seekdbSync.initialize();
        logger.info('DB', 'SeekdbSync initialized (embedded vector search)');
      } catch (error) {
        logger.error('DB', 'SeekdbSync initialization failed, falling back to SQLite-only', {}, error as Error);
        this.seekdbSync = null;
      }
    } else if (vectorBackend === 'chroma') {
      // Legacy ChromaSync via MCP (requires uv/uvx)
      const chromaEnabled = settings.CLAUDE_MEM_CHROMA_ENABLED !== 'false';
      if (chromaEnabled) {
        this.chromaSync = new ChromaSync('agent-recall');
        logger.info('DB', 'ChromaSync initialized (external MCP vector search)');
      } else {
        logger.info('DB', 'Chroma backend selected but CLAUDE_MEM_CHROMA_ENABLED=false, using SQLite-only search');
      }
    } else {
      // vectorBackend === 'none' or unknown
      logger.info('DB', `Vector backend '${vectorBackend}' — using SQLite-only search`);
    }

    logger.info('DB', 'Database initialized');
  }

  /**
   * Close database connection and cleanup all resources
   */
  async close(): Promise<void> {
    // Close vector backends
    if (this.seekdbSync) {
      await this.seekdbSync.close();
      this.seekdbSync = null;
    }
    if (this.chromaSync) {
      await this.chromaSync.close();
      this.chromaSync = null;
    }

    if (this.sessionStore) {
      this.sessionStore.close();
      this.sessionStore = null;
    }
    if (this.sessionSearch) {
      this.sessionSearch.close();
      this.sessionSearch = null;
    }
    logger.info('DB', 'Database closed');
  }

  /**
   * Get SessionStore instance (throws if not initialized)
   */
  getSessionStore(): SessionStore {
    if (!this.sessionStore) {
      throw new Error('Database not initialized');
    }
    return this.sessionStore;
  }

  /**
   * Get SessionSearch instance (throws if not initialized)
   */
  getSessionSearch(): SessionSearch {
    if (!this.sessionSearch) {
      throw new Error('Database not initialized');
    }
    return this.sessionSearch;
  }

  /**
   * Get ChromaSync instance (returns null if Chroma is disabled or seekdb is active)
   */
  getChromaSync(): ChromaSync | null {
    return this.chromaSync;
  }

  /**
   * Get SeekdbSync instance (returns null if seekdb is not the active backend)
   */
  getSeekdbSync(): SeekdbSync | null {
    return this.seekdbSync;
  }

  // REMOVED: cleanupOrphanedSessions - violates "EVERYTHING SHOULD SAVE ALWAYS"
  // Worker restarts don't make sessions orphaned. Sessions are managed by hooks
  // and exist independently of worker state.

  /**
   * Get session by ID (throws if not found)
   */
  getSessionById(sessionDbId: number): {
    id: number;
    content_session_id: string;
    memory_session_id: string | null;
    project: string;
    user_prompt: string;
  } {
    const session = this.getSessionStore().getSessionById(sessionDbId);
    if (!session) {
      throw new Error(`Session ${sessionDbId} not found`);
    }
    return session;
  }

}
