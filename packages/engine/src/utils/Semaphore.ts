/**
 * Async Semaphore - limits concurrent async operations.
 *
 * Usage:
 *   const sem = new Semaphore(3);
 *   await sem.run(() => fetch(...)); // At most 3 concurrent fetches
 *
 * For Ollama (local GPU): concurrency = 1 (default, safe for VRAM)
 *   User can increase if they set OLLAMA_NUM_PARALLEL on their Ollama server.
 *
 * For OpenAI (cloud API): concurrency = 10 (safe, rate-limited server-side)
 */
export class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly maxConcurrency: number) {
    if (maxConcurrency < 1) {
      throw new Error('Semaphore concurrency must be >= 1');
    }
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active++;
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }
}
