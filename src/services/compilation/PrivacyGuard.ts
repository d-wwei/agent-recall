/**
 * PrivacyGuard — filters observations containing <private> tags before compilation.
 *
 * Any observation whose narrative, title, or any fact contains a `<private>` tag
 * (case-insensitive) is excluded from the compilation pipeline.
 */

export interface ObservationRecord {
  id: number;
  narrative?: string | null;
  title?: string | null;
  facts?: string | string[] | null;
  type?: string;
  concepts?: string[];
  project?: string;
}

export class PrivacyGuard {
  filterForCompilation(observations: any[]): any[] {
    return observations.filter(obs => !this.isPrivate(obs));
  }

  isPrivate(observation: any): boolean {
    const privatePattern = /<private>/i;

    if (observation.narrative && privatePattern.test(observation.narrative)) return true;
    if (observation.title && privatePattern.test(observation.title)) return true;

    // facts is stored as JSON string or already-parsed array
    if (observation.facts) {
      try {
        const facts =
          typeof observation.facts === 'string'
            ? JSON.parse(observation.facts)
            : observation.facts;
        if (Array.isArray(facts) && facts.some((f: string) => privatePattern.test(f))) return true;
      } catch {
        // malformed JSON — skip silently
      }
    }

    return false;
  }
}
