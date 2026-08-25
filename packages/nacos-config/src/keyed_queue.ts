/**
 * 轻量的 per-key 异步串行队列（无第三方依赖）。
 *
 * 对齐 Java SDK ClientWorker 单线程 listenExecutor + CacheData synchronized 的语义：
 * - 同一个 key 上的任务严格 FIFO 串行，前一个未结算前后一个不会开始；
 * - 不同 key 之间互不阻塞、可并行；
 * - 某个任务失败（reject/throw）不影响同 key 后续任务继续执行；
 * - 某个 key 的队列排空后清理 Map 项，避免长时间运行累积内存。
 *
 * 用于把 snapshot 读写、gRPC 订阅状态读取/提交等“读-改-写”流程串起来，
 * 消除在途异步操作交错导致的快照复活 / 旧值覆盖新值等竞态。
 */
export class KeyedAsyncQueue {

  // key -> 队尾 Promise。队尾始终为“已吞掉异常”的 Promise，保证串行链不会因单个失败而断裂。
  private tails: Map<string, Promise<void>> = new Map();

  /**
   * 将 task 追加到 key 对应队列尾部，返回 task 自身的结果 Promise（保留其成功值/异常）。
   * @param key 串行分组键
   * @param task 待执行的异步任务
   */
  run<T>(key: string, task: () => Promise<T> | T): Promise<T> {
    const prev = this.tails.get(key) || Promise.resolve();
    // prev 永不 reject（见下方 tail），故只需 onFulfilled；失败隔离由 tail 承担
    const result: Promise<T> = prev.then(() => task());
    // 队尾吞掉异常，确保下一个同 key 任务无论前者成败都会执行
    const tail: Promise<void> = result.then(() => undefined, () => undefined);
    this.tails.set(key, tail);
    // 排空后清理：仅当当前队尾仍是自己时删除，避免误删后续追加的新队尾
    tail.then(() => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    });
    return result;
  }

  /** 当前活跃（未排空）的 key 数量，供测试断言 Map 清理。 */
  get size(): number {
    return this.tails.size;
  }
}
