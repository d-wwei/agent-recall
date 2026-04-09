import { Database } from 'bun:sqlite';

interface EntityRow {
  id: string;
  name: string;
  type: string;
  properties: string;
  first_seen_at: string | null;
  last_seen_at: string | null;
}

interface FactRow {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number;
  source_observation_id: number | null;
  source_ref: string | null;
  created_at: string;
}

/**
 * KnowledgeGraphService provides entity and fact CRUD operations
 * for the knowledge graph backed by the entities and facts tables.
 *
 * Entity ID format:
 *   - Project-scoped:  `{project}:{type}:{normalized_name}`
 *   - Global:          `_global:{type}:{normalized_name}`
 */
export class KnowledgeGraphService {
  constructor(private db: Database) {}

  // ---------------------------------------------------------------------------
  // Entity CRUD
  // ---------------------------------------------------------------------------

  /**
   * Insert or update an entity. Updates name, type, properties, and last_seen_at.
   * Sets first_seen_at only on initial insert.
   */
  upsertEntity(id: string, name: string, type: string, properties?: Record<string, unknown>): void {
    const now = new Date().toISOString();
    const propsJson = JSON.stringify(properties ?? {});

    // Check if already exists to preserve first_seen_at
    const existing = this.db
      .prepare('SELECT id FROM entities WHERE id = ?')
      .get(id) as { id: string } | null;

    if (existing) {
      this.db
        .prepare(
          'UPDATE entities SET name = ?, type = ?, properties = ?, last_seen_at = ? WHERE id = ?'
        )
        .run(name, type, propsJson, now, id);
    } else {
      this.db
        .prepare(
          'INSERT INTO entities (id, name, type, properties, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(id, name, type, propsJson, now, now);
    }
  }

  /**
   * Retrieve a single entity by its ID. Returns null when not found.
   */
  getEntity(id: string): EntityRow | null {
    const row = this.db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as EntityRow | null;
    return row ?? null;
  }

  /**
   * Retrieve all entities of a given type.
   */
  getEntitiesByType(type: string): EntityRow[] {
    return this.db
      .prepare('SELECT * FROM entities WHERE type = ? ORDER BY name')
      .all(type) as EntityRow[];
  }

  // ---------------------------------------------------------------------------
  // Fact CRUD
  // ---------------------------------------------------------------------------

  /**
   * Add a new fact to the graph. The subject and object must be entity IDs.
   */
  addFact(
    id: string,
    subject: string,
    predicate: string,
    object: string,
    confidence: number = 1.0,
    sourceObservationId?: number
  ): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO facts
           (id, subject, predicate, object, confidence, source_observation_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, subject, predicate, object, confidence, sourceObservationId ?? null);
  }

  /**
   * Retrieve all facts where the given entity appears as subject or object.
   */
  getFactsForEntity(entityId: string): FactRow[] {
    return this.db
      .prepare(
        'SELECT * FROM facts WHERE subject = ? OR object = ? ORDER BY created_at DESC'
      )
      .all(entityId, entityId) as FactRow[];
  }

  /**
   * Retrieve all facts with a given predicate.
   */
  getFactsByPredicate(predicate: string): FactRow[] {
    return this.db
      .prepare('SELECT * FROM facts WHERE predicate = ? ORDER BY created_at DESC')
      .all(predicate) as FactRow[];
  }

  // ---------------------------------------------------------------------------
  // Temporal query
  // ---------------------------------------------------------------------------

  /**
   * Return facts for an entity that are valid at the given date.
   * A fact is valid when:
   *   valid_from IS NULL OR valid_from <= date
   *   AND (valid_to IS NULL OR valid_to > date)
   */
  getFactsValidAt(entityId: string, date: Date): FactRow[] {
    const iso = date.toISOString();
    return this.db
      .prepare(
        `SELECT * FROM facts
         WHERE (subject = ? OR object = ?)
           AND (valid_from IS NULL OR valid_from <= ?)
           AND (valid_to IS NULL OR valid_to > ?)
         ORDER BY created_at DESC`
      )
      .all(entityId, entityId, iso, iso) as FactRow[];
  }

  // ---------------------------------------------------------------------------
  // Entity resolution
  // ---------------------------------------------------------------------------

  /**
   * Derive a deterministic entity ID from project, type, and name.
   *
   * - Global entities:          `_global:{type}:{normalized}`
   * - Project-scoped entities:  `{project}:{type}:{normalized}`
   *
   * Normalization: lowercase, trim, collapse whitespace to underscores.
   */
  resolveEntityId(project: string, type: string, name: string, isGlobal: boolean = false): string {
    const normalized = name.trim().toLowerCase().replace(/\s+/g, '_');
    return isGlobal ? `_global:${type}:${normalized}` : `${project}:${type}:${normalized}`;
  }
}
