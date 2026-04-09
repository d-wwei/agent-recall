import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { BatchIngestionQueue, type QueuedItem } from '../../src/services/worker/BatchIngestionQueue.js';

function makeItem(overrides: Partial<QueuedItem> = {}): QueuedItem {
  return {
    toolName: 'Read',
    toolInput: { file: 'test.ts' },
    toolOutput: 'file contents',
    timestamp: Date.now(),
    sessionId: 'session-1',
    project: '/test/project',
    ...overrides,
  };
}

describe('BatchIngestionQueue', () => {
  describe('getQueueSize', () => {
    it('returns 0 when queue is empty', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));
      expect(queue.getQueueSize()).toBe(0);
      queue.destroy();
    });

    it('returns correct count after adding items', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));
      queue.add(makeItem());
      expect(queue.getQueueSize()).toBe(1);
      queue.add(makeItem());
      queue.add(makeItem());
      expect(queue.getQueueSize()).toBe(3);
      queue.destroy();
    });

    it('returns 0 after flush', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));
      queue.add(makeItem());
      queue.add(makeItem());
      queue.flush();
      expect(queue.getQueueSize()).toBe(0);
    });
  });

  describe('manual flush', () => {
    it('calls onFlush with all queued items', () => {
      const received: QueuedItem[][] = [];
      const onFlush = mock((items: QueuedItem[]) => { received.push(items); });
      const queue = new BatchIngestionQueue(onFlush);

      const item1 = makeItem({ toolName: 'Read' });
      const item2 = makeItem({ toolName: 'Write' });
      const item3 = makeItem({ toolName: 'Bash' });

      queue.add(item1);
      queue.add(item2);
      queue.add(item3);
      queue.flush();

      expect(onFlush).toHaveBeenCalledTimes(1);
      expect(received[0]).toHaveLength(3);
      expect(received[0][0]).toEqual(item1);
      expect(received[0][1]).toEqual(item2);
      expect(received[0][2]).toEqual(item3);
    });

    it('clears the queue after flush', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));
      queue.add(makeItem());
      queue.add(makeItem());
      queue.flush();
      expect(queue.getQueueSize()).toBe(0);
    });

    it('does not call onFlush when queue is empty', () => {
      const onFlush = mock(() => {});
      const queue = new BatchIngestionQueue(onFlush);
      queue.flush();
      expect(onFlush).not.toHaveBeenCalled();
    });

    it('can flush multiple independent batches', () => {
      const received: QueuedItem[][] = [];
      const onFlush = mock((items: QueuedItem[]) => { received.push(items); });
      const queue = new BatchIngestionQueue(onFlush);

      queue.add(makeItem({ toolName: 'Read' }));
      queue.flush();

      queue.add(makeItem({ toolName: 'Write' }));
      queue.add(makeItem({ toolName: 'Bash' }));
      queue.flush();

      expect(onFlush).toHaveBeenCalledTimes(2);
      expect(received[0]).toHaveLength(1);
      expect(received[1]).toHaveLength(2);
    });

    it('resets queue so new items start a fresh batch', () => {
      const received: QueuedItem[][] = [];
      const onFlush = mock((items: QueuedItem[]) => { received.push(items); });
      const queue = new BatchIngestionQueue(onFlush);

      queue.add(makeItem({ toolName: 'first' }));
      queue.flush();

      queue.add(makeItem({ toolName: 'second' }));
      queue.flush();

      expect(received[0][0].toolName).toBe('first');
      expect(received[1][0].toolName).toBe('second');
    });
  });

  describe('item data integrity', () => {
    it('preserves all fields of queued items', () => {
      let flushed: QueuedItem[] = [];
      const queue = new BatchIngestionQueue((items) => { flushed = items; });

      const item = makeItem({
        toolName: 'Glob',
        toolInput: { pattern: '**/*.ts' },
        toolOutput: ['a.ts', 'b.ts'],
        timestamp: 1234567890,
        sessionId: 'my-session',
        project: '/my/project',
      });

      queue.add(item);
      queue.flush();

      expect(flushed[0]).toEqual(item);
    });

    it('passes items in insertion order', () => {
      let flushed: QueuedItem[] = [];
      const queue = new BatchIngestionQueue((items) => { flushed = items; });

      for (let i = 0; i < 5; i++) {
        queue.add(makeItem({ toolName: `tool-${i}` }));
      }
      queue.flush();

      for (let i = 0; i < 5; i++) {
        expect(flushed[i].toolName).toBe(`tool-${i}`);
      }
    });
  });

  describe('async onFlush', () => {
    it('supports async onFlush without throwing', async () => {
      let resolved = false;
      const onFlush = async (_items: QueuedItem[]) => {
        await Promise.resolve();
        resolved = true;
      };

      const queue = new BatchIngestionQueue(onFlush);
      queue.add(makeItem());
      queue.flush();

      await Promise.resolve(); // allow microtask to run
      expect(resolved).toBe(true);
    });
  });

  describe('destroy', () => {
    it('clears the queue', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));
      queue.add(makeItem());
      queue.add(makeItem());
      queue.destroy();
      expect(queue.getQueueSize()).toBe(0);
    });

    it('does not call onFlush when destroyed', () => {
      const onFlush = mock(() => {});
      const queue = new BatchIngestionQueue(onFlush);
      queue.add(makeItem());
      queue.destroy();
      expect(onFlush).not.toHaveBeenCalled();
    });

    it('cancels pending timer so flush is not called after destroy', async () => {
      const onFlush = mock(() => {});
      const queue = new BatchIngestionQueue(onFlush);
      queue.add(makeItem());
      queue.destroy();

      // Give any leaked timer a chance to fire
      await new Promise((r) => setTimeout(r, 50));
      expect(onFlush).not.toHaveBeenCalled();
    });

    it('is safe to call destroy multiple times', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));
      queue.add(makeItem());
      queue.destroy();
      expect(() => queue.destroy()).not.toThrow();
    });
  });

  describe('adaptive window logic (verified via flush)', () => {
    it('starts a new window after queue resets and new item is added', () => {
      const received: QueuedItem[][] = [];
      const onFlush = mock((items: QueuedItem[]) => { received.push(items); });
      const queue = new BatchIngestionQueue(onFlush);

      queue.add(makeItem({ toolName: 'batch1-item1' }));
      queue.flush(); // simulate window close for batch 1

      queue.add(makeItem({ toolName: 'batch2-item1' }));
      queue.add(makeItem({ toolName: 'batch2-item2' }));
      queue.flush(); // simulate window close for batch 2

      expect(received).toHaveLength(2);
      expect(received[0][0].toolName).toBe('batch1-item1');
      expect(received[1]).toHaveLength(2);
    });

    it('accumulates all items until flush even with rapid additions', () => {
      let flushed: QueuedItem[] = [];
      const queue = new BatchIngestionQueue((items) => { flushed = items; });

      for (let i = 0; i < 20; i++) {
        queue.add(makeItem({ toolName: `tool-${i}` }));
      }

      expect(queue.getQueueSize()).toBe(20);
      queue.flush();
      expect(flushed).toHaveLength(20);
      expect(queue.getQueueSize()).toBe(0);
    });

    it('single item is collected and passed to onFlush on manual flush', () => {
      let flushed: QueuedItem[] = [];
      const queue = new BatchIngestionQueue((items) => { flushed = items; });

      const item = makeItem({ toolName: 'solo' });
      queue.add(item);
      queue.flush();

      expect(flushed).toHaveLength(1);
      expect(flushed[0]).toEqual(item);
    });

    it('queue size grows correctly as items are added within a window', () => {
      const queue = new BatchIngestionQueue(mock(() => {}));

      expect(queue.getQueueSize()).toBe(0);
      queue.add(makeItem());
      expect(queue.getQueueSize()).toBe(1);
      queue.add(makeItem());
      expect(queue.getQueueSize()).toBe(2);
      queue.add(makeItem());
      expect(queue.getQueueSize()).toBe(3);

      queue.destroy();
    });

    it('second flush call is a no-op when queue is already empty', () => {
      const onFlush = mock(() => {});
      const queue = new BatchIngestionQueue(onFlush);

      queue.add(makeItem());
      queue.flush();
      queue.flush(); // second flush on empty queue

      expect(onFlush).toHaveBeenCalledTimes(1);
    });
  });
});
