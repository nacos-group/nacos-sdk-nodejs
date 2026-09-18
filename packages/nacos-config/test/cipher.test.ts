/**
 * Licensed to the Apache Software Foundation (ASF) under one or more
 * contributor license agreements.  See the NOTICE file distributed with
 * this work for additional information regarding copyright ownership.
 * The ASF licenses this file to You under the Apache License, Version 2.0
 * (the "License"); you may not use this file except in compliance with
 * the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as assert from 'assert';
import * as crypto from 'crypto';
import * as path from 'path';
import * as mm from 'mm';
import { ClientWorker, ServerListManager, Snapshot } from '../src';
import { DataClient } from '../src/client';
import { HttpAgent } from '../src/http_agent';
import { ConfigCipher, IKmsClient } from '../src/cipher';
import { GrpcConnection } from 'nacos-common';
import { createDefaultConfiguration } from './utils';

const { rimraf } = require('mz-modules');

const cacheDir = path.join(__dirname, '.cache_cipher');

/**
 * In-memory stand-in for the Alibaba Cloud KMS client. Deterministic data keys keep the
 * tests hermetic (no network) while exercising the real envelope encrypt/decrypt flow.
 */
class FakeKmsClient implements IKmsClient {
  private keyStore = new Map<string, string>();
  generateDataKeyCalls: Array<{ keyId: string; keySpec: string }> = [];
  decryptCalls: string[] = [];

  async generateDataKey(keyId: string, keySpec: string): Promise<{ plaintext: string; ciphertextBlob: string }> {
    this.generateDataKeyCalls.push({ keyId, keySpec });
    const byteLength = keySpec === 'AES_256' ? 32 : 16;
    // 每次调用生成互不相同的数据密钥（按调用序号填充），这样若 content/EDK 落盘时发生
    // 错配（content 用 keyN 加密却配了 keyM 的 EDK），解密必然失败——并发成对性测试因此可判别。
    const plaintext = Buffer.alloc(byteLength, this.generateDataKeyCalls.length).toString('base64');
    const ciphertextBlob = `edk-${keySpec}-${this.generateDataKeyCalls.length}`;
    this.keyStore.set(ciphertextBlob, plaintext);
    return { plaintext, ciphertextBlob };
  }

  async decrypt(ciphertextBlob: string): Promise<string> {
    this.decryptCalls.push(ciphertextBlob);
    const plaintext = this.keyStore.get(ciphertextBlob);
    if (!plaintext) {
      throw new Error(`FakeKmsClient: unknown ciphertextBlob ${ciphertextBlob}`);
    }
    return plaintext;
  }
}

function createCipherClient(kmsClient: IKmsClient): ClientWorker {
  const configuration = createDefaultConfiguration({
    serverAddr: '127.0.0.1:8848',
    namespace: '',
    cacheDir,
    kmsClient,
  });
  const snapshot = new Snapshot({ configuration });
  const serverMgr = new ServerListManager({ configuration });
  const httpAgent = new HttpAgent({ configuration });
  configuration.merge({ snapshot, serverMgr, httpAgent });
  return new ClientWorker({ configuration });
}

/** KMS stand-in whose decrypt always fails, to exercise decryption-failure handling on notify paths. */
class FailingDecryptKmsClient implements IKmsClient {
  async generateDataKey(_keyId: string, keySpec: string): Promise<{ plaintext: string; ciphertextBlob: string }> {
    const byteLength = keySpec === 'AES_256' ? 32 : 16;
    return { plaintext: Buffer.alloc(byteLength, 7).toString('base64'), ciphertextBlob: 'edk-failing' };
  }
  async decrypt(_ciphertextBlob: string): Promise<string> {
    throw new Error('KMS decrypt failed: simulated outage');
  }
}

const grpcClients: DataClient[] = [];

/**
 * gRPC DataClient with an injected KMS client and an in-memory snapshot. gRPC is the default
 * transport (Nacos 3.x) and constructing a DataClient really calls connect(), so connect and the
 * snapshot fs timing are both mocked to keep these cipher tests hermetic and deterministic.
 */
function createGrpcCipherClient(kmsClient: IKmsClient): DataClient {
  mm(GrpcConnection.prototype, 'connect', async () => {});
  const client = new DataClient({
    appName: 'test',
    serverAddr: '127.0.0.1:8848',
    namespace: '',
    cacheDir,
    kmsClient,
  } as any);
  const store = new Map<string, string>();
  mm((client as any).snapshot, 'get', async (k: string) => (store.has(k) ? store.get(k)! : null));
  mm((client as any).snapshot, 'save', async (k: string, v: string) => { if (!v) { store.delete(k); } else { store.set(k, v); } });
  mm((client as any).snapshot, 'delete', async (k: string) => { store.delete(k); });
  mm((client as any).snapshot, 'getFailover', async () => null);
  mm((client as any).snapshot, 'getFailoverMtime', async () => null);
  // 默认挂空 error 监听避免未捕获中断；断言 error 的用例会先 removeAllListeners 再自行挂载
  client.on('error', () => {});
  grpcClients.push(client);
  return client;
}

// Independent AES/ECB/PKCS5 helper used to build/verify ciphertext outside of ConfigCipher.
function aesEcb(plaintext: string, base64Key: string, algorithm: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const cipher = crypto.createCipheriv(algorithm, key, null);
  return Buffer.concat([ cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final() ]).toString('base64');
}

function newCipher(config?: any, kmsClient?: IKmsClient): ConfigCipher {
  return new ConfigCipher(createDefaultConfiguration(config || {}), kmsClient);
}

/** 确定性测试用的可外部结算 Promise。 */
interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value?: T) => void;
  reject: (err: any) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve: (value?: T) => void;
  let reject: (err: any) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res as any; reject = rej; });
  return { promise, resolve: resolve!, reject: reject! };
}

/** 排干事件循环：连续若干轮 setImmediate，让所有已就绪回调收敛（不依赖具体时长）。 */
async function flush(rounds = 8): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

describe('test/cipher.test.ts', () => {

  afterEach(async () => {
    for (const client of grpcClients) {
      client.close();
    }
    grpcClients.length = 0;
    mm.restore();
    await rimraf(cacheDir);
  });

  describe('ConfigCipher', () => {

    it('should detect cipher dataIds by prefix', () => {
      const cipher = newCipher();
      assert(cipher.isCipherDataId('cipher-kms-aes-128-x') === true);
      assert(cipher.isCipherDataId('cipher-kms-aes-256-x') === true);
      assert(cipher.isCipherDataId('cipher-custom-x') === true);
      assert(cipher.isCipherDataId('plain-x') === false);
      assert(cipher.isCipherDataId('') === false);
    });

    it('should encrypt then decrypt back to the original plaintext (AES-128)', async () => {
      const cipher = newCipher({}, new FakeKmsClient());
      const dataId = 'cipher-kms-aes-128-my-config';
      const plaintext = 'db.password=s3cr3t 你好';
      const encrypted = await cipher.encryptIfNeeded(dataId, plaintext);
      assert(encrypted.content !== plaintext);
      assert(typeof encrypted.encryptedDataKey === 'string' && encrypted.encryptedDataKey!.length > 0);
      const decrypted = await cipher.decryptIfNeeded(dataId, encrypted.content, encrypted.encryptedDataKey);
      assert(decrypted === plaintext);
    });

    it('should encrypt then decrypt back to the original plaintext (AES-256)', async () => {
      const cipher = newCipher({}, new FakeKmsClient());
      const dataId = 'cipher-kms-aes-256-my-config';
      const plaintext = 'a-longer-secret-value-to-span-multiple-aes-blocks-1234567890';
      const encrypted = await cipher.encryptIfNeeded(dataId, plaintext);
      const decrypted = await cipher.decryptIfNeeded(dataId, encrypted.content, encrypted.encryptedDataKey);
      assert(decrypted === plaintext);
    });

    it('should produce ciphertext byte-identical to a manual AES/ECB/PKCS5 pass', async () => {
      const cipher = newCipher({}, new FakeKmsClient());
      const plaintext = 'wire-format-check';
      const encrypted = await cipher.encryptIfNeeded('cipher-kms-aes-128-wire', plaintext);
      // FakeKmsClient 为 AES_128 生成确定性 16 字节密钥（按调用序号填充，这里是首个调用=1）；独立复算。
      const expected = aesEcb(plaintext, Buffer.alloc(16, 1).toString('base64'), 'aes-128-ecb');
      assert(encrypted.content === expected);
    });

    it('should request the matching keySpec and default keyId from KMS', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      await cipher.encryptIfNeeded('cipher-kms-aes-128-a', 'x');
      await cipher.encryptIfNeeded('cipher-kms-aes-256-b', 'y');
      assert(kms.generateDataKeyCalls.length === 2);
      assert(kms.generateDataKeyCalls[0].keySpec === 'AES_128');
      assert(kms.generateDataKeyCalls[1].keySpec === 'AES_256');
      assert(kms.generateDataKeyCalls[0].keyId === 'alias/acs/mse');
    });

    it('should honor a custom kmsKeyId', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-cmk' }, kms);
      await cipher.encryptIfNeeded('cipher-kms-aes-128-a', 'x');
      assert(kms.generateDataKeyCalls[0].keyId === 'alias/my-cmk');
    });

    it('should pass non-cipher dataIds through untouched without any KMS call', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      const encrypted = await cipher.encryptIfNeeded('plain-data-id', 'secret=value');
      assert(encrypted.content === 'secret=value');
      assert(encrypted.encryptedDataKey === undefined);
      assert(kms.generateDataKeyCalls.length === 0);
      const decrypted = await cipher.decryptIfNeeded('plain-data-id', 'secret=value');
      assert(decrypted === 'secret=value');
    });

    it('should pass empty content through', async () => {
      const cipher = newCipher({}, new FakeKmsClient());
      const encrypted = await cipher.encryptIfNeeded('cipher-kms-aes-128-empty', '');
      assert(encrypted.content === '' && encrypted.encryptedDataKey === undefined);
      const decrypted = await cipher.decryptIfNeeded('cipher-kms-aes-128-empty', '', 'edk-x');
      assert(decrypted === '');
    });

    it('should return content as-is when encryptedDataKey is absent (plaintext failover)', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      const decrypted = await cipher.decryptIfNeeded('cipher-kms-aes-128-fo', 'plain-failover-value');
      assert(decrypted === 'plain-failover-value');
      assert(kms.decryptCalls.length === 0);
    });

    it('should cache the plaintext data key so repeated reads skip KMS decrypt', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      const dataId = 'cipher-kms-aes-128-cached';
      const encrypted = await cipher.encryptIfNeeded(dataId, 'v1');
      const first = await cipher.decryptIfNeeded(dataId, encrypted.content, encrypted.encryptedDataKey);
      const second = await cipher.decryptIfNeeded(dataId, encrypted.content, encrypted.encryptedDataKey);
      assert(first === 'v1' && second === 'v1');
      assert(kms.decryptCalls.length === 0, 'encrypt seeded the cache, so decrypt must not call KMS');
    });

    it('should call KMS decrypt once for an unknown data key then cache it', async () => {
      const kms = new FakeKmsClient();
      const dataId = 'cipher-kms-aes-256-remote';
      // Simulate content encrypted by another client: seed the fake KMS with a data key.
      const { plaintext, ciphertextBlob } = await kms.generateDataKey('alias/acs/mse', 'AES_256');
      const content = aesEcb('remote-value', plaintext, 'aes-256-ecb');
      const freshCipher = newCipher({}, kms);
      const first = await freshCipher.decryptIfNeeded(dataId, content, ciphertextBlob);
      const second = await freshCipher.decryptIfNeeded(dataId, content, ciphertextBlob);
      assert(first === 'remote-value' && second === 'remote-value');
      assert(kms.decryptCalls.length === 1, 'second read should hit the in-memory data-key cache');
    });

    it('should throw on an unsupported cipher dataId prefix', async () => {
      const cipher = newCipher({}, new FakeKmsClient());
      let threw = false;
      try {
        await cipher.encryptIfNeeded('cipher-unknown-algo-x', 'v');
      } catch (err) {
        threw = true;
      }
      assert(threw === true);
    });
  });

  describe('ClientWorker KMS integration (HTTP carriers)', () => {

    it('should decrypt a cipher config read from the server via the Encrypted-Data-Key header', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      const dataId = 'cipher-kms-aes-128-http-get';
      const plaintext = 'db.password=s3cr3t';
      const { plaintext: dataKey, ciphertextBlob } = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const ciphertext = aesEcb(plaintext, dataKey, 'aes-128-ecb');

      let capturedOptions: any;
      mm(client.httpAgent, 'request', async (routePath, options) => {
        capturedOptions = options;
        return { data: ciphertext, headers: { 'encrypted-data-key': ciphertextBlob } };
      });

      const content = await client.getConfig(dataId, 'DEFAULT_GROUP');
      assert(content === plaintext);
      assert(capturedOptions.withHeaders === true, 'cipher dataIds must request response headers');
    });

    it('should read the header case-insensitively, persist ciphertext + edk, and decrypt from snapshot on failure', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      const dataId = 'cipher-kms-aes-128-snap';
      const group = 'DEFAULT_GROUP';
      const plaintext = 'cached-secret=1';
      const { plaintext: dataKey, ciphertextBlob } = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const ciphertext = aesEcb(plaintext, dataKey, 'aes-128-ecb');

      mm(client.httpAgent, 'request', async () => {
        return { data: ciphertext, headers: { 'Encrypted-Data-Key': ciphertextBlob } };
      });
      assert(await client.getConfig(dataId, group) === plaintext);

      const snapshotKey = (client as any).getSnapshotKeyEncoded(dataId, group);
      const edkKey = (client as any).getEncryptedDataKeySnapshotKey(dataId, group);
      assert(await client.snapshot.get(snapshotKey) === ciphertext, 'snapshot must store ciphertext, never plaintext');
      assert(await client.snapshot.get(edkKey) === ciphertextBlob);

      // Server now fails → getConfigInner falls back to the snapshot and still decrypts.
      mm.restore();
      mm(client.httpAgent, 'request', async () => { throw new Error('server down'); });
      assert(await client.getConfig(dataId, group) === plaintext);
    });

    it('should keep the plaintext path returning the raw body without requesting headers', async () => {
      const client = createCipherClient(new FakeKmsClient());
      let capturedOptions: any;
      mm(client.httpAgent, 'request', async (routePath, options) => {
        capturedOptions = options;
        return 'plain-body';
      });
      const content = await client.getConfig('plain-data-id', 'DEFAULT_GROUP');
      assert(content === 'plain-body');
      assert(capturedOptions.withHeaders === false, 'non-cipher reads must not change existing behavior');
    });

    it('should encrypt on publish and carry encryptedDataKey as a form param', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      const dataId = 'cipher-kms-aes-256-http-pub';
      let capturedOptions: any;
      mm(client.httpAgent, 'request', async (routePath, options) => {
        capturedOptions = options;
        return 'true';
      });

      await client.publishSingle(dataId, 'DEFAULT_GROUP', 'token=abc');
      const sent = capturedOptions.data;
      assert(sent.content !== 'token=abc', 'published content must be ciphertext');
      assert(typeof sent.encryptedDataKey === 'string' && sent.encryptedDataKey.length > 0);
      // The carried data key must decrypt the published ciphertext back to the original.
      const key = Buffer.from(await kms.decrypt(sent.encryptedDataKey), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
      const plain = Buffer.concat([ decipher.update(Buffer.from(sent.content, 'base64')), decipher.final() ]).toString('utf8');
      assert(plain === 'token=abc');
    });

    it('should publish plaintext unchanged for non-cipher dataIds', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      let capturedOptions: any;
      mm(client.httpAgent, 'request', async (routePath, options) => {
        capturedOptions = options;
        return 'true';
      });
      await client.publishSingle('plain-id', 'DEFAULT_GROUP', 'a=b');
      assert(capturedOptions.data.content === 'a=b');
      assert(capturedOptions.data.encryptedDataKey === undefined);
      assert(kms.generateDataKeyCalls.length === 0);
    });
  });

  describe('ClientWorker KMS concurrency (shared snapshot lock)', () => {
    // 这些确定性并发测试验证：cipher dataId 的内容快照（'config/'）与 EDK 快照（'edk/'）
    // 必须由共享快照锁串行落盘/删除，保证同 key 并发读/写/remove 下二者永远成对，绝不错配。
    // 该正确性由 #154 引入的 readConfigWithFailover 共享 withSnapshotLock 临界区提供，
    // KMS EDK 双写/双删被纳入同一临界区；用一次性阻断“首个 EDK 写入”制造交叉窗口，
    // 若去掉锁（并发的 content/EDK 写入交错）这些断言会失败（回归保护）。

    it('should keep the persisted content/EDK pair matched under concurrent same-key reads', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      const dataId = 'cipher-kms-aes-128-pair-http';
      const group = 'DEFAULT_GROUP';
      const contentKey = (client as any).getSnapshotKeyEncoded(dataId, group);
      const edkKey = (client as any).getEncryptedDataKeySnapshotKey(dataId, group);
      // 两对彼此独立且各自自洽的（密文, EDK）：V1 内容用 dataKey1 加密、配 edk1；V2 用 dataKey2、配 edk2
      const k1 = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const k2 = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const c1 = aesEcb('secret=v1', k1.plaintext, 'aes-128-ecb');
      const c2 = aesEcb('secret=v2', k2.plaintext, 'aes-128-ecb');

      const store = new Map<string, string>();
      const edkGate = deferred<void>();
      let edkSaves = 0;
      mm(client.snapshot, 'get', async (key: string) => (store.has(key) ? store.get(key) : null));
      mm(client.snapshot, 'getFailover', async () => null);
      mm(client.snapshot, 'getFailoverMtime', async () => null);
      mm(client.snapshot, 'delete', async (key: string) => { store.delete(key); });
      mm(client.snapshot, 'save', async (key: string, value: string) => {
        // 阻塞第一个 EDK 写入，制造两个并发读写入交错的窗口
        if (key === edkKey) { edkSaves++; if (edkSaves === 1) { await edkGate.promise; } }
        if (!value) { store.delete(key); } else { store.set(key, value); }
      });
      let call = 0;
      mm(client.httpAgent, 'request', async () => {
        call++;
        if (call === 1) { return { data: c1, headers: { 'encrypted-data-key': k1.ciphertextBlob } }; }
        return { data: c2, headers: { 'encrypted-data-key': k2.ciphertextBlob } };
      });

      const a = client.getConfig(dataId, group);
      await flush();
      const b = client.getConfig(dataId, group);
      await flush();
      edkGate.resolve();
      const results = await Promise.all([ a, b ]);

      // 快照里的 content 必须能被同一快照里的 edk 正确解密（成对），错配会导致解密失败/乱码
      const storedContent = store.get(contentKey)!;
      const storedEdk = store.get(edkKey)!;
      let decrypted: string | null = null;
      try {
        const key = Buffer.from(await kms.decrypt(storedEdk), 'base64');
        const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
        decrypted = Buffer.concat([ decipher.update(Buffer.from(storedContent, 'base64')), decipher.final() ]).toString('utf8');
      } catch (err) {
        decrypted = null;
      }
      assert(decrypted === 'secret=v1' || decrypted === 'secret=v2', 'stored content/EDK must be a matched pair, not crossed');
      // 两个并发读在用户边界都应拿到某个自洽明文
      assert(results[0] === 'secret=v1' || results[0] === 'secret=v2');
      assert(results[1] === 'secret=v1' || results[1] === 'secret=v2');
    });

    it('should leave neither content nor EDK snapshot when a get and remove race', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      const dataId = 'cipher-kms-aes-128-rmpair-http';
      const group = 'DEFAULT_GROUP';
      const contentKey = (client as any).getSnapshotKeyEncoded(dataId, group);
      const edkKey = (client as any).getEncryptedDataKeySnapshotKey(dataId, group);
      const k1 = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const c1 = aesEcb('secret=fresh', k1.plaintext, 'aes-128-ecb');

      const store = new Map<string, string>();
      // 预置一对旧快照，模拟历史缓存；remove 之后二者都不应残留（也不应被在途 get 复活）
      store.set(contentKey, 'stale-cipher');
      store.set(edkKey, 'stale-edk');
      mm(client.snapshot, 'get', async (key: string) => (store.has(key) ? store.get(key) : null));
      mm(client.snapshot, 'getFailover', async () => null);
      mm(client.snapshot, 'getFailoverMtime', async () => null);
      mm(client.snapshot, 'save', async (key: string, value: string) => { if (!value) { store.delete(key); } else { store.set(key, value); } });
      mm(client.snapshot, 'delete', async (key: string) => { store.delete(key); });
      const fetchGate = deferred<void>();
      mm(client.httpAgent, 'request', async (routePath: string, options: any) => {
        if (options && options.method === 'DELETE') { return 'true'; }
        // get 的服务端拉取被阻塞，直到 remove 之后才返回，考验在途 get 的复活风险
        await fetchGate.promise;
        return { data: c1, headers: { 'encrypted-data-key': k1.ciphertextBlob } };
      });

      const getP = client.getConfig(dataId, group);
      await flush();
      const removeP = client.remove(dataId, group);
      await flush();
      fetchGate.resolve();
      await Promise.all([ getP, removeP ]);
      await flush();

      assert(store.has(contentKey) === false, 'content snapshot must not survive remove');
      assert(store.has(edkKey) === false, 'EDK snapshot must not survive remove');
    });
  });

  describe('DataClient KMS integration (gRPC carriers)', () => {

    it('should encrypt on gRPC publishSingle and carry encryptedDataKey in the additionMap slot', async () => {
      const kms = new FakeKmsClient();
      const client = createGrpcCipherClient(kms);
      let captured: any[] = [];
      mm((client as any)._grpcConfigProxy, 'publishSingle', async (...args: any[]) => { captured = args; return true; });
      const ok = await client.publishSingle('cipher-kms-aes-256-grpc-pub', 'DEFAULT_GROUP', 'token=abc', { type: 'text' });
      assert(ok === true);
      // publishSingle(dataId, group, tenant, content, type, casMd5, encryptedDataKey)
      assert(captured[3] !== 'token=abc', 'published content must be ciphertext');
      assert(captured[4] === 'text', 'type must be forwarded');
      assert(captured[5] === undefined, 'non-CAS publish must not set casMd5');
      assert(typeof captured[6] === 'string' && captured[6].length > 0, 'encryptedDataKey must be carried');
      const key = Buffer.from(await kms.decrypt(captured[6]), 'base64');
      const decipher = crypto.createDecipheriv('aes-256-ecb', key, null);
      const plain = Buffer.concat([ decipher.update(Buffer.from(captured[3], 'base64')), decipher.final() ]).toString('utf8');
      assert(plain === 'token=abc');
    });

    it('should encrypt on gRPC publishConfigCas and carry encryptedDataKey alongside casMd5', async () => {
      const kms = new FakeKmsClient();
      const client = createGrpcCipherClient(kms);
      let captured: any[] = [];
      mm((client as any)._grpcConfigProxy, 'publishSingle', async (...args: any[]) => { captured = args; return true; });
      const ok = await client.publishConfigCas('cipher-kms-aes-128-grpc-cas', 'DEFAULT_GROUP', 'token=abc', 'expected-md5');
      assert(ok === true);
      assert(captured[3] !== 'token=abc', 'CAS publish must send ciphertext, not plaintext');
      assert(captured[5] === 'expected-md5', 'casMd5 must be preserved for the CAS check');
      assert(typeof captured[6] === 'string' && captured[6].length > 0, 'CAS publish must carry encryptedDataKey');
      const key = Buffer.from(await kms.decrypt(captured[6]), 'base64');
      const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
      const plain = Buffer.concat([ decipher.update(Buffer.from(captured[3], 'base64')), decipher.final() ]).toString('utf8');
      assert(plain === 'token=abc');
    });

    it('should pass non-cipher content through gRPC publishConfigCas unchanged (no KMS call)', async () => {
      const kms = new FakeKmsClient();
      const client = createGrpcCipherClient(kms);
      let captured: any[] = [];
      mm((client as any)._grpcConfigProxy, 'publishSingle', async (...args: any[]) => { captured = args; return true; });
      await client.publishConfigCas('plain-data-id', 'DEFAULT_GROUP', 'a=b', 'expected-md5');
      assert(captured[3] === 'a=b', 'non-cipher content must not be altered');
      assert(captured[5] === 'expected-md5');
      assert(captured[6] === undefined, 'non-cipher publish must not carry encryptedDataKey');
      assert(kms.generateDataKeyCalls.length === 0);
    });

    it('should surface a decryption failure on gRPC push as an error event (not swallow it)', async () => {
      const client = createGrpcCipherClient(new FailingDecryptKmsClient());
      const dataId = 'cipher-kms-aes-128-push-decrypt-fail';
      const group = 'DEFAULT_GROUP';
      const key = `${dataId}@@${group}`;
      const received: string[] = [];
      const errors: Error[] = [];
      client.removeAllListeners('error');
      client.on('error', (err: Error) => errors.push(err));
      (client as any)._grpcSubscribers = new Map();
      (client as any)._grpcSubscribers.set(key, [ (c: string) => received.push(c) ]);
      (client as any)._grpcFailoverState = new Map();
      (client as any)._grpcFailoverState.set(key, { dataId, group, useFailover: false, failoverVersion: null, content: null, listenerRegistered: true, listenerMd5: '' });
      // 服务端返回密文与一个无法解密的 EDK：decryptIfNeeded 会抛错
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'bogus-ciphertext', encryptedDataKey: 'edk-x' }));

      (client as any)._onGrpcConfigChanged({ dataId, group, tenant: '' });
      await flush();

      assert(errors.some(e => /decrypt failed/i.test(e.message)), 'decryption failure on push must be observable via error event');
      assert(received.length === 0, 'listener must not be notified with undecryptable content');
    });

    it('should surface a decryption failure during initial subscribe as an error event', async () => {
      const client = createGrpcCipherClient(new FailingDecryptKmsClient());
      const dataId = 'cipher-kms-aes-128-init-decrypt-fail';
      const group = 'DEFAULT_GROUP';
      const received: string[] = [];
      const errors: Error[] = [];
      client.removeAllListeners('error');
      client.on('error', (err: Error) => errors.push(err));
      mm((client as any)._grpcConfigProxy, 'getConfig', async () => ({ content: 'bogus-ciphertext', encryptedDataKey: 'edk-x' }));
      mm((client as any)._grpcConfigProxy, 'addListener', async () => {});
      mm((client as any)._grpcConfigProxy, 'removeListener', async () => {});

      client.subscribe({ dataId, group }, (c: string) => received.push(c));
      await flush();

      assert(errors.some(e => /decrypt failed/i.test(e.message)), 'decryption failure on initial subscribe must be observable');
      assert(received.length === 0, 'listener must not be notified with undecryptable content');
    });
  });
});
