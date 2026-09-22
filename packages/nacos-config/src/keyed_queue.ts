/**
 * Small per-key async FIFO used to serialize snapshot and subscription state
 * transitions without blocking unrelated configurations.
 */
export class KeyedAsyncQueue {
  private tails: Map<string, Promise<void>> = new Map();

  run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const previous = this.tails.get(key) || Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return result;
  }
}
