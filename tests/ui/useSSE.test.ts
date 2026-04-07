/**
 * Tests for useSSE hook logic
 *
 * Tests the SSE event dispatch logic that processes incoming stream events
 * and updates the appropriate state arrays (observations, summaries, prompts).
 *
 * No real EventSource needed - we test the event handling logic in isolation.
 */
import { describe, it, expect } from 'bun:test';
import type { StreamEvent, Observation, Summary, UserPrompt } from '../../src/ui/viewer/types';
import { API_ENDPOINTS } from '../../src/ui/viewer/constants/api';
import { TIMING } from '../../src/ui/viewer/constants/timing';

describe('useSSE - stream endpoint', () => {
  it('should use /stream endpoint', () => {
    expect(API_ENDPOINTS.STREAM).toBe('/stream');
  });
});

describe('useSSE - reconnection timing', () => {
  it('should reconnect after 3 seconds', () => {
    expect(TIMING.SSE_RECONNECT_DELAY_MS).toBe(3000);
  });
});

describe('useSSE - event dispatch logic', () => {
  /**
   * Simulates the switch/case dispatch in useSSE's onmessage handler.
   * This is the core logic that decides how each event type updates state.
   */
  interface SSEState {
    observations: Observation[];
    summaries: Summary[];
    prompts: UserPrompt[];
    projects: string[];
    isProcessing: boolean;
    queueDepth: number;
    isConnected: boolean;
  }

  function createInitialState(): SSEState {
    return {
      observations: [],
      summaries: [],
      prompts: [],
      projects: [],
      isProcessing: false,
      queueDepth: 0,
      isConnected: false,
    };
  }

  function processEvent(state: SSEState, event: StreamEvent): SSEState {
    const newState = { ...state };

    switch (event.type) {
      case 'initial_load':
        newState.projects = event.projects || [];
        break;

      case 'new_observation':
        if (event.observation) {
          newState.observations = [event.observation, ...state.observations];
        }
        break;

      case 'new_summary':
        if (event.summary) {
          newState.summaries = [event.summary, ...state.summaries];
        }
        break;

      case 'new_prompt':
        if (event.prompt) {
          newState.prompts = [event.prompt, ...state.prompts];
        }
        break;

      case 'processing_status':
        if (typeof event.isProcessing === 'boolean') {
          newState.isProcessing = event.isProcessing;
          newState.queueDepth = event.queueDepth || 0;
        }
        break;
    }

    return newState;
  }

  const mockObservation: Observation = {
    id: 1,
    memory_session_id: 'sess-1',
    project: 'test-project',
    type: 'tool_use',
    title: 'Read file',
    subtitle: 'Read config.ts',
    narrative: 'Read the configuration file to understand settings',
    text: null,
    facts: null,
    concepts: null,
    files_read: '["config.ts"]',
    files_modified: null,
    prompt_number: 1,
    created_at: '2024-01-01T00:00:00Z',
    created_at_epoch: 1704067200000,
  };

  const mockSummary: Summary = {
    id: 1,
    session_id: 'sess-1',
    project: 'test-project',
    request: 'Fix auth bug',
    investigated: 'OAuth token refresh',
    completed: 'Fixed the token refresh logic',
    created_at_epoch: 1704067200000,
  };

  const mockPrompt: UserPrompt = {
    id: 1,
    content_session_id: 'sess-1',
    project: 'test-project',
    prompt_number: 1,
    prompt_text: 'Help me debug this auth issue',
    created_at_epoch: 1704067200000,
  };

  describe('initial_load event', () => {
    it('should set projects from initial load', () => {
      const state = createInitialState();
      const event: StreamEvent = {
        type: 'initial_load',
        projects: ['proj-a', 'proj-b', 'proj-c'],
      };
      const newState = processEvent(state, event);
      expect(newState.projects).toEqual(['proj-a', 'proj-b', 'proj-c']);
    });

    it('should handle initial load with no projects', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'initial_load' };
      const newState = processEvent(state, event);
      expect(newState.projects).toEqual([]);
    });

    it('should not affect observations/summaries/prompts', () => {
      const state = createInitialState();
      state.observations = [mockObservation];
      const event: StreamEvent = { type: 'initial_load', projects: ['proj-a'] };
      const newState = processEvent(state, event);
      expect(newState.observations).toHaveLength(1);
    });
  });

  describe('new_observation event', () => {
    it('should prepend new observation to list', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'new_observation', observation: mockObservation };
      const newState = processEvent(state, event);
      expect(newState.observations).toHaveLength(1);
      expect(newState.observations[0].id).toBe(1);
    });

    it('should prepend (not append) - newest first', () => {
      const state = createInitialState();
      state.observations = [{ ...mockObservation, id: 100 }];

      const event: StreamEvent = {
        type: 'new_observation',
        observation: { ...mockObservation, id: 200 },
      };
      const newState = processEvent(state, event);
      expect(newState.observations).toHaveLength(2);
      expect(newState.observations[0].id).toBe(200); // new one first
      expect(newState.observations[1].id).toBe(100);
    });

    it('should ignore event if observation is undefined', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'new_observation' };
      const newState = processEvent(state, event);
      expect(newState.observations).toHaveLength(0);
    });
  });

  describe('new_summary event', () => {
    it('should prepend new summary to list', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'new_summary', summary: mockSummary };
      const newState = processEvent(state, event);
      expect(newState.summaries).toHaveLength(1);
      expect(newState.summaries[0].request).toBe('Fix auth bug');
    });

    it('should ignore event if summary is undefined', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'new_summary' };
      const newState = processEvent(state, event);
      expect(newState.summaries).toHaveLength(0);
    });
  });

  describe('new_prompt event', () => {
    it('should prepend new prompt to list', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'new_prompt', prompt: mockPrompt };
      const newState = processEvent(state, event);
      expect(newState.prompts).toHaveLength(1);
      expect(newState.prompts[0].prompt_text).toBe('Help me debug this auth issue');
    });

    it('should ignore event if prompt is undefined', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'new_prompt' };
      const newState = processEvent(state, event);
      expect(newState.prompts).toHaveLength(0);
    });
  });

  describe('processing_status event', () => {
    it('should update processing state', () => {
      const state = createInitialState();
      const event: StreamEvent = {
        type: 'processing_status',
        isProcessing: true,
        queueDepth: 3,
      };
      const newState = processEvent(state, event);
      expect(newState.isProcessing).toBe(true);
      expect(newState.queueDepth).toBe(3);
    });

    it('should set queueDepth to 0 when not provided', () => {
      const state = createInitialState();
      const event: StreamEvent = {
        type: 'processing_status',
        isProcessing: true,
      };
      const newState = processEvent(state, event);
      expect(newState.isProcessing).toBe(true);
      expect(newState.queueDepth).toBe(0);
    });

    it('should handle processing complete', () => {
      const state = { ...createInitialState(), isProcessing: true, queueDepth: 5 };
      const event: StreamEvent = {
        type: 'processing_status',
        isProcessing: false,
        queueDepth: 0,
      };
      const newState = processEvent(state, event);
      expect(newState.isProcessing).toBe(false);
      expect(newState.queueDepth).toBe(0);
    });

    it('should ignore if isProcessing is not a boolean', () => {
      const state = createInitialState();
      const event: StreamEvent = { type: 'processing_status' };
      const newState = processEvent(state, event);
      // State should be unchanged
      expect(newState.isProcessing).toBe(false);
      expect(newState.queueDepth).toBe(0);
    });
  });

  describe('sequential event processing', () => {
    it('should accumulate observations over multiple events', () => {
      let state = createInitialState();

      for (let i = 1; i <= 5; i++) {
        state = processEvent(state, {
          type: 'new_observation',
          observation: { ...mockObservation, id: i },
        });
      }

      expect(state.observations).toHaveLength(5);
      // Most recent should be first
      expect(state.observations[0].id).toBe(5);
      expect(state.observations[4].id).toBe(1);
    });

    it('should handle mixed event types in sequence', () => {
      let state = createInitialState();

      state = processEvent(state, { type: 'initial_load', projects: ['proj'] });
      state = processEvent(state, { type: 'new_observation', observation: mockObservation });
      state = processEvent(state, { type: 'new_summary', summary: mockSummary });
      state = processEvent(state, { type: 'new_prompt', prompt: mockPrompt });
      state = processEvent(state, { type: 'processing_status', isProcessing: true, queueDepth: 2 });

      expect(state.projects).toEqual(['proj']);
      expect(state.observations).toHaveLength(1);
      expect(state.summaries).toHaveLength(1);
      expect(state.prompts).toHaveLength(1);
      expect(state.isProcessing).toBe(true);
      expect(state.queueDepth).toBe(2);
    });
  });
});
