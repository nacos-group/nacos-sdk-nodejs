import { ISnapshot } from './interface';
import { KeyedAsyncQueue } from './keyed_queue';

/**
 * 进程内共享的快照串行锁（per-key async queue）。
 * 对同一个实际缓存 key 的 snapshot/get/remove 完整流程串行执行，消除在途 get
 * 晚到后复活已被 remove 删除的快照等竞态。锁 key 以 cacheDir 前缀区分，避免不同
 * 客户端目录互相阻塞。
 */
const snapshotLock = new KeyedAsyncQueue();

/**
 * 在共享快照锁内执行 task。lockKey = cacheDir + snapshotKey，保证同一客户端目录下
 * 同一缓存 key 的 get / remove 串行，而不同 cacheDir（不同客户端）互不影响。
 */
export function withSnapshotLock<T>(snapshot: ISnapshot, snapshotKey: string, task: () => Promise<T>): Promise<T> {
  const lockKey = `${snapshot.cacheDir}::${snapshotKey}`;
  return snapshotLock.run(lockKey, task);
}

/**
 * 本地容灾读取所需的钩子。HTTP（ClientWorker）与 gRPC（DataClient）两条传输的容灾
 * 主流程完全一致，仅“从服务端取值”“快照回退读取”“异常上报”三处实现不同，由调用方注入
 * （两个客户端类各自 extends Base，故用组合而非继承共享该骨架）。
 */
/**
 * 本地容灾读取最终命中的内容来源：
 * - failover：命中用户手工维护的应急容灾文件；
 * - server：来自服务端拉取（含服务端返回“配置不存在”的确认，此时 content 为 null）；
 * - snapshot：服务端异常后回退读取到的本地快照。
 * 调用方据此区分“服务端已恢复”（server）与“仅快照回退”（snapshot），避免快照回退误清 failover 状态。
 */
export type ConfigContentSource = 'failover' | 'server' | 'snapshot';

/** 本地容灾读取结果：原始内容（可能为 null 表示服务端确认不存在）与其来源。 */
export interface ConfigReadResult {
  content: string | null;
  source: ConfigContentSource;
}

export interface DisasterRecoveryHooks {
  /** 快照与容灾文件的统一存储 key（各传输自行编码后传入） */
  snapshotKey: string;
  /** 快照与容灾文件的持久化实现 */
  snapshot: ISnapshot;
  /**
   * 从服务端拉取配置。配置不存在时：HTTP（404）与 gRPC（errorCode 300 CONFIG_NOT_FOUND）均返回 null，
   * 由 readConfigWithFailover 统一清除本地快照（对齐 Java ConfigQueryResponse）。
   */
  fetchFromServer: () => Promise<string | null>;
  /** 服务端不可用时的快照回退读取（HTTP 带 legacy key 迁移，gRPC 直读） */
  readSnapshotFallback: () => Promise<string | null>;
  /** 服务端异常但命中快照回退时的错误上报（HTTP _error / gRPC throwError） */
  onServerError: (err: Error) => void;
  /** 清除该 key 的全部本地快照表示（HTTP 含 legacy key，gRPC 仅 encoded），用于服务端 404 */
  clearSnapshot: () => Promise<void>;
}

/**
 * 本地容灾读取骨架，对齐 Java SDK 的读优先级：failover > server > snapshot。
 * - failover 是用户手工维护的应急容灾配置，命中则优先于服务端与快照返回；
 * - 服务端异常时回退本地快照，快照也没有才抛出原始错误；
 * - 服务端返回“配置不存在”（null）时删除本地快照，避免故障回退读到过期空内容。
 */
export function readConfigWithFailover(hooks: DisasterRecoveryHooks): Promise<ConfigReadResult> {
  const { snapshotKey, snapshot } = hooks;
  // 整个 failover check → server fetch → fallback read → snapshot save/clear 流程
  // 在共享快照锁内串行执行（对齐 Java CacheData synchronized）。
  return withSnapshotLock(snapshot, snapshotKey, async () => {
    const getFailover = (snapshot as any).getFailover;
    const failover = typeof getFailover === 'function' ?
      await getFailover.call(snapshot, snapshotKey) : null;
    if (failover !== null) {
      return { content: failover, source: 'failover' as ConfigContentSource };
    }

    let content: string | null;
    try {
      content = await hooks.fetchFromServer();
    } catch (err) {
      const cache = await hooks.readSnapshotFallback();
      if (cache !== null) {
        hooks.onServerError(err);
        return { content: cache, source: 'snapshot' as ConfigContentSource };
      }
      throw err;
    }

    if (content === null) {
      // 服务端配置不存在：清除该 key 的全部本地表示（HTTP 含 legacy），避免残留快照
      // 在后续服务端故障时把已删除的配置复活
      await hooks.clearSnapshot();
      return { content: null, source: 'server' as ConfigContentSource };
    }

    // Empty server content is an authoritative absence; remove stale data
    // explicitly while preserving Snapshot.save's legacy empty-string API.
    if (content) await snapshot.save(snapshotKey, content);
    else await snapshot.delete(snapshotKey);
    return { content, source: 'server' as ConfigContentSource };
  });
}
