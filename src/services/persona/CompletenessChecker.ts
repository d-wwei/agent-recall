/**
 * CompletenessChecker - Profile completeness and staleness analysis
 *
 * Evaluates how complete a MergedPersona is across all profile types,
 * identifies gaps and missing fields, and detects stale profiles.
 */

import type { MergedPersona } from './PersonaTypes.js';

export interface CompletenessReport {
  percentage: number;       // 0-100
  gaps: string[];           // profile types with no data at all (e.g. 'user', 'style')
  missingFields: string[];  // specific missing required fields (e.g. 'user.name', 'style.tone')
}

export interface StalenessReport {
  staleFields: string[];    // profile types not updated in 90+ days
}

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

interface FieldDefinition {
  field: string;
  required: boolean;
}

const PROFILE_FIELDS: Record<string, FieldDefinition[]> = {
  agent_soul: [
    { field: 'name', required: true },
    { field: 'self_description', required: false },
    { field: 'core_values', required: false },
    { field: 'vibe', required: false },
  ],
  user: [
    { field: 'name', required: true },
    { field: 'role', required: true },
    { field: 'language', required: false },
    { field: 'timezone', required: false },
    { field: 'profession', required: false },
  ],
  style: [
    { field: 'tone', required: true },
    { field: 'brevity', required: false },
    { field: 'formatting', required: false },
    { field: 'output_structure', required: false },
  ],
  workflow: [
    { field: 'preferred_role', required: true },
    { field: 'decision_style', required: false },
    { field: 'recurring_tasks', required: false },
  ],
};

const PROFILE_TYPES = Object.keys(PROFILE_FIELDS) as Array<keyof MergedPersona>;

const STALENESS_THRESHOLD_DAYS = 90;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isProfileEmpty(profile: Record<string, any> | null): boolean {
  if (profile === null || profile === undefined) return true;
  return Object.keys(profile).length === 0;
}

function isFieldFilled(profile: Record<string, any> | null, field: string): boolean {
  if (!profile) return false;
  const value = (profile as Record<string, any>)[field];
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

// ---------------------------------------------------------------------------
// CompletenessChecker
// ---------------------------------------------------------------------------

export class CompletenessChecker {
  /**
   * Evaluate how complete a MergedPersona is.
   *
   * Scoring:
   * - All required + recommended fields across all profile types are counted.
   * - percentage = round(filled / total * 100)
   * - gaps = profile types with NO data at all
   * - missingFields = required fields that are not filled
   */
  check(persona: MergedPersona): CompletenessReport {
    let filled = 0;
    let total = 0;
    const gaps: string[] = [];
    const missingFields: string[] = [];

    for (const profileType of PROFILE_TYPES) {
      const profile = persona[profileType] as Record<string, any> | null;
      const fieldDefs = PROFILE_FIELDS[profileType];

      total += fieldDefs.length;

      if (isProfileEmpty(profile)) {
        gaps.push(profileType);
        // All required fields for this type are missing
        for (const def of fieldDefs) {
          if (def.required) {
            missingFields.push(`${profileType}.${def.field}`);
          }
        }
        continue;
      }

      for (const def of fieldDefs) {
        if (isFieldFilled(profile, def.field)) {
          filled++;
        } else if (def.required) {
          missingFields.push(`${profileType}.${def.field}`);
        }
      }
    }

    const percentage = total === 0 ? 0 : Math.round((filled / total) * 100);

    return { percentage, gaps, missingFields };
  }

  /**
   * Detect profile types whose updated_at is older than 90 days.
   *
   * @param updatedAtMap  map of profile_type → ISO date string
   * @param now           reference date (defaults to current time)
   */
  checkStaleness(
    updatedAtMap: Record<string, string>,
    now: Date = new Date()
  ): StalenessReport {
    const staleFields: string[] = [];
    const thresholdMs = STALENESS_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    for (const [profileType, updatedAt] of Object.entries(updatedAtMap)) {
      if (!updatedAt) continue;
      const updatedDate = new Date(updatedAt);
      if (isNaN(updatedDate.getTime())) continue;
      const ageMs = now.getTime() - updatedDate.getTime();
      if (ageMs > thresholdMs) {
        staleFields.push(profileType);
      }
    }

    return { staleFields };
  }
}
