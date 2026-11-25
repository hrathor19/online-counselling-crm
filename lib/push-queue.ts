/**
 * A small in-process work queue with a concurrency cap.
 *
 * A CSV upload or a backfill can ask for thousands of pushes at once. Firing
 * them all together would hammer a college's endpoint (and tie up this
 * server's sockets), so they run a few at a time instead.
 *
 * Stored on globalThis so every route bundle and hot reload shares the one
 * queue — otherwise each would get its own cap.
 */

type Job = () => Promise<void>;

class PushQueue {
  private running = 0;
  private waiting: Job[] = [];

  constructor(private readonly limit: number) {}

  add(job: Job): void {
    this.waiting.push(job);
    this.drain();
  }

  get pending(): number {
    return this.waiting.length + this.running;
  }

  private drain(): void {
    while (this.running < this.limit && this.waiting.length > 0) {
      const job = this.waiting.shift()!;
      this.running += 1;
      job()
        .catch((err) => console.error('[push-queue] job failed', err))
        .finally(() => {
          this.running -= 1;
          this.drain();
        });
    }
  }
}

const g = globalThis as unknown as { __leadPushQueue?: PushQueue; __leadPushInflight?: Set<string> };

export const pushQueue: PushQueue = (g.__leadPushQueue ??= new PushQueue(4));

/** `integrationId:leadId` pairs currently queued, running or waiting to retry. */
export const pushInflight: Set<string> = (g.__leadPushInflight ??= new Set<string>());
