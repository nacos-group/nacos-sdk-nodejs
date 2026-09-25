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
import { ClientOptionKeys, ClientWorker, ServerListManager, Snapshot } from '../src';
import { DataClient } from '../src/client';
import { HttpAgent } from '../src/http_agent';
import { AliyunKmsClient, ConfigCipher, IKmsClient } from '../src/cipher';
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
  encryptCalls: Array<{ plaintext: string; keyId?: string }> = [];
  describeKeyCalls: string[] = [];
  setDeletionProtectionCalls: string[] = [];
  closeCalls = 0;

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

  async encrypt(plaintext: string, keyId?: string): Promise<string> {
    this.encryptCalls.push({ plaintext, keyId });
    // Faithful stand-in for the KMS Encrypt API: the caller passes a Base64-encoded plaintext and
    // the service returns an opaque ciphertext blob. Record blob -> Base64 plaintext in the same
    // keyStore the envelope path uses, so decrypt hands back exactly what a real KMS would return.
    const ciphertextBlob = `direct-${this.encryptCalls.length}`;
    this.keyStore.set(ciphertextBlob, plaintext);
    return ciphertextBlob;
  }

  async decrypt(ciphertextBlob: string): Promise<string> {
    this.decryptCalls.push(ciphertextBlob);
    // A real KMS Decrypt returns the Base64-encoded plaintext. The keyStore holds Base64 for both
    // the envelope data key and the direct-encrypt blob, so return it verbatim (no text decoding).
    const plaintext = this.keyStore.get(ciphertextBlob);
    if (!plaintext) {
      throw new Error(`FakeKmsClient: unknown ciphertextBlob ${ciphertextBlob}`);
    }
    return plaintext;
  }

  async describeKey(keyId: string): Promise<any> {
    this.describeKeyCalls.push(keyId);
    return { keyMetadata: { arn: `acs:kms:::key/${keyId}`, keyId } };
  }

  async setDeletionProtection(keyId: string): Promise<void> {
    this.setDeletionProtectionCalls.push(keyId);
  }

  close(): void {
    this.closeCalls++;
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
  async encrypt(_plaintext: string, _keyId?: string): Promise<string> {
    throw new Error('KMS encrypt failed: simulated outage');
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

    it('should apply the configured text encoding to cipher content (GBK vs UTF-8)', async () => {
      const dataId = 'cipher-kms-aes-128-gbk';
      const plaintext = 'db.password=中文密钥';
      const utf8Cipher = newCipher({ defaultEncoding: 'utf8' }, new FakeKmsClient());
      const gbkCipher = newCipher({ defaultEncoding: 'gbk' }, new FakeKmsClient());

      const utf8Encrypted = await utf8Cipher.encryptIfNeeded(dataId, plaintext);
      const gbkEncrypted = await gbkCipher.encryptIfNeeded(dataId, plaintext);

      // Each cipher owns its FakeKmsClient, so both plaintext data keys are the deterministic
      // first-call key; any ciphertext difference comes purely from the applied text encoding.
      assert(utf8Encrypted.content !== gbkEncrypted.content);

      const gbkDecrypted = await gbkCipher.decryptIfNeeded(dataId, gbkEncrypted.content, gbkEncrypted.encryptedDataKey);
      assert(gbkDecrypted === plaintext);
    });

    it('should apply a native Node text encoding (utf16le) to cipher content', async () => {
      const dataId = 'cipher-kms-aes-128-utf16';
      const plaintext = 'secret=值';
      const utf8Cipher = newCipher({ defaultEncoding: 'utf8' }, new FakeKmsClient());
      const utf16Cipher = newCipher({ defaultEncoding: 'utf16le' }, new FakeKmsClient());

      const utf8Encrypted = await utf8Cipher.encryptIfNeeded(dataId, plaintext);
      const utf16Encrypted = await utf16Cipher.encryptIfNeeded(dataId, plaintext);
      assert(utf8Encrypted.content !== utf16Encrypted.content);

      const roundTripped = await utf16Cipher.decryptIfNeeded(dataId, utf16Encrypted.content, utf16Encrypted.encryptedDataKey);
      assert(roundTripped === plaintext);
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

    it('should route a bare cipher- dataId to the direct KMS encrypt path', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      const result = await cipher.encryptIfNeeded('cipher-myapp', 'secret-value');
      assert(kms.encryptCalls.length === 1, 'bare cipher- must call KMS encrypt directly');
      // Wire contract: KMS Encrypt requires a Base64-encoded plaintext, so the direct path must
      // Base64-encode the config value before sending it (never pass the raw text on the wire).
      assert(kms.encryptCalls[0].plaintext === Buffer.from('secret-value', 'utf8').toString('base64'));
      assert(kms.generateDataKeyCalls.length === 0, 'direct path must not generate a data key');
      assert(result.encryptedDataKey === undefined, 'direct path carries no encryptedDataKey');
      assert(typeof result.content === 'string' && result.content !== 'secret-value');
    });

    it('should decrypt a direct KMS cipher- dataId without an encryptedDataKey', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      const encrypted = await cipher.encryptIfNeeded('cipher-myapp', 'secret-value');
      const decrypted = await cipher.decryptIfNeeded('cipher-myapp', encrypted.content);
      assert(decrypted === 'secret-value', 'direct KMS content must round-trip without a data key');
      assert(kms.decryptCalls.length === 1, 'direct decrypt must call KMS decrypt on the content');
    });

    it('should Base64-decode the plaintext KMS returns on the direct cipher- decrypt path', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      // Present the blob exactly as the KMS service would: decrypt(blob) yields the Base64-encoded
      // plaintext. The direct path must decode that Base64 back to the original config text.
      const blob = await kms.encrypt(Buffer.from('secret-value', 'utf8').toString('base64'));
      const decrypted = await cipher.decryptIfNeeded('cipher-myapp', blob);
      assert(decrypted === 'secret-value', 'direct decrypt must Base64-decode the KMS plaintext');
      assert(kms.decryptCalls.length === 1, 'direct decrypt must call KMS decrypt on the content');
    });

    it('should pass failover content through undecrypted for a bare cipher- dataId', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({}, kms);
      // isFailover marks a user-maintained plaintext failover file: never send it to KMS, even for
      // a bare cipher- dataId whose server form is direct KMS ciphertext.
      const value = await cipher.decryptIfNeeded('cipher-myapp', 'plain-failover-value', undefined, true);
      assert(value === 'plain-failover-value', 'failover plaintext must pass through undecrypted');
      assert(kms.decryptCalls.length === 0, 'failover content must never reach KMS decrypt');
    });
  });

  describe('AliyunKmsClient request retry', () => {

    it('should retry a transient KMS failure until it succeeds', async () => {
      const kms = new AliyunKmsClient(createDefaultConfiguration({}));
      let calls = 0;
      (kms as any).models = { GenerateDataKeyRequest: function (params: any) { return params; } };
      (kms as any).client = {
        generateDataKey: async () => {
          calls++;
          if (calls < 3) {
            throw new Error('transient KMS outage');
          }
          return { body: { plaintext: Buffer.alloc(16, 1).toString('base64'), ciphertextBlob: 'edk-retry' } };
        },
      };

      const dataKey = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      assert(calls === 3, 'should retry until the third attempt succeeds');
      assert(dataKey.ciphertextBlob === 'edk-retry');
    });

    it('should throw the last error after exhausting KMS retries', async () => {
      const kms = new AliyunKmsClient(createDefaultConfiguration({}));
      let calls = 0;
      (kms as any).models = { DecryptRequest: function (params: any) { return params; } };
      (kms as any).client = {
        decrypt: async () => {
          calls++;
          throw new Error('persistent KMS outage');
        },
      };

      let capturedError;
      try {
        await kms.decrypt('edk-x');
      } catch (err) {
        capturedError = err;
      }
      assert(calls === 3, 'should stop after three attempts');
      assert(capturedError && /persistent KMS outage/.test(capturedError.message));
    });

    it('should stop retrying once the overall timeout deadline passes', async () => {
      const kms = new AliyunKmsClient(createDefaultConfiguration({}));
      // Shrink the deadline (default 3s) so the test need not wait on the real budget. Each
      // attempt burns 60ms, which alone exceeds the 50ms deadline, so no second attempt may
      // start even though KMS_MAX_ATTEMPTS has not been reached -- aligns with the Java
      // KmsEncryptor.locallyRunWithRetryTimesAndTimeout deadline.
      (kms as any).timeoutMs = 50;
      let calls = 0;
      (kms as any).models = { DecryptRequest: function (params: any) { return params; } };
      (kms as any).client = {
        decrypt: async () => {
          calls++;
          await new Promise(resolve => setTimeout(resolve, 60));
          throw new Error('slow KMS outage');
        },
      };

      let capturedError;
      try {
        await kms.decrypt('edk-slow');
      } catch (err) {
        capturedError = err;
      }
      assert(calls === 1, 'the deadline must cut retries short even though attempts remain');
      assert(capturedError && /slow KMS outage/.test(capturedError.message));
    });

    it('should always surface a real Error even if the deadline precludes any attempt', async () => {
      const kms = new AliyunKmsClient(createDefaultConfiguration({
        kmsAccessKeyId: 'ak', kmsAccessKeySecret: 'sk', kmsRegionId: 'cn-hangzhou',
      }));
      // Degenerate budget: the deadline has already passed at loop entry, so no attempt runs.
      // The retry helper must still throw a real Error, never `undefined`.
      (kms as any).timeoutMs = 0;
      let capturedError: any;
      try {
        await kms.decrypt('irrelevant-blob');
      } catch (err) {
        capturedError = err;
      }
      assert(capturedError instanceof Error, 'requestWithRetry must throw an Error, not undefined');
    });
  });

  describe('AliyunKmsClient credential rotation', () => {

    it('should rebuild the KMS client when resolved credentials rotate', async () => {
      // Control what ensureClient resolves so we can simulate a mid-life credential rotation
      // (rotated AK/SK or a refreshed STS token) without any real credential source or network.
      const aliyunAuth = require('../src/aliyun_auth');
      let version = 1;
      mm(aliyunAuth, 'resolveAliyunCredentialsAsync', async () => ({
        accessKeyId: 'ak-' + version,
        accessKeySecret: 'sk-' + version,
      }));
      const kms = new AliyunKmsClient(createDefaultConfiguration({
        kmsEndpoint: 'kms.cn-hangzhou.aliyuncs.com',
        kmsRegionId: 'cn-hangzhou',
      }));

      const first = await (kms as any).ensureClient();
      const sameCredentials = await (kms as any).ensureClient();
      assert(first && first === sameCredentials, 'stable credentials must reuse the cached client');

      version = 2; // a rotation happens between calls
      const afterRotation = await (kms as any).ensureClient();
      assert(afterRotation !== first, 'rotated credentials must rebuild the client so KMS sees the new secret');
    });
  });

  describe('AliyunKmsClient per-request timeout', () => {

    it('should configure a per-request timeout so a hung KMS gateway cannot stall the deadline', async () => {
      const aliyunAuth = require('../src/aliyun_auth');
      mm(aliyunAuth, 'resolveAliyunCredentialsAsync', async () => ({ accessKeyId: 'ak', accessKeySecret: 'sk' }));
      const kmsSdk = require('@alicloud/kms20160120');
      let capturedConfig: any;
      // ensureClient prefers `kmsModule.default` as the constructor, so stubbing .default captures the config.
      mm(kmsSdk, 'default', function (config: any) { capturedConfig = config; });
      const kms = new AliyunKmsClient(createDefaultConfiguration({ kmsRegionId: 'cn-hangzhou' }));
      await (kms as any).ensureClient();
      assert(capturedConfig, 'the KMS client must be constructed with a config object');
      assert(typeof capturedConfig.readTimeout === 'number' && capturedConfig.readTimeout > 0,
        'readTimeout must bound a hung read so the retry deadline is actually enforceable');
      assert(typeof capturedConfig.connectTimeout === 'number' && capturedConfig.connectTimeout > 0,
        'connectTimeout must bound a hung connect');
    });
  });

  describe('ConfigCipher data-key cache', () => {

    it('should bypass the data-key cache when kmsCacheEnabled is false', async () => {
      const kms = new FakeKmsClient();
      const { plaintext, ciphertextBlob } = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const content = aesEcb('cached-value', plaintext, 'aes-128-ecb');
      const cipher = newCipher({ kmsCacheEnabled: false }, kms);

      const first = await cipher.decryptIfNeeded('cipher-kms-aes-128-x', content, ciphertextBlob);
      const second = await cipher.decryptIfNeeded('cipher-kms-aes-128-x', content, ciphertextBlob);
      assert(first === 'cached-value' && second === 'cached-value');
      assert(kms.decryptCalls.length === 2, 'cache disabled must call KMS decrypt on every read');
    });

    it('should evict the oldest data key when the cache exceeds kmsCacheMaxSize', async () => {
      const kms = new FakeKmsClient();
      const k1 = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const k2 = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const c1 = aesEcb('v1', k1.plaintext, 'aes-128-ecb');
      const c2 = aesEcb('v2', k2.plaintext, 'aes-128-ecb');
      const cipher = newCipher({ kmsCacheMaxSize: 1 }, kms);

      await cipher.decryptIfNeeded('cipher-kms-aes-128-a', c1, k1.ciphertextBlob);
      await cipher.decryptIfNeeded('cipher-kms-aes-128-b', c2, k2.ciphertextBlob);
      const callsAfterTwoReads: number = kms.decryptCalls.length;
      // Inserting k2 exceeded the max size of 1, so k1 was evicted and must be re-fetched.
      await cipher.decryptIfNeeded('cipher-kms-aes-128-a', c1, k1.ciphertextBlob);
      const callsAfterEvictedRead: number = kms.decryptCalls.length;
      assert(callsAfterTwoReads === 2);
      assert(callsAfterEvictedRead === 3, 'evicted data key must be re-fetched from KMS');
    });

    it('should expire cached data keys after kmsCacheAfterWriteSeconds', async () => {
      const kms = new FakeKmsClient();
      const { plaintext, ciphertextBlob } = await kms.generateDataKey('alias/acs/mse', 'AES_128');
      const content = aesEcb('ttl-value', plaintext, 'aes-128-ecb');
      const cipher = newCipher({ kmsCacheAfterWriteSeconds: 0.05 }, kms);

      await cipher.decryptIfNeeded('cipher-kms-aes-128-x', content, ciphertextBlob);
      const callsBeforeExpiry: number = kms.decryptCalls.length;
      await new Promise(resolve => setTimeout(resolve, 150));
      await cipher.decryptIfNeeded('cipher-kms-aes-128-x', content, ciphertextBlob);
      const callsAfterExpiry: number = kms.decryptCalls.length;
      assert(callsBeforeExpiry === 1);
      assert(callsAfterExpiry === 2, 'entry older than the write TTL must be re-fetched');
    });
  });

  describe('AliyunKmsClient key protection', () => {

    it('should describe a key and return the KMS metadata body', async () => {
      const kms = new AliyunKmsClient(createDefaultConfiguration({}));
      let capturedRequest: any;
      (kms as any).models = { DescribeKeyRequest: function (params: any) { return params; } };
      (kms as any).client = {
        describeKey: async (request: any) => {
          capturedRequest = request;
          return { body: { keyMetadata: { arn: 'acs:kms:::key/abc', keyId: 'abc' } } };
        },
      };
      const body = await kms.describeKey('abc');
      assert(capturedRequest.keyId === 'abc');
      assert(body.keyMetadata.arn === 'acs:kms:::key/abc');
    });

    it('should resolve the key ARN and enable deletion protection', async () => {
      const kms = new AliyunKmsClient(createDefaultConfiguration({}));
      let protectRequest: any;
      (kms as any).models = {
        DescribeKeyRequest: function (params: any) { return params; },
        SetDeletionProtectionRequest: function (params: any) { return params; },
      };
      (kms as any).client = {
        describeKey: async () => ({ body: { keyMetadata: { arn: 'acs:kms:::key/abc' } } }),
        setDeletionProtection: async (request: any) => { protectRequest = request; return { body: {} }; },
      };
      await kms.setDeletionProtection('abc');
      assert(protectRequest.protectedResourceArn === 'acs:kms:::key/abc');
      assert(protectRequest.enableDeletionProtection === true);
    });
  });

  describe('ConfigCipher.protectKey', () => {

    it('should enable deletion protection on the configured key id', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      await cipher.protectKey();
      assert(kms.setDeletionProtectionCalls.length === 1);
      assert(kms.setDeletionProtectionCalls[0] === 'alias/my-key');
    });

    it('should swallow protection failures so config operations are never blocked', async () => {
      const kms = new FakeKmsClient();
      (kms as any).setDeletionProtection = async () => { throw new Error('protection denied'); };
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      await cipher.protectKey();
      assert(true, 'protectKey must not propagate errors');
    });

    it('should be a no-op when no KMS key/client/factory is configured', async () => {
      let protectionCalls = 0;
      // Without any KMS wiring, getKmsClient() would lazily build the public-gateway client and
      // protect the MSE default key. The guard must short-circuit before any client is created.
      mm(AliyunKmsClient.prototype, 'setDeletionProtection', async () => { protectionCalls++; });
      const cipher = newCipher({});
      await cipher.protectKey();
      assert(protectionCalls === 0, 'protectKey must not touch KMS when nothing KMS-related is configured');
    });

    it('should auto-trigger best-effort CMK protection when a cipher- config is encrypted', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      // Java's KmsEncryptor.encrypt() calls protectKeyId() automatically; encrypting a cipher-
      // config must schedule the same best-effort deletion protection without being asked.
      await cipher.encryptIfNeeded('cipher-myapp', 'token=abc');
      await flush();
      assert(kms.setDeletionProtectionCalls.length === 1,
        'encrypting a cipher- config must auto-trigger CMK deletion protection (aligns with Java)');
      assert(kms.setDeletionProtectionCalls[0] === 'alias/my-key');
    });

    it('should protect each keyId at most once across repeated publishes', async () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      await cipher.encryptIfNeeded('cipher-a', 'v1');
      await cipher.encryptIfNeeded('cipher-b', 'v2');
      await flush();
      assert(kms.setDeletionProtectionCalls.length === 1, 'protection must be deduplicated per keyId');
    });

    it('should not rebuild the KMS client when protectKey() runs after close()', async () => {
      // close() only flips `closed` and releases the built client; it neither nulls the reference
      // nor blocks later calls. A protectKey() still in flight (or invoked directly) after close()
      // would otherwise hit getKmsClient() and lazily rebuild a client nobody will ever close.
      let factoryCalls = 0;
      const cipher = newCipher({
        kmsKeyId: 'alias/my-key',
        kmsClientFactory: () => { factoryCalls++; return new FakeKmsClient(); },
      });
      cipher.close();
      await cipher.protectKey();
      assert(factoryCalls === 0, 'protectKey() after close() must not rebuild the KMS client');
    });
  });

  describe('close() resource cleanup (KMS client cascade)', () => {

    it('should close an injected KMS client that supports close() when the cipher is closed', () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      // Java's KmsEncryptor is Closeable and AliyunConfigFilter.close() cascades to it; the nodejs
      // cipher must likewise release a custom KMS client (e.g. a DKMS adapter) when it is closed.
      cipher.close();
      assert(kms.closeCalls === 1, 'ConfigCipher.close() must cascade to kmsClient.close()');
    });

    it('should be idempotent: closing the cipher twice closes the KMS client once', () => {
      const kms = new FakeKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      cipher.close();
      cipher.close();
      assert(kms.closeCalls === 1, 'close() must be idempotent (mirrors Java Closeable)');
    });

    it('should not throw when closing a cipher whose KMS client has no close()', () => {
      // close() is optional on IKmsClient; a client without it must be handled gracefully.
      const kms = new FailingDecryptKmsClient();
      const cipher = newCipher({ kmsKeyId: 'alias/my-key' }, kms);
      cipher.close();
      assert(typeof (kms as any).close === 'undefined', 'sanity: this KMS client exposes no close()');
    });

    it('should cascade close() from ClientWorker to the cipher KMS client (HTTP mode)', () => {
      const kms = new FakeKmsClient();
      const worker = createCipherClient(kms);
      worker.close();
      assert(kms.closeCalls === 1, 'ClientWorker.close() must cascade to cipher.close()');
    });

    it('should cascade close() from DataClient to the cipher KMS client (gRPC mode)', () => {
      const kms = new FakeKmsClient();
      const client = createGrpcCipherClient(kms);
      client.close();
      assert(kms.closeCalls === 1, 'DataClient.close() must cascade to cipher.close()');
    });
  });

  describe('ConfigCipher KMS client factory (ClientKey/DKMS seam)', () => {

    it('should build the KMS client through kmsClientFactory when no client is injected', async () => {
      const kms = new FakeKmsClient();
      let factoryCalls = 0;
      // Guard: if resolution wrongly falls through to the public-gateway client, fail fast and
      // loudly instead of attempting a real (network) KMS call.
      mm(AliyunKmsClient.prototype, 'encrypt', async () => { throw new Error('fallback AliyunKmsClient was used'); });
      const cipher = newCipher({ kmsClientFactory: () => { factoryCalls++; return kms; } });

      await cipher.encryptIfNeeded('cipher-myapp', 'token=abc');

      assert(factoryCalls === 1, 'kmsClientFactory must build the client exactly once');
      assert(kms.encryptCalls.length === 1, 'the factory-built client must perform the KMS call');
      assert(kms.encryptCalls[0].plaintext === Buffer.from('token=abc', 'utf8').toString('base64'));
    });

    it('should hand the configuration to kmsClientFactory so ClientKey/DKMS options are readable', async () => {
      const kms = new FakeKmsClient();
      mm(AliyunKmsClient.prototype, 'encrypt', async () => { throw new Error('fallback AliyunKmsClient was used'); });
      let received: any;
      const cipher = newCipher({
        kmsClientFactory: (config: any) => { received = config; return kms; },
        kmsClientKeyContent: 'client-key-json',
        kmsClientKeyFilePath: '/etc/nacos/clientKey.json',
        kmsPassword: 'client-key-password',
        kmsCaFileContent: 'ca-pem',
        kmsCaFilePath: '/etc/nacos/ca.pem',
        kmsEndpoint: 'instance-id.cryptoservice.kms.aliyuncs.com',
      });

      await cipher.encryptIfNeeded('cipher-myapp', 'token=abc');

      assert(received, 'kmsClientFactory must receive the client configuration');
      assert(received.get(ClientOptionKeys.KMS_CLIENT_KEY_CONTENT) === 'client-key-json');
      assert(received.get(ClientOptionKeys.KMS_CLIENT_KEY_FILE_PATH) === '/etc/nacos/clientKey.json');
      assert(received.get(ClientOptionKeys.KMS_PASSWORD) === 'client-key-password');
      assert(received.get(ClientOptionKeys.KMS_CA_FILE_CONTENT) === 'ca-pem');
      assert(received.get(ClientOptionKeys.KMS_CA_FILE_PATH) === '/etc/nacos/ca.pem');
      assert(received.get(ClientOptionKeys.KMS_ENDPOINT) === 'instance-id.cryptoservice.kms.aliyuncs.com');
    });

    it('should prefer an explicitly injected KMS client over kmsClientFactory', async () => {
      const injected = new FakeKmsClient();
      const fromFactory = new FakeKmsClient();
      let factoryCalls = 0;
      const cipher = newCipher(
        { kmsClientFactory: () => { factoryCalls++; return fromFactory; } },
        injected,
      );

      await cipher.encryptIfNeeded('cipher-myapp', 'token=abc');

      assert(factoryCalls === 0, 'an injected client must win; kmsClientFactory must not run');
      assert(injected.encryptCalls.length === 1);
      assert(fromFactory.encryptCalls.length === 0);
    });

    it('should memoize the factory-built KMS client across repeated cipher operations', async () => {
      const kms = new FakeKmsClient();
      let factoryCalls = 0;
      mm(AliyunKmsClient.prototype, 'encrypt', async () => { throw new Error('fallback AliyunKmsClient was used'); });
      const cipher = newCipher({ kmsClientFactory: () => { factoryCalls++; return kms; } });

      // Two separate cipher operations must reuse the one factory-built client, not rebuild it.
      await cipher.encryptIfNeeded('cipher-myapp', 'token=abc');
      await cipher.encryptIfNeeded('cipher-myapp', 'token=def');

      assert(factoryCalls === 1, 'kmsClientFactory must be memoized: built once, reused thereafter');
      assert(kms.encryptCalls.length === 2, 'both operations must go through the same cached client');
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

    it('should pass a bare cipher- failover file through as plaintext without KMS decrypt', async () => {
      const kms = new FakeKmsClient();
      const client = createCipherClient(kms);
      // readConfigWithFailover reads the user-maintained failover file first (source='failover');
      // its content is plaintext by contract, so a bare cipher- dataId must NOT be sent to KMS.
      mm(client.snapshot, 'getFailover', async () => 'plain-failover-value');
      const value = await client.getConfig('cipher-myapp', 'DEFAULT_GROUP');
      assert(value === 'plain-failover-value', 'failover plaintext must pass through undecrypted');
      assert(kms.decryptCalls.length === 0, 'failover content must never reach KMS decrypt');
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
