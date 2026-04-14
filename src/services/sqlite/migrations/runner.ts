import { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';
import {
  TableColumnInfo,
  IndexInfo,
  TableNameRow,
  SchemaVersion
} from '../../../types/database.js';

/**
 * MigrationRunner handles all database schema migrations
 * Extracted from SessionStore to separate concerns
 */
export class MigrationRunner {
  constructor(private db: Database) {}

  /**
   * Run all migrations in order
   * This is the only public method - all migrations are internal
   */
  runAllMigrations(): void {
    this.initializeSchema();
    this.ensureWorkerPortColumn();
    this.ensurePromptTrackingColumns();
    this.removeSessionSummariesUniqueConstraint();
    this.addObservationHierarchicalFields();
    this.makeObservationsTextNullable();
    this.createUserPromptsTable();
    this.ensureDiscoveryTokensColumn();
    this.createPendingMessagesTable();
    this.renameSessionIdColumns();
    this.repairSessionIdColumnRename();
    this.addFailedAtEpochColumn();
    this.addOnUpdateCascadeToForeignKeys();
    this.addObservationContentHashColumn();
    this.addSessionCustomTitleColumn();
    // Agent Recall additions
    this.createAgentRecallCoreTables();
    this.addScopeColumns();
    this.createSessionArchivesTable();
    this.createTemplatesTable();
    this.createAuditLogTable();
    this.createObservationBufferTable();
    this.addObservationPhase1Fields();
    this.createSyncStateTable(); // migration 31
    this.createCompiledKnowledgeTable(); // migration 32
    this.addObservationPhase2Fields(); // migration 33
    this.createEntitiesTable(); // migration 34
    this.createFactsTable(); // migration 35
    this.createAgentDiaryTable(); // migration 36
    this.createMarkdownSyncTable(); // migration 37
    this.createActivityLogTable(); // migration 38
    this.addSessionPrivacyColumn(); // migration 39
    this.addObservationPropagatedColumn(); // migration 40
    this.createSharedKnowledgeTable(); // migration 41
    this.createCompilationLogsTable(); // migration 42
    this.addEvidenceTimelineColumn(); // migration 43
    this.addStructuredSummaryColumn(); // migration 44
    this.addInterruptedSessionStatus(); // migration 45
    this.createDoctorReportsTable();    // migration 46
  }

  /**
   * Initialize database schema (migration004)
   *
   * ALWAYS creates core tables using CREATE TABLE IF NOT EXISTS — safe to run
   * regardless of schema_versions state.  This fixes issue #979 where the old
   * DatabaseManager migration system (versions 1-7) shared the schema_versions
   * table, causing maxApplied > 0 and skipping core table creation entirely.
   */
  private initializeSchema(): void {
    // Create schema_versions table if it doesn't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    // Always create core tables — IF NOT EXISTS makes this idempotent
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sdk_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT UNIQUE NOT NULL,
        memory_session_id TEXT UNIQUE,
        project TEXT NOT NULL,
        user_prompt TEXT,
        started_at TEXT NOT NULL,
        started_at_epoch INTEGER NOT NULL,
        completed_at TEXT,
        completed_at_epoch INTEGER,
        status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
      );

      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
      CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS observations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
      CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
      CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

      CREATE TABLE IF NOT EXISTS session_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT UNIQUE NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `);

    // Record migration004 as applied (OR IGNORE handles re-runs safely)
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(4, new Date().toISOString());
  }

  /**
   * Ensure worker_port column exists (migration 5)
   *
   * NOTE: Version 5 conflicts with old DatabaseManager migration005 (which drops orphaned tables).
   * We check actual column state rather than relying solely on version tracking.
   */
  private ensureWorkerPortColumn(): void {
    // Check actual column existence — don't rely on version tracking alone (issue #979)
    const tableInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasWorkerPort = tableInfo.some(col => col.name === 'worker_port');

    if (!hasWorkerPort) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER');
      logger.debug('DB', 'Added worker_port column to sdk_sessions table');
    }

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(5, new Date().toISOString());
  }

  /**
   * Ensure prompt tracking columns exist (migration 6)
   *
   * NOTE: Version 6 conflicts with old DatabaseManager migration006 (which creates FTS5 tables).
   * We check actual column state rather than relying solely on version tracking.
   */
  private ensurePromptTrackingColumns(): void {
    // Check actual column existence — don't rely on version tracking alone (issue #979)
    // Check sdk_sessions for prompt_counter
    const sessionsInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasPromptCounter = sessionsInfo.some(col => col.name === 'prompt_counter');

    if (!hasPromptCounter) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0');
      logger.debug('DB', 'Added prompt_counter column to sdk_sessions table');
    }

    // Check observations for prompt_number
    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasPromptNumber = observationsInfo.some(col => col.name === 'prompt_number');

    if (!obsHasPromptNumber) {
      this.db.run('ALTER TABLE observations ADD COLUMN prompt_number INTEGER');
      logger.debug('DB', 'Added prompt_number column to observations table');
    }

    // Check session_summaries for prompt_number
    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasPromptNumber = summariesInfo.some(col => col.name === 'prompt_number');

    if (!sumHasPromptNumber) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER');
      logger.debug('DB', 'Added prompt_number column to session_summaries table');
    }

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(6, new Date().toISOString());
  }

  /**
   * Remove UNIQUE constraint from session_summaries.memory_session_id (migration 7)
   *
   * NOTE: Version 7 conflicts with old DatabaseManager migration007 (which adds discovery_tokens).
   * We check actual constraint state rather than relying solely on version tracking.
   */
  private removeSessionSummariesUniqueConstraint(): void {
    // Check actual constraint state — don't rely on version tracking alone (issue #979)
    const summariesIndexes = this.db.query('PRAGMA index_list(session_summaries)').all() as IndexInfo[];
    const hasUniqueConstraint = summariesIndexes.some(idx => idx.unique === 1);

    if (!hasUniqueConstraint) {
      // Already migrated (no constraint exists)
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Removing UNIQUE constraint from session_summaries.memory_session_id');

    // Begin transaction
    this.db.run('BEGIN TRANSACTION');

    // Clean up leftover temp table from a previously-crashed run
    this.db.run('DROP TABLE IF EXISTS session_summaries_new');

    // Create new table without UNIQUE constraint
    this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `);

    // Copy data from old table
    this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `);

    // Drop old table
    this.db.run('DROP TABLE session_summaries');

    // Rename new table
    this.db.run('ALTER TABLE session_summaries_new RENAME TO session_summaries');

    // Recreate indexes
    this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `);

    // Commit transaction
    this.db.run('COMMIT');

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString());

    logger.debug('DB', 'Successfully removed UNIQUE constraint from session_summaries.memory_session_id');
  }

  /**
   * Add hierarchical fields to observations table (migration 8)
   */
  private addObservationHierarchicalFields(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(8) as SchemaVersion | undefined;
    if (applied) return;

    // Check if new fields already exist
    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasTitle = tableInfo.some(col => col.name === 'title');

    if (hasTitle) {
      // Already migrated
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(8, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Adding hierarchical fields to observations table');

    // Add new columns
    this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `);

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(8, new Date().toISOString());

    logger.debug('DB', 'Successfully added hierarchical fields to observations table');
  }

  /**
   * Make observations.text nullable (migration 9)
   * The text field is deprecated in favor of structured fields (title, subtitle, narrative, etc.)
   */
  private makeObservationsTextNullable(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(9) as SchemaVersion | undefined;
    if (applied) return;

    // Check if text column is already nullable
    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const textColumn = tableInfo.find(col => col.name === 'text');

    if (!textColumn || textColumn.notnull === 0) {
      // Already migrated or text column doesn't exist
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(9, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Making observations.text nullable');

    // Begin transaction
    this.db.run('BEGIN TRANSACTION');

    // Clean up leftover temp table from a previously-crashed run
    this.db.run('DROP TABLE IF EXISTS observations_new');

    // Create new table with text as nullable
    this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL,
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `);

    // Copy data from old table (all existing columns)
    this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `);

    // Drop old table
    this.db.run('DROP TABLE observations');

    // Rename new table
    this.db.run('ALTER TABLE observations_new RENAME TO observations');

    // Recreate indexes
    this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `);

    // Commit transaction
    this.db.run('COMMIT');

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(9, new Date().toISOString());

    logger.debug('DB', 'Successfully made observations.text nullable');
  }

  /**
   * Create user_prompts table with FTS5 support (migration 10)
   */
  private createUserPromptsTable(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(10) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists
    const tableInfo = this.db.query('PRAGMA table_info(user_prompts)').all() as TableColumnInfo[];
    if (tableInfo.length > 0) {
      // Already migrated
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating user_prompts table with FTS5 support');

    // Begin transaction
    this.db.run('BEGIN TRANSACTION');

    // Create main table (using content_session_id since memory_session_id is set asynchronously by worker)
    this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);

    // Create FTS5 virtual table — skip if FTS5 is unavailable (e.g., Bun on Windows #791).
    // The user_prompts table itself is still created; only FTS indexing is skipped.
    try {
      this.db.run(`
        CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
          prompt_text,
          content='user_prompts',
          content_rowid='id'
        );
      `);

      // Create triggers to sync FTS5
      this.db.run(`
        CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;

        CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
        END;

        CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
          INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
          VALUES('delete', old.id, old.prompt_text);
          INSERT INTO user_prompts_fts(rowid, prompt_text)
          VALUES (new.id, new.prompt_text);
        END;
      `);
    } catch (ftsError) {
      logger.warn('DB', 'FTS5 not available — user_prompts_fts skipped (search uses ChromaDB)', {}, ftsError as Error);
    }

    // Commit transaction
    this.db.run('COMMIT');

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());

    logger.debug('DB', 'Successfully created user_prompts table');
  }

  /**
   * Ensure discovery_tokens column exists (migration 11)
   * CRITICAL: This migration was incorrectly using version 7 (which was already taken by removeSessionSummariesUniqueConstraint)
   * The duplicate version number may have caused migration tracking issues in some databases
   */
  private ensureDiscoveryTokensColumn(): void {
    // Check if migration already applied to avoid unnecessary re-runs
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(11) as SchemaVersion | undefined;
    if (applied) return;

    // Check if discovery_tokens column exists in observations table
    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasDiscoveryTokens = observationsInfo.some(col => col.name === 'discovery_tokens');

    if (!obsHasDiscoveryTokens) {
      this.db.run('ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0');
      logger.debug('DB', 'Added discovery_tokens column to observations table');
    }

    // Check if discovery_tokens column exists in session_summaries table
    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasDiscoveryTokens = summariesInfo.some(col => col.name === 'discovery_tokens');

    if (!sumHasDiscoveryTokens) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0');
      logger.debug('DB', 'Added discovery_tokens column to session_summaries table');
    }

    // Record migration only after successful column verification/addition
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(11, new Date().toISOString());
  }

  /**
   * Create pending_messages table for persistent work queue (migration 16)
   * Messages are persisted before processing and deleted after success.
   * Enables recovery from SDK hangs and worker crashes.
   */
  private createPendingMessagesTable(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(16) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all() as TableNameRow[];
    if (tables.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(16, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating pending_messages table');

    this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_epoch INTEGER NOT NULL,
        started_processing_at_epoch INTEGER,
        completed_at_epoch INTEGER,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(16, new Date().toISOString());

    logger.debug('DB', 'pending_messages table created successfully');
  }

  /**
   * Rename session ID columns for semantic clarity (migration 17)
   * - claude_session_id -> content_session_id (user's observed session)
   * - sdk_session_id -> memory_session_id (memory agent's session for resume)
   *
   * IDEMPOTENT: Checks each table individually before renaming.
   * This handles databases in any intermediate state (partial migration, fresh install, etc.)
   */
  private renameSessionIdColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(17) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Checking session ID columns for semantic clarity rename');

    let renamesPerformed = 0;

    // Helper to safely rename a column if it exists
    const safeRenameColumn = (table: string, oldCol: string, newCol: string): boolean => {
      const tableInfo = this.db.query(`PRAGMA table_info(${table})`).all() as TableColumnInfo[];
      const hasOldCol = tableInfo.some(col => col.name === oldCol);
      const hasNewCol = tableInfo.some(col => col.name === newCol);

      if (hasNewCol) {
        // Already renamed, nothing to do
        return false;
      }

      if (hasOldCol) {
        // SQLite 3.25+ supports ALTER TABLE RENAME COLUMN
        this.db.run(`ALTER TABLE ${table} RENAME COLUMN ${oldCol} TO ${newCol}`);
        logger.debug('DB', `Renamed ${table}.${oldCol} to ${newCol}`);
        return true;
      }

      // Neither column exists - table might not exist or has different schema
      logger.warn('DB', `Column ${oldCol} not found in ${table}, skipping rename`);
      return false;
    };

    // Rename in sdk_sessions table
    if (safeRenameColumn('sdk_sessions', 'claude_session_id', 'content_session_id')) renamesPerformed++;
    if (safeRenameColumn('sdk_sessions', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    // Rename in pending_messages table
    if (safeRenameColumn('pending_messages', 'claude_session_id', 'content_session_id')) renamesPerformed++;

    // Rename in observations table
    if (safeRenameColumn('observations', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    // Rename in session_summaries table
    if (safeRenameColumn('session_summaries', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    // Rename in user_prompts table
    if (safeRenameColumn('user_prompts', 'claude_session_id', 'content_session_id')) renamesPerformed++;

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(17, new Date().toISOString());

    if (renamesPerformed > 0) {
      logger.debug('DB', `Successfully renamed ${renamesPerformed} session ID columns`);
    } else {
      logger.debug('DB', 'No session ID column renames needed (already up to date)');
    }
  }

  /**
   * Repair session ID column renames (migration 19)
   * DEPRECATED: Migration 17 is now fully idempotent and handles all cases.
   * This migration is kept for backwards compatibility but does nothing.
   */
  private repairSessionIdColumnRename(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(19) as SchemaVersion | undefined;
    if (applied) return;

    // Migration 17 now handles all column rename cases idempotently.
    // Just record this migration as applied.
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(19, new Date().toISOString());
  }

  /**
   * Add failed_at_epoch column to pending_messages (migration 20)
   * Used by markSessionMessagesFailed() for error recovery tracking
   */
  private addFailedAtEpochColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(20) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'failed_at_epoch');

    if (!hasColumn) {
      this.db.run('ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER');
      logger.debug('DB', 'Added failed_at_epoch column to pending_messages table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(20, new Date().toISOString());
  }

  /**
   * Add ON UPDATE CASCADE to FK constraints on observations and session_summaries (migration 21)
   *
   * Both tables have FK(memory_session_id) -> sdk_sessions(memory_session_id) with ON DELETE CASCADE
   * but missing ON UPDATE CASCADE. This causes FK constraint violations when code updates
   * sdk_sessions.memory_session_id while child rows still reference the old value.
   *
   * SQLite doesn't support ALTER TABLE for FK changes, so we recreate both tables.
   */
  private addOnUpdateCascadeToForeignKeys(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(21) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Adding ON UPDATE CASCADE to FK constraints on observations and session_summaries');

    // PRAGMA foreign_keys must be set outside a transaction
    this.db.run('PRAGMA foreign_keys = OFF');
    this.db.run('BEGIN TRANSACTION');

    try {
      // ==========================================
      // 1. Recreate observations table
      // ==========================================

      // Drop FTS triggers first (they reference the observations table)
      this.db.run('DROP TRIGGER IF EXISTS observations_ai');
      this.db.run('DROP TRIGGER IF EXISTS observations_ad');
      this.db.run('DROP TRIGGER IF EXISTS observations_au');

      // Clean up leftover temp table from a previously-crashed run
      this.db.run('DROP TABLE IF EXISTS observations_new');

      this.db.run(`
        CREATE TABLE observations_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          text TEXT,
          type TEXT NOT NULL,
          title TEXT,
          subtitle TEXT,
          facts TEXT,
          narrative TEXT,
          concepts TEXT,
          files_read TEXT,
          files_modified TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);

      this.db.run(`
        INSERT INTO observations_new
        SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
               narrative, concepts, files_read, files_modified, prompt_number,
               discovery_tokens, created_at, created_at_epoch
        FROM observations
      `);

      this.db.run('DROP TABLE observations');
      this.db.run('ALTER TABLE observations_new RENAME TO observations');

      // Recreate indexes
      this.db.run(`
        CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
        CREATE INDEX idx_observations_project ON observations(project);
        CREATE INDEX idx_observations_type ON observations(type);
        CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
      `);

      // Recreate FTS triggers only if observations_fts exists
      const hasFTS = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='observations_fts'").all() as { name: string }[]).length > 0;
      if (hasFTS) {
        this.db.run(`
          CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
          END;

          CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
            INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
            INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
            VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
          END;
        `);
      }

      // ==========================================
      // 2. Recreate session_summaries table
      // ==========================================

      // Clean up leftover temp table from a previously-crashed run
      this.db.run('DROP TABLE IF EXISTS session_summaries_new');

      this.db.run(`
        CREATE TABLE session_summaries_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          request TEXT,
          investigated TEXT,
          learned TEXT,
          completed TEXT,
          next_steps TEXT,
          files_read TEXT,
          files_edited TEXT,
          notes TEXT,
          prompt_number INTEGER,
          discovery_tokens INTEGER DEFAULT 0,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE ON UPDATE CASCADE
        )
      `);

      this.db.run(`
        INSERT INTO session_summaries_new
        SELECT id, memory_session_id, project, request, investigated, learned,
               completed, next_steps, files_read, files_edited, notes,
               prompt_number, discovery_tokens, created_at, created_at_epoch
        FROM session_summaries
      `);

      // Drop session_summaries FTS triggers before dropping the table
      this.db.run('DROP TRIGGER IF EXISTS session_summaries_ai');
      this.db.run('DROP TRIGGER IF EXISTS session_summaries_ad');
      this.db.run('DROP TRIGGER IF EXISTS session_summaries_au');

      this.db.run('DROP TABLE session_summaries');
      this.db.run('ALTER TABLE session_summaries_new RENAME TO session_summaries');

      // Recreate indexes
      this.db.run(`
        CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
        CREATE INDEX idx_session_summaries_project ON session_summaries(project);
        CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
      `);

      // Recreate session_summaries FTS triggers if FTS table exists
      const hasSummariesFTS = (this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_summaries_fts'").all() as { name: string }[]).length > 0;
      if (hasSummariesFTS) {
        this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
          END;

          CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
            INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
            INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
            VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
          END;
        `);
      }

      // Record migration
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(21, new Date().toISOString());

      this.db.run('COMMIT');
      this.db.run('PRAGMA foreign_keys = ON');

      logger.debug('DB', 'Successfully added ON UPDATE CASCADE to FK constraints');
    } catch (error) {
      this.db.run('ROLLBACK');
      this.db.run('PRAGMA foreign_keys = ON');
      throw error;
    }
  }

  /**
   * Add content_hash column to observations for deduplication (migration 22)
   * Prevents duplicate observations from being stored when the same content is processed multiple times.
   * Backfills existing rows with unique random hashes so they don't block new inserts.
   */
  private addObservationContentHashColumn(): void {
    // Check actual schema first — cross-machine DB sync can leave schema_versions
    // claiming this migration ran while the column is actually missing (e.g. migration 21
    // recreated the table without content_hash on the synced machine).
    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'content_hash');

    if (hasColumn) {
      // Column exists — just ensure version record is present
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(22, new Date().toISOString());
      return;
    }

    this.db.run('ALTER TABLE observations ADD COLUMN content_hash TEXT');
    // Backfill existing rows with unique random hashes
    this.db.run("UPDATE observations SET content_hash = substr(hex(randomblob(8)), 1, 16) WHERE content_hash IS NULL");
    // Index for fast dedup lookups
    this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_content_hash ON observations(content_hash, created_at_epoch)');
    logger.debug('DB', 'Added content_hash column to observations table with backfill and index');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(22, new Date().toISOString());
  }

  /**
   * Add custom_title column to sdk_sessions for agent attribution (migration 23)
   * Allows callers (e.g. Maestro agents) to label sessions with a human-readable name.
   */
  private addSessionCustomTitleColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(23) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'custom_title');

    if (!hasColumn) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN custom_title TEXT');
      logger.debug('DB', 'Added custom_title column to sdk_sessions table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(23, new Date().toISOString());
  }

  /**
   * Create Agent Recall core tables (migration 24)
   * - agent_profiles: Agent persona and user profiles with global/project scope
   * - bootstrap_state: Bootstrap interview progress tracking
   * - active_tasks: Session recovery anchor for cross-session continuity
   */
  private createAgentRecallCoreTables(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(24) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Creating Agent Recall core tables (agent_profiles, bootstrap_state, active_tasks)');

    this.db.run('BEGIN TRANSACTION');

    try {
      // agent_profiles: stores agent persona, user profile, style, workflow
      this.db.run(`
        CREATE TABLE IF NOT EXISTS agent_profiles (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL DEFAULT 'global',
          profile_type TEXT NOT NULL,
          content_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          updated_at TEXT,
          updated_at_epoch INTEGER
        )
      `);
      this.db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_profiles_scope_type ON agent_profiles(scope, profile_type)');

      // bootstrap_state: tracks bootstrap interview progress
      this.db.run(`
        CREATE TABLE IF NOT EXISTS bootstrap_state (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          scope TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'pending',
          round INTEGER NOT NULL DEFAULT 0,
          started_at TEXT,
          completed_at TEXT,
          metadata_json TEXT
        )
      `);

      // active_tasks: session recovery anchor
      this.db.run(`
        CREATE TABLE IF NOT EXISTS active_tasks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project TEXT NOT NULL,
          task_name TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'in_progress',
          progress TEXT,
          next_step TEXT,
          context_json TEXT,
          interrupted_tasks_json TEXT,
          started_at TEXT NOT NULL,
          started_at_epoch INTEGER NOT NULL,
          updated_at TEXT,
          updated_at_epoch INTEGER
        )
      `);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_active_tasks_project ON active_tasks(project)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_active_tasks_status ON active_tasks(status)');

      this.db.run('COMMIT');

      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(24, new Date().toISOString());
      logger.debug('DB', 'Agent Recall core tables created successfully');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Add scope column to observations and session_summaries (migration 25)
   * Enables global vs project memory layering
   */
  private addScopeColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(25) as SchemaVersion | undefined;
    if (applied) return;

    // Check and add scope to observations
    const obsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    if (!obsInfo.some(col => col.name === 'scope')) {
      this.db.run("ALTER TABLE observations ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'");
      logger.debug('DB', 'Added scope column to observations table');
    }

    // Check and add scope to session_summaries
    const sumInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    if (!sumInfo.some(col => col.name === 'scope')) {
      this.db.run("ALTER TABLE session_summaries ADD COLUMN scope TEXT NOT NULL DEFAULT 'project'");
      logger.debug('DB', 'Added scope column to session_summaries table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(25, new Date().toISOString());
  }

  /**
   * Create session_archives and sync_policies tables (migration 26)
   * - session_archives: Searchable session archive with tags for temporal/topic recall
   * - sync_policies: Per-project memory promotion policy
   */
  private createSessionArchivesTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(26) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Creating session_archives and sync_policies tables');

    this.db.run('BEGIN TRANSACTION');

    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS session_archives (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT,
          project TEXT NOT NULL,
          summary TEXT,
          key_outcomes TEXT,
          files_changed TEXT,
          tags TEXT,
          duration_minutes INTEGER,
          archived_at TEXT NOT NULL,
          archived_at_epoch INTEGER NOT NULL
        )
      `);
      this.db.run('CREATE INDEX IF NOT EXISTS idx_session_archives_project ON session_archives(project)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_session_archives_date ON session_archives(archived_at_epoch DESC)');

      // FTS5 for archive search (skip if unavailable on Windows)
      try {
        this.db.run(`
          CREATE VIRTUAL TABLE IF NOT EXISTS session_archives_fts USING fts5(
            summary, key_outcomes, tags,
            content='session_archives',
            content_rowid='id'
          )
        `);
        this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_archives_ai AFTER INSERT ON session_archives BEGIN
            INSERT INTO session_archives_fts(rowid, summary, key_outcomes, tags)
            VALUES (new.id, new.summary, new.key_outcomes, new.tags);
          END
        `);
        this.db.run(`
          CREATE TRIGGER IF NOT EXISTS session_archives_ad AFTER DELETE ON session_archives BEGIN
            INSERT INTO session_archives_fts(session_archives_fts, rowid, summary, key_outcomes, tags)
            VALUES('delete', old.id, old.summary, old.key_outcomes, old.tags);
          END
        `);
      } catch (ftsError) {
        logger.warn('DB', 'FTS5 not available — session_archives_fts skipped', {}, ftsError as Error);
      }

      this.db.run(`
        CREATE TABLE IF NOT EXISTS sync_policies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project TEXT NOT NULL UNIQUE,
          default_action TEXT NOT NULL DEFAULT 'ask',
          created_at TEXT NOT NULL,
          updated_at TEXT
        )
      `);

      this.db.run('COMMIT');
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(26, new Date().toISOString());
      logger.debug('DB', 'session_archives and sync_policies tables created');
    } catch (error) {
      this.db.run('ROLLBACK');
      throw error;
    }
  }

  /**
   * Create templates table for reusable text templates (migration 27)
   * Supports global and project-scoped templates with category filtering.
   */
  private createTemplatesTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(27) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='templates'").all() as TableNameRow[];
    if (tables.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(27, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating templates table');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'global',
        category TEXT,
        content TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        updated_at TEXT,
        updated_at_epoch INTEGER
      )
    `);
    this.db.run('CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_scope_name ON templates(scope, name)');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(27, new Date().toISOString());
    logger.debug('DB', 'templates table created successfully');
  }

  /**
   * Create audit_log table for data operation tracking (migration 28)
   * Records delete, export, cleanup, profile update, and review actions.
   */
  private createAuditLogTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(28) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").all() as TableNameRow[];
    if (tables.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(28, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating audit_log table');

    this.db.run(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        details TEXT,
        record_count INTEGER,
        performed_at TEXT NOT NULL,
        performed_at_epoch INTEGER NOT NULL
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_audit_log_epoch ON audit_log(performed_at_epoch)');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(28, new Date().toISOString());
    logger.debug('DB', 'audit_log table created successfully');
  }

  /**
   * Create observation_buffer staging table (migration 29)
   * Used by WriteBuffer to accumulate per-session observations before flushing
   * to the main observations table on SessionEnd (concurrency safety, Phase 1).
   */
  private createObservationBufferTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(29);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observation_buffer (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_observation_buffer_session ON observation_buffer(session_id);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(29, new Date().toISOString());
  }

  /**
   * Add Phase 1 fields to observations table (migration 30)
   * Enables confidence-weighted ranking, tag-based Chroma enrichment,
   * preference synthesis, temporal anchoring, and staleness decay.
   */
  private addObservationPhase1Fields(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(30);
    if (applied) return;

    const tableInfo = this.db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
    const existingColumns = new Set(tableInfo.map((c: any) => c.name));

    const newColumns = [
      { name: 'confidence', sql: "ALTER TABLE observations ADD COLUMN confidence TEXT DEFAULT 'medium'" },
      { name: 'tags', sql: "ALTER TABLE observations ADD COLUMN tags TEXT DEFAULT '[]'" },
      { name: 'has_preference', sql: 'ALTER TABLE observations ADD COLUMN has_preference INTEGER DEFAULT 0' },
      { name: 'event_date', sql: 'ALTER TABLE observations ADD COLUMN event_date TEXT' },
      { name: 'last_referenced_at', sql: 'ALTER TABLE observations ADD COLUMN last_referenced_at TEXT' },
    ];

    for (const col of newColumns) {
      if (!existingColumns.has(col.name)) {
        this.db.exec(col.sql);
      }
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(30, new Date().toISOString());
  }

  /**
   * Create sync_state table for auto memory tracking (migration 31)
   * Tracks which .assistant/ files have been synced into the database,
   * enabling incremental re-sync on content changes.
   */
  private createSyncStateTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(31);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        file_path TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL,
        source_type TEXT NOT NULL,
        last_sync_at TEXT NOT NULL
      );
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(31, new Date().toISOString());
  }

  /**
   * Create compiled_knowledge table for persistent compiled knowledge entries (migration 32)
   */
  private createCompiledKnowledgeTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(32);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compiled_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        topic TEXT NOT NULL,
        content TEXT NOT NULL,
        source_observation_ids TEXT DEFAULT '[]',
        confidence TEXT DEFAULT 'high',
        protected INTEGER DEFAULT 0,
        privacy_scope TEXT DEFAULT 'global',
        version INTEGER DEFAULT 1,
        compiled_at TEXT,
        valid_until TEXT,
        superseded_by INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ck_project ON compiled_knowledge(project);
      CREATE INDEX IF NOT EXISTS idx_ck_topic ON compiled_knowledge(project, topic);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(32, new Date().toISOString());
  }

  private addObservationPhase2Fields(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(33);
    if (applied) return;

    // Add new columns to observations
    const tableInfo = this.db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
    const existingColumns = new Set(tableInfo.map((c: any) => c.name));

    const newColumns = [
      { name: 'valid_until', sql: 'ALTER TABLE observations ADD COLUMN valid_until TEXT' },
      { name: 'superseded_by', sql: 'ALTER TABLE observations ADD COLUMN superseded_by INTEGER' },
      { name: 'related_observations', sql: "ALTER TABLE observations ADD COLUMN related_observations TEXT DEFAULT '[]'" },
    ];

    for (const col of newColumns) {
      if (!existingColumns.has(col.name)) {
        this.db.exec(col.sql);
      }
    }

    // Create observation_links table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS observation_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER REFERENCES observations(id),
        target_id INTEGER REFERENCES observations(id),
        relation TEXT NOT NULL,
        auto_detected INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_obs_links_source ON observation_links(source_id);
      CREATE INDEX IF NOT EXISTS idx_obs_links_target ON observation_links(target_id);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(33, new Date().toISOString());
  }

  /**
   * Create entities table for knowledge graph (migration 34)
   */
  private createEntitiesTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(34);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'unknown',
        properties TEXT DEFAULT '{}',
        first_seen_at TEXT,
        last_seen_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(34, new Date().toISOString());
  }

  /**
   * Create facts table for knowledge graph (migration 35)
   */
  private createFactsTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(35);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY,
        subject TEXT REFERENCES entities(id),
        predicate TEXT NOT NULL,
        object TEXT REFERENCES entities(id),
        valid_from TEXT,
        valid_to TEXT,
        confidence REAL DEFAULT 1.0,
        source_observation_id INTEGER,
        source_ref TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
      CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object);
      CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(35, new Date().toISOString());
  }

  /**
   * Create agent_diary table for session-scoped diary entries (migration 36)
   * Stores agent diary entries scoped by project and memory session.
   */
  private createAgentDiaryTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(36);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_diary (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT,
        project TEXT,
        entry TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_diary_project ON agent_diary(project);
      CREATE INDEX IF NOT EXISTS idx_diary_session ON agent_diary(memory_session_id);
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(36, new Date().toISOString());
  }

  /**
   * Create markdown_sync table for tracking DB-to-file export state (migration 37)
   * Records per-file hash state so incremental re-exports can skip unchanged records.
   */
  private createMarkdownSyncTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(37);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS markdown_sync (
        file_path TEXT PRIMARY KEY,
        last_db_hash TEXT,
        last_file_hash TEXT,
        last_sync_at TEXT
      );
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(37, new Date().toISOString());
  }

  /**
   * Create activity_log table (migration 38)
   */
  private createActivityLogTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(38);
    if (applied) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        operation TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        project TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_activity_log_operation ON activity_log(operation);
      CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);
    `);
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(38, new Date().toISOString());
    logger.debug('DB', 'activity_log table created successfully');
  }

  /**
   * Add has_private_content column to sdk_sessions (migration 39)
   *
   * When any observation in a session is marked private, the entire session
   * is flagged so PrivacyGuard can exclude all observations from that session
   * during compilation — not just the tagged ones.
   */
  private addSessionPrivacyColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(39);
    if (applied) return;

    // Check if column already exists before adding
    const columns = this.db.prepare('PRAGMA table_info(sdk_sessions)').all() as { name: string }[];
    const hasColumn = columns.some(c => c.name === 'has_private_content');

    if (!hasColumn) {
      this.db.exec('ALTER TABLE sdk_sessions ADD COLUMN has_private_content INTEGER DEFAULT 0');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(39, new Date().toISOString());
    logger.debug('DB', 'has_private_content column added to sdk_sessions');
  }

  /**
   * Add propagated column to observations for multi-agent coordination (migration 40)
   */
  private addObservationPropagatedColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(40);
    if (applied) return;

    const columns = this.db.prepare('PRAGMA table_info(observations)').all() as { name: string }[];
    const hasColumn = columns.some(c => c.name === 'propagated');

    if (!hasColumn) {
      this.db.exec('ALTER TABLE observations ADD COLUMN propagated INTEGER DEFAULT 0');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(40, new Date().toISOString());
    logger.debug('DB', 'propagated column added to observations');
  }

  /**
   * Create shared_knowledge table for team collaboration (migration 41)
   */
  private createSharedKnowledgeTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(41);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shared_knowledge (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic TEXT,
        content TEXT,
        shared_by TEXT,
        project TEXT,
        shared_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(41, new Date().toISOString());
    logger.debug('DB', 'shared_knowledge table created');
  }

  /**
   * Create compilation_logs table for compilation observability (migration 42)
   *
   * Tracks each compilation run: start/end times, observation count,
   * pages created/updated, tokens used, and final status (success/failed/cancelled).
   */
  private createCompilationLogsTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(42);
    if (applied) return;

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS compilation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project TEXT NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER DEFAULT 0,
        observations_processed INTEGER DEFAULT 0,
        pages_created INTEGER DEFAULT 0,
        pages_updated INTEGER DEFAULT 0,
        tokens_used INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(42, new Date().toISOString());
    logger.debug('DB', 'compilation_logs table created');
  }

  /**
   * Add evidence_timeline column to compiled_knowledge (migration 43)
   *
   * Stores a JSON array of evidence entries linking compiled knowledge
   * back to the source observations that formed it — audit trail.
   */
  private addEvidenceTimelineColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(43);
    if (applied) return;

    const tableInfo = this.db.prepare('PRAGMA table_info(compiled_knowledge)').all() as { name: string }[];
    const has = tableInfo.some((c: any) => c.name === 'evidence_timeline');
    if (!has) {
      this.db.exec("ALTER TABLE compiled_knowledge ADD COLUMN evidence_timeline TEXT DEFAULT '[]'");
      logger.debug('DB', 'Added evidence_timeline column to compiled_knowledge');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(43, new Date().toISOString());
  }

  /**
   * Add structured_summary column to session_summaries (migration 44)
   *
   * Stores a JSON blob of StructuredSummary for actionable session recovery.
   */
  private addStructuredSummaryColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(44);
    if (applied) return;

    const tableInfo = this.db.prepare('PRAGMA table_info(session_summaries)').all() as { name: string }[];
    const has = tableInfo.some((c: any) => c.name === 'structured_summary');
    if (!has) {
      this.db.exec('ALTER TABLE session_summaries ADD COLUMN structured_summary TEXT');
      logger.debug('DB', 'Added structured_summary column to session_summaries');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(44, new Date().toISOString());
  }

  /**
   * Add 'interrupted' to sdk_sessions status CHECK constraint (migration 45)
   *
   * When the user closes the terminal unexpectedly, sessions are left in 'active'
   * state. The stale buffer recovery system marks them as 'interrupted' so the
   * ContextBuilder can warn the user on next startup. SQLite requires table
   * recreation to modify CHECK constraints.
   */
  private addInterruptedSessionStatus(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(45);
    if (applied) return;

    logger.debug('DB', 'Adding interrupted status to sdk_sessions CHECK constraint');

    // Get current column list to ensure we copy all columns
    const tableInfo = this.db.prepare('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const columnNames = tableInfo.map(col => col.name);

    // Only proceed if the status column exists and has the old constraint
    if (!columnNames.includes('status')) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(45, new Date().toISOString());
      return;
    }

    this.db.run('PRAGMA foreign_keys = OFF');
    this.db.run('BEGIN TRANSACTION');

    try {
      // Clean up leftover temp table from a previously-crashed run
      this.db.run('DROP TABLE IF EXISTS sdk_sessions_new');

      // Build column definitions dynamically from current schema
      const colDefs = tableInfo.map(col => {
        if (col.name === 'status') {
          // Updated CHECK constraint with 'interrupted' added
          return "status TEXT CHECK(status IN ('active', 'completed', 'failed', 'interrupted')) NOT NULL DEFAULT 'active'";
        }
        // Reconstruct column definition from PRAGMA info
        let def = `${col.name} ${col.type}`;
        if (col.notnull) def += ' NOT NULL';
        if (col.dflt_value !== null) def += ` DEFAULT ${col.dflt_value}`;
        if (col.pk) def += ' PRIMARY KEY AUTOINCREMENT';
        return def;
      });

      // Add UNIQUE constraints (not captured by PRAGMA table_info)
      // content_session_id and memory_session_id have UNIQUE constraints
      const createSQL = `CREATE TABLE sdk_sessions_new (${colDefs.join(', ')}, UNIQUE(content_session_id), UNIQUE(memory_session_id))`;
      this.db.run(createSQL);

      // Copy all data
      const cols = columnNames.join(', ');
      this.db.run(`INSERT INTO sdk_sessions_new SELECT ${cols} FROM sdk_sessions`);

      // Drop old table and rename
      this.db.run('DROP TABLE sdk_sessions');
      this.db.run('ALTER TABLE sdk_sessions_new RENAME TO sdk_sessions');

      // Recreate indexes
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC)');

      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    } finally {
      this.db.run('PRAGMA foreign_keys = ON');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(45, new Date().toISOString());
    logger.debug('DB', 'Added interrupted status to sdk_sessions CHECK constraint');
  }

  /**
   * Create doctor_reports table for storing health audit results (migration 46)
   */
  private createDoctorReportsTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(46);
    if (applied) return;

    this.db.run(`
      CREATE TABLE IF NOT EXISTS doctor_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        score REAL NOT NULL,
        grade TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'full',
        results TEXT NOT NULL,
        critical_failures TEXT,
        recommendations TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.run('CREATE INDEX IF NOT EXISTS idx_doctor_reports_created ON doctor_reports(created_at DESC)');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(46, new Date().toISOString());
    logger.debug('DB', 'Created doctor_reports table');
  }
}
