/**
 * EntityExtractor — auto-populates the knowledge graph (entities + facts)
 * from observation data.
 *
 * Extracts:
 *   - File entities from files_modified / files_read
 *   - Concept entities from the concepts JSON array
 *   - Tool entities from title mentions of known technologies
 *
 * Creates facts linking observations to entities via modifies/reads relations.
 */

import { Database } from 'bun:sqlite';
import { KnowledgeGraphService } from './KnowledgeGraphService.js';

/** Known technologies to extract as tool entities from observation titles. */
const TOOL_PATTERN = /\b(React|TypeScript|SQLite|PostgreSQL|Redis|Docker|JWT|WebSocket|GraphQL|Prisma|Bun|Node|Express|Vite|Webpack|Next|Vue|Angular|Svelte)\b/gi;

export class EntityExtractor {
  private kgService: KnowledgeGraphService;

  constructor(private db: Database) {
    this.kgService = new KnowledgeGraphService(db);
  }

  /**
   * Extract entities and facts from a single observation.
   * Returns counts of entities and facts created/updated.
   */
  extractFromObservation(observation: any, project: string): { entities: number; facts: number } {
    let entityCount = 0;
    let factCount = 0;

    // 1. Extract file entities from files_modified and files_read
    const filesModified = this.parseJsonArray(observation.files_modified) || [];
    const filesRead = this.parseJsonArray(observation.files_read) || [];
    const allFiles = [...filesModified, ...filesRead];

    // Create an entity for the observation itself (so facts can reference it as subject)
    if (allFiles.length > 0) {
      const obsEntityId = this.kgService.resolveEntityId(project, 'observation', String(observation.id));
      this.kgService.upsertEntity(obsEntityId, observation.title || `Observation #${observation.id}`, 'observation');
    }

    for (const file of allFiles) {
      if (typeof file !== 'string' || !file) continue;

      const entityId = this.kgService.resolveEntityId(project, 'file', file);
      this.kgService.upsertEntity(entityId, file, 'file');
      entityCount++;

      // Create fact: observation entity → modifies/reads → file entity
      const relation = filesModified.includes(file) ? 'modifies' : 'reads';
      const obsEntityId = this.kgService.resolveEntityId(project, 'observation', String(observation.id));
      const factId = `${project}:${observation.id}:${relation}:${entityId}`;
      this.kgService.addFact(factId, obsEntityId, relation, entityId, 0.9, observation.id);
      factCount++;
    }

    // 2. Extract concept entities from concepts JSON and create facts
    const concepts = this.parseJsonArray(observation.concepts) || [];
    const conceptEntityIds: string[] = [];
    for (const concept of concepts) {
      if (typeof concept !== 'string' || !concept) continue;

      const entityId = this.kgService.resolveEntityId(project, 'concept', concept);
      this.kgService.upsertEntity(entityId, concept, 'concept');
      conceptEntityIds.push(entityId);
      entityCount++;
    }

    // 2b. Create co-occurrence facts between concepts that appear in the same observation
    for (let i = 0; i < conceptEntityIds.length; i++) {
      for (let j = i + 1; j < conceptEntityIds.length; j++) {
        const [a, b] = conceptEntityIds[i] < conceptEntityIds[j]
          ? [conceptEntityIds[i], conceptEntityIds[j]]
          : [conceptEntityIds[j], conceptEntityIds[i]];
        const factId = `${a}:co_occurs:${b}`;
        this.kgService.addFact(factId, a, 'co_occurs_with', b, 0.8, observation.id);
        factCount++;
      }
    }

    // 2c. Link observation type to concepts (e.g., "discovery" → "react-hooks")
    if (observation.type && conceptEntityIds.length > 0) {
      const obsTypeEntityId = this.kgService.resolveEntityId(project, 'activity', observation.type);
      this.kgService.upsertEntity(obsTypeEntityId, observation.type, 'activity');
      for (const conceptId of conceptEntityIds) {
        const factId = `${obsTypeEntityId}:involves:${conceptId}:${observation.id}`;
        this.kgService.addFact(factId, obsTypeEntityId, 'involves', conceptId, 0.7, observation.id);
        factCount++;
      }
    }

    // 3. Extract tool entities from title
    if (observation.title && typeof observation.title === 'string') {
      const toolMentions = observation.title.match(TOOL_PATTERN);
      if (toolMentions) {
        const uniqueTools = [...new Set(toolMentions.map((t: string) => t))];
        for (const tool of uniqueTools) {
          const entityId = this.kgService.resolveEntityId(project, 'tool', tool, true); // global scope
          this.kgService.upsertEntity(entityId, tool, 'tool');
          entityCount++;
        }
      }
    }

    return { entities: entityCount, facts: factCount };
  }

  /**
   * Extract entities from all observations for a project.
   * Optionally restricted to observations created after sinceEpoch.
   */
  extractFromAllObservations(project: string, sinceEpoch?: number): { entities: number; facts: number } {
    const where = sinceEpoch != null
      ? 'WHERE project = ? AND created_at_epoch > ?'
      : 'WHERE project = ?';
    const params: any[] = sinceEpoch != null ? [project, sinceEpoch] : [project];

    let observations: any[];
    try {
      observations = this.db.prepare(
        `SELECT * FROM observations ${where} ORDER BY created_at_epoch ASC`
      ).all(...params) as any[];
    } catch {
      return { entities: 0, facts: 0 };
    }

    let totalEntities = 0;
    let totalFacts = 0;

    for (const obs of observations) {
      const { entities, facts } = this.extractFromObservation(obs, project);
      totalEntities += entities;
      totalFacts += facts;
    }

    return { entities: totalEntities, facts: totalFacts };
  }

  /**
   * Parse a value that may be a JSON string array, a native array, or null.
   */
  private parseJsonArray(val: any): string[] | null {
    if (!val) return null;
    if (Array.isArray(val)) return val;
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}
