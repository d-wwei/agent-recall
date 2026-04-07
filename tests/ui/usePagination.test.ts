/**
 * Tests for usePagination hook logic
 *
 * Tests the pagination state machine: offset tracking, filter change resets,
 * concurrent request prevention, and URL parameter construction.
 */
import { describe, it, expect } from 'bun:test';
import { UI } from '../../src/ui/viewer/constants/ui';
import { API_ENDPOINTS } from '../../src/ui/viewer/constants/api';

describe('usePagination - constants', () => {
  it('should have page size of 50', () => {
    expect(UI.PAGINATION_PAGE_SIZE).toBe(50);
  });

  it('should have load more threshold of 0.1', () => {
    expect(UI.LOAD_MORE_THRESHOLD).toBe(0.1);
  });
});

describe('usePagination - API endpoints', () => {
  it('should target observations endpoint', () => {
    expect(API_ENDPOINTS.OBSERVATIONS).toBe('/api/observations');
  });

  it('should target summaries endpoint', () => {
    expect(API_ENDPOINTS.SUMMARIES).toBe('/api/summaries');
  });

  it('should target prompts endpoint', () => {
    expect(API_ENDPOINTS.PROMPTS).toBe('/api/prompts');
  });
});

describe('usePagination - URL construction', () => {
  /**
   * The hook constructs query params with offset, limit, and optional project filter.
   */

  function buildQueryParams(offset: number, limit: number, project?: string): string {
    const params = new URLSearchParams({
      offset: offset.toString(),
      limit: limit.toString(),
    });
    if (project) {
      params.append('project', project);
    }
    return params.toString();
  }

  it('should build params without project filter', () => {
    const qs = buildQueryParams(0, 50);
    expect(qs).toContain('offset=0');
    expect(qs).toContain('limit=50');
    expect(qs).not.toContain('project');
  });

  it('should include project filter when set', () => {
    const qs = buildQueryParams(0, 50, 'my-project');
    expect(qs).toContain('offset=0');
    expect(qs).toContain('limit=50');
    expect(qs).toContain('project=my-project');
  });

  it('should URL-encode special characters in project name', () => {
    const qs = buildQueryParams(0, 50, 'my project/sub');
    expect(qs).toContain('project=my+project%2Fsub');
  });

  it('should increment offset by page size after each load', () => {
    let offset = 0;
    // Simulate first page load
    const qs1 = buildQueryParams(offset, UI.PAGINATION_PAGE_SIZE);
    expect(qs1).toContain('offset=0');
    offset += UI.PAGINATION_PAGE_SIZE;

    // Simulate second page load
    const qs2 = buildQueryParams(offset, UI.PAGINATION_PAGE_SIZE);
    expect(qs2).toContain('offset=50');
    offset += UI.PAGINATION_PAGE_SIZE;

    // Third page
    const qs3 = buildQueryParams(offset, UI.PAGINATION_PAGE_SIZE);
    expect(qs3).toContain('offset=100');
  });
});

describe('usePagination - state machine', () => {
  interface PaginationState {
    isLoading: boolean;
    hasMore: boolean;
    offset: number;
    lastFilter: string;
  }

  function createInitialState(filter: string): PaginationState {
    return { isLoading: false, hasMore: true, offset: 0, lastFilter: filter };
  }

  function shouldSkipLoad(state: PaginationState, filterChanged: boolean): boolean {
    // Skip if already loading or no more data (unless filter just changed)
    if (!filterChanged && (state.isLoading || !state.hasMore)) {
      return true;
    }
    return false;
  }

  function resetForFilterChange(state: PaginationState, newFilter: string): PaginationState {
    return {
      isLoading: false,
      hasMore: true,
      offset: 0,
      lastFilter: newFilter,
    };
  }

  function afterSuccessfulLoad(state: PaginationState, hasMore: boolean, pageSize: number): PaginationState {
    return {
      ...state,
      isLoading: false,
      hasMore,
      offset: state.offset + pageSize,
    };
  }

  it('should start with hasMore=true and offset=0', () => {
    const state = createInitialState('');
    expect(state.hasMore).toBe(true);
    expect(state.offset).toBe(0);
    expect(state.isLoading).toBe(false);
  });

  it('should allow loading when state is idle and hasMore', () => {
    const state = createInitialState('');
    expect(shouldSkipLoad(state, false)).toBe(false);
  });

  it('should skip loading when already loading', () => {
    const state = { ...createInitialState(''), isLoading: true };
    expect(shouldSkipLoad(state, false)).toBe(true);
  });

  it('should skip loading when no more data', () => {
    const state = { ...createInitialState(''), hasMore: false };
    expect(shouldSkipLoad(state, false)).toBe(true);
  });

  it('should NOT skip loading when filter changed (even if isLoading)', () => {
    const state = { ...createInitialState(''), isLoading: true };
    expect(shouldSkipLoad(state, true)).toBe(false);
  });

  it('should NOT skip loading when filter changed (even if !hasMore)', () => {
    const state = { ...createInitialState(''), hasMore: false };
    expect(shouldSkipLoad(state, true)).toBe(false);
  });

  it('should reset offset and hasMore when filter changes', () => {
    const oldState = { isLoading: false, hasMore: false, offset: 150, lastFilter: 'old-proj' };
    const newState = resetForFilterChange(oldState, 'new-proj');
    expect(newState.offset).toBe(0);
    expect(newState.hasMore).toBe(true);
    expect(newState.lastFilter).toBe('new-proj');
  });

  it('should increment offset after successful load', () => {
    const state = createInitialState('');
    const after = afterSuccessfulLoad(state, true, 50);
    expect(after.offset).toBe(50);
    expect(after.hasMore).toBe(true);
  });

  it('should set hasMore=false when API says no more', () => {
    const state = createInitialState('');
    const after = afterSuccessfulLoad(state, false, 50);
    expect(after.hasMore).toBe(false);
  });

  it('should handle complete pagination lifecycle', () => {
    let state = createInitialState('');

    // Load page 1 (50 items, has more)
    state = afterSuccessfulLoad(state, true, 50);
    expect(state.offset).toBe(50);
    expect(state.hasMore).toBe(true);

    // Load page 2 (50 items, has more)
    state = afterSuccessfulLoad(state, true, 50);
    expect(state.offset).toBe(100);

    // Load page 3 (last page)
    state = afterSuccessfulLoad(state, false, 50);
    expect(state.offset).toBe(150);
    expect(state.hasMore).toBe(false);

    // Should skip further loads
    expect(shouldSkipLoad(state, false)).toBe(true);

    // But filter change resets everything
    state = resetForFilterChange(state, 'new-project');
    expect(state.offset).toBe(0);
    expect(state.hasMore).toBe(true);
    expect(shouldSkipLoad(state, false)).toBe(false);
  });
});
