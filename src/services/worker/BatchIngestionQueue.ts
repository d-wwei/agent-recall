export interface QueuedItem {
  toolName: string;
  toolInput: any;
  toolOutput: any;
  timestamp: number;
  sessionId: string;
  project: string;
}

export class BatchIngestionQueue {
  private queue: QueuedItem[] = [];
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  private windowStart: number = 0;

  private static INITIAL_WINDOW_MS = 10_000;
  private static EXTENSION_MS = 5_000;
  private static MAX_WINDOW_MS = 45_000;

  constructor(private onFlush: (items: QueuedItem[]) => void | Promise<void>) {}

  add(item: QueuedItem): void {
    this.queue.push(item);
    const now = Date.now();

    if (this.windowTimer === null) {
      // First item — start initial window
      this.windowStart = now;
      this.windowTimer = setTimeout(() => this.flush(), BatchIngestionQueue.INITIAL_WINDOW_MS);
    } else {
      // Subsequent item — extend window (up to max)
      clearTimeout(this.windowTimer);
      const elapsed = now - this.windowStart;
      const remaining = Math.min(
        BatchIngestionQueue.EXTENSION_MS,
        BatchIngestionQueue.MAX_WINDOW_MS - elapsed
      );
      if (remaining > 0) {
        this.windowTimer = setTimeout(() => this.flush(), remaining);
      } else {
        this.flush(); // Max window reached
      }
    }
  }

  flush(): void {
    if (this.windowTimer !== null) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }

    if (this.queue.length === 0) {
      return;
    }

    const items = this.queue.slice();
    this.queue = [];
    this.windowStart = 0;

    void this.onFlush(items);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  destroy(): void {
    if (this.windowTimer !== null) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
    this.queue = [];
    this.windowStart = 0;
  }
}
