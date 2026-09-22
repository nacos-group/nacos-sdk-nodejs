import { ISnapshot } from './interface';
import { KeyedAsyncQueue } from './keyed_queue';

const snapshotQueue = new KeyedAsyncQueue();

export function withSnapshotLock<T>(snapshot: ISnapshot, key: string, task: () => Promise<T>): Promise<T> {
  return snapshotQueue.run(`${snapshot.cacheDir}::${key}`, task);
}
