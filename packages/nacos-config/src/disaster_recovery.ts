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
 * 从服务端拉取到的原始结果：内容（cipher dataId 为密文）与随行的 encryptedDataKey。
 * 仅表示“服务端取到了什么”，来源判定（server/snapshot/failover）由 readConfigWithFailover 负责。
 */
export interface ConfigCacheResult {
  /** 配置内容；服务端返回“配置不存在”时为 null */
  content: string | null;
  /** KMS 加密数据密钥；仅 cipher dataId 且服务端下发时存在 */
  encryptedDataKey?: string;
}

/**
 * 本地容灾读取最终命中的内容来源：
 * - failover：命中用户手工维护的应急容灾文件；
 * - server：来自服务端拉取（含服务端返回“配置不存在”的确认，此时 content 为 null）；
 * - snapshot：服务端异常后回退读取到的本地快照。
 * 调用方据此区分“服务端已恢复”（server）与“仅快照回退”（snapshot），避免快照回退误清 failover 状态。
 */
export type ConfigContentSource = 'failover' | 'server' | 'snapshot';

/**
 * 本地容灾读取结果：原始内容（可能为 null 表示服务端确认不存在）、来源，
 * 以及 cipher dataId 的 encryptedDataKey（供用户边界解密）。
 */
export interface ConfigReadResult {
  content: string | null;
  source: ConfigContentSource;
  /** KMS 加密数据密钥；仅 cipher dataId 且服务端/快照下发时存在 */
  encryptedDataKey?: string;
}

/**
 * 本地容灾读取所需的钩子。HTTP（ClientWorker）与 gRPC（DataClient）两条传输的容灾
 * 主流程完全一致，仅“从服务端取值”“快照回退读取”“异常上报”三处实现不同，由调用方注入
 * （两个客户端类各自 extends Base，故用组合而非继承共享该骨架）。
 */
export interface DisasterRecoveryHooks {
  /** 内容快照的统一存储 key（各传输自行编码后传入） */
  snapshotKey: string;
  /** encryptedDataKey 快照的存储 key（与内容快照并行的 'edk/' 命名空间） */
  encryptedDataKeySnapshotKey: string;
  /** 是否为 cipher dataId：决定是否持久化/回退 encryptedDataKey */
  isCipher: boolean;
  /** 快照与容灾文件的持久化实现 */
  snapshot: ISnapshot;
  /**
   * 从服务端拉取配置及其 encryptedDataKey。配置不存在时 content 约定：HTTP（404）与
   * gRPC（errorCode 300 CONFIG_NOT_FOUND）均返回 null，由 readConfigWithFailover 统一
   * 清除本地快照（对齐 Java ConfigQueryResponse）。
   */
  fetchFromServer: () => Promise<ConfigCacheResult>;
  /** 服务端不可用时的快照回退读取（HTTP 带 legacy key 迁移，gRPC 直读） */
  readSnapshotFallback: () => Promise<string | null>;
  /** 服务端异常但命中快照回退时的错误上报（HTTP _error / gRPC throwError） */
  onServerError: (err: Error) => void;
  /** 清除该 key 的全部本地快照表示（HTTP 含 legacy key + edk，gRPC 含 encoded + edk），用于服务端“配置不存在” */
  clearSnapshot: () => Promise<void>;
}

/**
 * 本地容灾读取骨架，对齐 Java SDK 的读优先级：failover > server > snapshot。
 * - failover 是用户手工维护的应急容灾配置，命中则优先返回，按明文处理，不携带 encryptedDataKey；
 * - 服务端异常时回退本地快照（cipher dataId 一并回退 edk 以便解密），快照也没有才抛出原始错误；
 * - 服务端返回“配置不存在”（null）时删除内容快照与 edk，避免故障回退读到过期空内容；
 * - 快照存原始内容（cipher dataId 为密文），encryptedDataKey 单独持久化供离线解密。
 *
 * 整个 failover check → server fetch → fallback 双读 → content/EDK 双写或双删流程
 * 全部在共享快照锁（withSnapshotLock，lockKey = cacheDir::snapshotKey）内串行执行，
 * 对齐 Java CacheData synchronized：同一进程内同 key 的并发读/写/remove 不会交错，
 * 因而 content 快照与 edk 快照永远成对写入 / 成对删除，不会产生错配 pair。
 */
export function readConfigWithFailover(hooks: DisasterRecoveryHooks): Promise<ConfigReadResult> {
  const { snapshotKey, encryptedDataKeySnapshotKey, isCipher, snapshot } = hooks;
  return withSnapshotLock(snapshot, snapshotKey, async () => {
    const failover = await snapshot.getFailover(snapshotKey);
    if (failover !== null) {
      return { content: failover, source: 'failover' as ConfigContentSource };
    }

    let content: string | null;
    let encryptedDataKey: string | undefined;
    try {
      const result = await hooks.fetchFromServer();
      content = result.content;
      encryptedDataKey = result.encryptedDataKey;
    } catch (err) {
      const cache = await hooks.readSnapshotFallback();
      if (cache !== null) {
        hooks.onServerError(err);
        // cipher dataId 一并回退 edk 快照，供离线解密；两次读取仍在同一临界区内
        const cachedDataKey = isCipher ? await snapshot.get(encryptedDataKeySnapshotKey) : null;
        return {
          content: cache,
          source: 'snapshot' as ConfigContentSource,
          encryptedDataKey: cachedDataKey || undefined,
        };
      }
      throw err;
    }

    if (content === null) {
      // 服务端配置不存在：清除该 key 的全部本地表示（含 edk），避免残留快照
      // 在后续服务端故障时把已删除的配置复活
      await hooks.clearSnapshot();
      return { content: null, source: 'server' as ConfigContentSource };
    }

    // 落原始内容快照（空内容由 Snapshot.save 统一按删除处理）
    await snapshot.save(snapshotKey, content || '');
    // encryptedDataKey 单独持久化；无 edk 时清理旧值避免误用（与内容写入同临界区，保证成对）
    if (isCipher && encryptedDataKey) {
      await snapshot.save(encryptedDataKeySnapshotKey, encryptedDataKey);
    } else {
      await snapshot.delete(encryptedDataKeySnapshotKey);
    }
    return { content, source: 'server' as ConfigContentSource, encryptedDataKey };
  });
}
