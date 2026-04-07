/**
 * Tests for viewer type definitions and type guards
 *
 * Validates that data structures conform to expected shapes and that
 * the type discriminator (itemType) correctly identifies feed item types.
 */
import { describe, it, expect } from 'bun:test';
import type { Observation, Summary, UserPrompt, FeedItem, StreamEvent, Settings } from '../../src/ui/viewer/types';

describe('FeedItem type discrimination', () => {
  const mockObservation: Observation = {
    id: 1,
    memory_session_id: 'sess-1',
    project: 'test',
    type: 'tool_use',
    title: 'Read file',
    subtitle: 'Read main.ts',
    narrative: 'User read the main entry point',
    text: null,
    facts: null,
    concepts: null,
    files_read: '["main.ts"]',
    files_modified: null,
    prompt_number: 1,
    created_at: '2024-01-01T00:00:00Z',
    created_at_epoch: 1704067200000,
  };

  const mockSummary: Summary = {
    id: 1,
    session_id: 'sess-1',
    project: 'test',
    request: 'Fix authentication',
    investigated: 'OAuth tokens',
    learned: 'Token refresh flow',
    completed: 'Fixed the refresh',
    next_steps: 'Deploy to staging',
    created_at_epoch: 1704067200000,
  };

  const mockPrompt: UserPrompt = {
    id: 1,
    content_session_id: 'sess-1',
    project: 'test',
    prompt_number: 1,
    prompt_text: 'Help me debug',
    created_at_epoch: 1704067200000,
  };

  it('should create observation FeedItem with correct itemType', () => {
    const feedItem: FeedItem = { ...mockObservation, itemType: 'observation' };
    expect(feedItem.itemType).toBe('observation');
    expect(feedItem.id).toBe(1);
  });

  it('should create summary FeedItem with correct itemType', () => {
    const feedItem: FeedItem = { ...mockSummary, itemType: 'summary' };
    expect(feedItem.itemType).toBe('summary');
  });

  it('should create prompt FeedItem with correct itemType', () => {
    const feedItem: FeedItem = { ...mockPrompt, itemType: 'prompt' };
    expect(feedItem.itemType).toBe('prompt');
  });

  it('should allow discriminating FeedItem types at runtime', () => {
    const items: FeedItem[] = [
      { ...mockObservation, itemType: 'observation' },
      { ...mockSummary, itemType: 'summary' },
      { ...mockPrompt, itemType: 'prompt' },
    ];

    for (const item of items) {
      switch (item.itemType) {
        case 'observation':
          expect(item.memory_session_id).toBe('sess-1');
          expect(item.type).toBe('tool_use');
          break;
        case 'summary':
          expect(item.session_id).toBe('sess-1');
          expect(item.request).toBe('Fix authentication');
          break;
        case 'prompt':
          expect(item.content_session_id).toBe('sess-1');
          expect(item.prompt_text).toBe('Help me debug');
          break;
      }
    }
  });
});

describe('Observation - JSON field parsing', () => {
  /**
   * Several Observation fields are stored as JSON strings in SQLite
   * and must be parsed before use in the UI.
   */

  it('should parse facts JSON string', () => {
    const factsJson = '["TypeScript supports generics","React uses virtual DOM"]';
    const facts: string[] = JSON.parse(factsJson);
    expect(facts).toHaveLength(2);
    expect(facts[0]).toBe('TypeScript supports generics');
  });

  it('should parse concepts JSON string', () => {
    const conceptsJson = '["authentication","OAuth","JWT"]';
    const concepts: string[] = JSON.parse(conceptsJson);
    expect(concepts).toHaveLength(3);
    expect(concepts).toContain('JWT');
  });

  it('should parse files_read JSON string', () => {
    const filesJson = '["/src/auth.ts","/src/middleware.ts"]';
    const files: string[] = JSON.parse(filesJson);
    expect(files).toHaveLength(2);
  });

  it('should handle null JSON fields gracefully', () => {
    const observation: Observation = {
      id: 1,
      memory_session_id: 'sess-1',
      project: 'test',
      type: 'tool_use',
      title: 'Test',
      subtitle: null,
      narrative: null,
      text: null,
      facts: null,
      concepts: null,
      files_read: null,
      files_modified: null,
      prompt_number: null,
      created_at: '2024-01-01T00:00:00Z',
      created_at_epoch: 1704067200000,
    };

    const facts = observation.facts ? JSON.parse(observation.facts) : [];
    const concepts = observation.concepts ? JSON.parse(observation.concepts) : [];
    const filesRead = observation.files_read ? JSON.parse(observation.files_read) : [];
    const filesModified = observation.files_modified ? JSON.parse(observation.files_modified) : [];

    expect(facts).toEqual([]);
    expect(concepts).toEqual([]);
    expect(filesRead).toEqual([]);
    expect(filesModified).toEqual([]);
  });
});

describe('StreamEvent - all event types', () => {
  it('should support initial_load type', () => {
    const event: StreamEvent = {
      type: 'initial_load',
      projects: ['proj-a', 'proj-b'],
    };
    expect(event.type).toBe('initial_load');
    expect(event.projects).toHaveLength(2);
  });

  it('should support new_observation type', () => {
    const event: StreamEvent = {
      type: 'new_observation',
      observation: {
        id: 1,
        memory_session_id: 'sess-1',
        project: 'test',
        type: 'tool_use',
        title: 'Test',
        subtitle: null,
        narrative: null,
        text: null,
        facts: null,
        concepts: null,
        files_read: null,
        files_modified: null,
        prompt_number: 1,
        created_at: '2024-01-01T00:00:00Z',
        created_at_epoch: 1704067200000,
      },
    };
    expect(event.type).toBe('new_observation');
    expect(event.observation?.id).toBe(1);
  });

  it('should support processing_status type', () => {
    const event: StreamEvent = {
      type: 'processing_status',
      isProcessing: true,
      queueDepth: 5,
    };
    expect(event.isProcessing).toBe(true);
    expect(event.queueDepth).toBe(5);
  });
});

describe('Summary - optional fields', () => {
  it('should work with minimal summary (only required fields)', () => {
    const summary: Summary = {
      id: 1,
      session_id: 'sess-1',
      project: 'test',
      created_at_epoch: 1704067200000,
    };
    expect(summary.request).toBeUndefined();
    expect(summary.investigated).toBeUndefined();
    expect(summary.learned).toBeUndefined();
    expect(summary.completed).toBeUndefined();
    expect(summary.next_steps).toBeUndefined();
  });

  it('should work with all fields populated', () => {
    const summary: Summary = {
      id: 1,
      session_id: 'sess-1',
      project: 'test',
      request: 'Build feature X',
      investigated: 'Looked at approach A and B',
      learned: 'Approach A is better because...',
      completed: 'Implemented approach A',
      next_steps: 'Add tests and deploy',
      created_at_epoch: 1704067200000,
    };
    expect(summary.request).toBeTruthy();
    expect(summary.investigated).toBeTruthy();
    expect(summary.learned).toBeTruthy();
    expect(summary.completed).toBeTruthy();
    expect(summary.next_steps).toBeTruthy();
  });

  it('should filter sections with content (SummaryCard behavior)', () => {
    const summary: Summary = {
      id: 1,
      session_id: 'sess-1',
      project: 'test',
      investigated: 'Only this section has content',
      created_at_epoch: 1704067200000,
    };

    const sections = [
      { key: 'investigated', label: 'Investigated', content: summary.investigated },
      { key: 'learned', label: 'Learned', content: summary.learned },
      { key: 'completed', label: 'Completed', content: summary.completed },
      { key: 'next_steps', label: 'Next Steps', content: summary.next_steps },
    ].filter(s => s.content);

    expect(sections).toHaveLength(1);
    expect(sections[0].key).toBe('investigated');
  });
});
