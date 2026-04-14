/**
 * DatabaseManager: Single long-lived database connection
 *
 * Responsibility:
 * - Manage single database connection for worker lifetime
 * - Provide centralized access to SessionStore and SessionSearch
 * - High-level database operations
 * - SeekDB vector search integration
 */

import { SessionStore } from '../sqlite/SessionStore.js';
import { SessionSearch } from '../sqlite/SessionSearch.js';
import { SeekdbSync } from '../sync/SeekdbSync.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, DATA_DIR } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import type { DBSession } from '../worker-types.js';

export class DatabaseManager {
  private sessionStore: SessionStore | null = null;
  private sessionSearch: SessionSearch | null = null;
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
        const dataDir = settings.CLAUDE_MEM_DATA_DIR || DATA_DIR;
        this.seekdbSync = new SeekdbSync('agent-recall', dataDir);
        await this.seekdbSync.initialize();
        logger.info('DB', 'SeekdbSync initialized (embedded vector search)');
      } catch (error) {
        logger.error('DB', 'SeekdbSync initialization failed, falling back to SQLite-only', {}, error as Error);
        this.seekdbSync = null;
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
