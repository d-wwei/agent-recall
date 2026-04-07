/**
 * Tests for the mergeAndDeduplicateByProject utility function
 *
 * This is the core data merge logic used when combining SSE live data
 * with paginated API data. Pure function, no React dependency.
 */
import { describe, it, expect } from 'bun:test';
import { mergeAndDeduplicateByProject } from '../../src/ui/viewer/utils/data';

describe('mergeAndDeduplicateByProject', () => {
  it('should return empty array when both inputs are empty', () => {
    const result = mergeAndDeduplicateByProject([], []);
    expect(result).toEqual([]);
  });

  it('should return live items when paginated is empty', () => {
    const live = [
      { id: 1, project: 'proj-a' },
      { id: 2, project: 'proj-b' },
    ];
    const result = mergeAndDeduplicateByProject(live, []);
    expect(result).toEqual(live);
  });

  it('should return paginated items when live is empty', () => {
    const paginated = [
      { id: 10, project: 'proj-a' },
      { id: 11, project: 'proj-b' },
    ];
    const result = mergeAndDeduplicateByProject([], paginated);
    expect(result).toEqual(paginated);
  });

  it('should merge without duplicates when no IDs overlap', () => {
    const live = [{ id: 1, project: 'proj-a' }];
    const paginated = [{ id: 2, project: 'proj-a' }];
    const result = mergeAndDeduplicateByProject(live, paginated);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.id)).toEqual([1, 2]);
  });

  it('should deduplicate by id, keeping live item over paginated', () => {
    const live = [{ id: 5, project: 'proj-a' }];
    const paginated = [{ id: 5, project: 'proj-a' }];
    const result = mergeAndDeduplicateByProject(live, paginated);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(5);
  });

  it('should prioritize live items (appear first in output)', () => {
    const live = [
      { id: 3, project: 'proj-a', extra: 'live-version' },
    ] as any[];
    const paginated = [
      { id: 3, project: 'proj-a', extra: 'paginated-version' },
      { id: 4, project: 'proj-a' },
    ] as any[];
    const result = mergeAndDeduplicateByProject(live, paginated);
    expect(result).toHaveLength(2);
    // The live version should be kept (first occurrence wins)
    expect(result[0].extra).toBe('live-version');
    expect(result[1].id).toBe(4);
  });

  it('should handle many duplicates', () => {
    const live = [
      { id: 1, project: 'a' },
      { id: 2, project: 'a' },
      { id: 3, project: 'a' },
    ];
    const paginated = [
      { id: 2, project: 'a' },
      { id: 3, project: 'a' },
      { id: 4, project: 'a' },
      { id: 5, project: 'a' },
    ];
    const result = mergeAndDeduplicateByProject(live, paginated);
    expect(result).toHaveLength(5);
    expect(result.map(r => r.id)).toEqual([1, 2, 3, 4, 5]);
  });

  it('should work with items that have optional project field', () => {
    const live = [{ id: 1 }] as { id: number; project?: string }[];
    const paginated = [{ id: 2, project: 'proj-a' }];
    const result = mergeAndDeduplicateByProject(live, paginated);
    expect(result).toHaveLength(2);
  });
});
