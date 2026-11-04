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
import * as crypto from 'crypto';
import { ClientOptionKeys, IConfiguration } from './interface';
import { resolveAliyunCredentialsAsync } from './aliyun_auth';

const fs = require('mz/fs');

/** dataId prefix that triggers KMS envelope encryption (aligned with Java / Go / Python SDK). */
export const CIPHER_PREFIX = 'cipher-';

/** HTTP response header the server uses to carry the encryptedDataKey back on config reads. */
export const ENCRYPTED_DATA_KEY_HEADER = 'Encrypted-Data-Key';

/** HTTP publish form parameter / gRPC additionMap key used to carry the encryptedDataKey. */
export const ENCRYPTED_DATA_KEY_PARAM = 'encryptedDataKey';

/**
 * An envelope (`cipher-kms-aes-*`) config arrived without its encryptedDataKey. The payload is
 * structurally incomplete, so retrying the same response can never succeed -- only a fresh
 * server response with the key can. Mirrors the Java KmsEncryptor, which rejects a blank key
 * before calling KMS and does not fall back to its plaintext cache.
 */
export class CipherDataKeyMissingError extends Error {
  constructor(dataId: string) {
    super(`cannot decrypt ${dataId}: encryptedDataKey is missing from the server response`);
    this.name = 'CipherDataKeyMissingError';
  }
}

/** Whether a decrypt failure is caused by a payload that cannot recover by being retried. */
export function isCipherDataKeyMissingError(err: any): boolean {
  return !!err && err.name === 'CipherDataKeyMissingError';
}

const KMS_AES_128_ALGORITHM = 'cipher-kms-aes-128';
const KMS_AES_256_ALGORITHM = 'cipher-kms-aes-256';
const AES_128_KEY_SPEC = 'AES_128';
const AES_256_KEY_SPEC = 'AES_256';
// MSE-managed default CMK alias, used when no explicit kmsKeyId is configured (aligned with Go / Python SDK).
const DEFAULT_KMS_KEY_ID = 'alias/acs/mse';
// KMS gateway calls ride out transient throttling/network blips with a small fixed-delay
// retry loop, matching the resilience of the Java / Go SDKs on the public gateway.
const KMS_MAX_ATTEMPTS = 3;
const KMS_RETRY_DELAY_MS = 200;
// Overall deadline for one KMS operation across all retries, aligned with the Java KmsEncryptor
// defaultTimeoutMilliseconds. Bounds the worst-case stall to this budget rather than
// attempts * delay when the gateway hangs or keeps throttling.
const KMS_TIMEOUT_MS = 3000;
// Data-key cache defaults: bounded, and entries age out so a rotated data key is
// eventually re-fetched instead of being pinned in memory forever.
const DEFAULT_KMS_CACHE_MAX_SIZE = 1000;
const DEFAULT_KMS_CACHE_AFTER_ACCESS_MS = 60 * 60 * 1000;
const DEFAULT_KMS_CACHE_AFTER_WRITE_MS = 24 * 60 * 60 * 1000;

// Algorithm name -> KMS key spec. The prefixes are equal length and mutually exclusive, so
// matchKeySpec below can stop at the first hit; keep it that way if a new entry is added.
const ALGORITHM_KEY_SPECS: Array<{ prefix: string; keySpec: string }> = [
  { prefix: KMS_AES_128_ALGORITHM, keySpec: AES_128_KEY_SPEC },
  { prefix: KMS_AES_256_ALGORITHM, keySpec: AES_256_KEY_SPEC },
];

/**
 * Minimal KMS surface required by the cipher. Kept small and injectable so the
 * Alibaba Cloud SDK stays an optional dependency and unit tests need no network.
 *
 * BREAKING (vs. the earlier envelope-only surface): `encrypt` is now a required member. A custom
 * client that previously implemented only generateDataKey/decrypt must add `encrypt` to keep
 * supporting bare `cipher-` dataIds (the direct, non-envelope path); describeKey and
 * setDeletionProtection remain optional.
 *
 * Wire contract: values pass through ConfigCipher untouched in both directions -- `encrypt` takes
 * the raw config text and returns an opaque Base64 ciphertext blob, `decrypt` takes a blob and
 * returns whatever KMS decrypted. What that decrypted value means depends on the caller: on the
 * direct bare `cipher-` path it is the config text itself, while on the envelope path `decrypt` is
 * handed an `encryptedDataKey` and returns a Base64 data key (same as `generateDataKey`'s
 * `plaintext`), which ConfigCipher Base64-decodes before using it as an AES key.
 */
export interface IKmsClient {
  /** Encrypt: directly encrypts the config text under the CMK, for bare `cipher-` dataIds that carry no envelope data key. The plaintext goes on the wire raw (not Base64-wrapped) so other SDKs can read it; returns the opaque KMS ciphertext blob. */
  encrypt(plaintext: string, keyId?: string): Promise<string>;
  /** GenerateDataKey: returns the Base64 plaintext data key and its KMS-encrypted form. */
  generateDataKey(keyId: string, keySpec: string): Promise<{ plaintext: string; ciphertextBlob: string }>;
  /** Decrypt: turns a ciphertext blob back into its plaintext -- a Base64 data key on the envelope path, or the raw config text on the direct bare `cipher-` path. */
  decrypt(ciphertextBlob: string): Promise<string>;
  /** DescribeKey: returns CMK metadata (optional; used to resolve the key ARN for deletion protection). */
  describeKey?(keyId: string): Promise<any>;
  /** SetDeletionProtection: best-effort safety net that stops the CMK being deleted by accident (optional). */
  setDeletionProtection?(keyId: string, metadata?: any): Promise<void>;
  /** Release underlying resources (optional). ConfigCipher.close() calls this so a custom client (e.g. a ClientKey/DKMS adapter) can shut down its connection pool or async workers. */
  close?(): void | Promise<void>;
}

/**
 * Builds a custom {@link IKmsClient} from the client configuration. This is the seam that lets an
 * application plug in a ClientKey/DKMS client (dedicated KMS instance) without nacos-config taking a
 * hard dependency on that SDK: the app supplies the factory and reads the DKMS passthrough options
 * (kmsClientKeyContent/FilePath, kmsPassword, kmsCaFileContent/FilePath, kmsEndpoint) off the
 * configuration it is handed. A dedicated gateway reached with AK/STS needs no factory — the
 * built-in client honors kmsCaFileContent/kmsCaFilePath itself.
 */
export type KmsClientFactory = (configuration: IConfiguration) => IKmsClient;

/** Result of an encrypt pass: the (possibly encrypted) content plus the data key to carry. */
export interface EncryptResult {
  content: string;
  encryptedDataKey?: string;
}

/** A cached plaintext data key plus the timestamps used to age it out. */
interface DataKeyCacheItem {
  value: string;
  createdAt: number;
  accessedAt: number;
}

function isCipherDataId(dataId: string): boolean {
  return typeof dataId === 'string' && dataId.indexOf(CIPHER_PREFIX) === 0;
}

function matchKeySpec(dataId: string): string | null {
  for (const algorithm of ALGORITHM_KEY_SPECS) {
    if (dataId.indexOf(algorithm.prefix) === 0) {
      return algorithm.keySpec;
    }
  }
  return null;
}

function aesAlgorithmForKeyLength(keyLength: number): string {
  switch (keyLength) {
    case 16:
      return 'aes-128-ecb';
    case 24:
      return 'aes-192-ecb';
    case 32:
      return 'aes-256-ecb';
    default:
      throw new Error(`[Nacos#Cipher] unsupported AES key length: ${keyLength}`);
  }
}

// AES/ECB/PKCS5Padding, kept for cross-SDK interoperability. node auto-padding is PKCS#7,
// which is identical to PKCS#5 for the 16-byte AES block size.
// The payload charset is pinned to UTF-8 and deliberately does NOT follow the client-level
// defaultEncoding: that option describes how HTTP response bodies are decoded off the wire, whereas
// this is the shared cross-language ciphertext format -- Java (AesUtils, ENCODE_UTF8), Go
// (DecodeString2Utf8Bytes) and Python (content.encode("utf-8")) all encrypt UTF-8 bytes, and one
// dataId is read by all of them. Honouring a per-client charset here would let a GBK-configured
// client write ciphertext every other SDK decodes as mojibake.
function aesEcbEncryptToBase64(plaintext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const cipher = crypto.createCipheriv(aesAlgorithmForKeyLength(key.length), key, null);
  const encrypted = Buffer.concat([ cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final() ]);
  return encrypted.toString('base64');
}

function aesEcbDecryptFromBase64(base64Ciphertext: string, base64Key: string): string {
  const key = Buffer.from(base64Key, 'base64');
  const decipher = crypto.createDecipheriv(aesAlgorithmForKeyLength(key.length), key, null);
  const decrypted = Buffer.concat([ decipher.update(Buffer.from(base64Ciphertext, 'base64')), decipher.final() ]);
  return decrypted.toString('utf8');
}

/**
 * First present (non-null, non-empty) value among `names`. KMS OpenAPI responses vary between
 * camelCase and PascalCase across SDK versions, so field lookups tolerate both spellings.
 */
function pickFirstValue(source: any, names: string[]): any {
  if (!source) {
    return undefined;
  }
  for (const name of names) {
    const value = source[name];
    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Default {@link IKmsClient} backed by the Alibaba Cloud public-gateway OpenAPI SDK
 * (`@alicloud/kms20160120`). The SDK is an optional dependency and is required lazily,
 * so non-KMS users are never forced to install it. Credentials reuse `aliyun_auth` (AK/SK).
 */
export class AliyunKmsClient implements IKmsClient {

  private configuration: IConfiguration;
  private client: any;
  private models: any;
  // Fingerprint (credentials + endpoint + region) that `client` was built from. `null` means the
  // client was injected directly and is returned as-is; otherwise a change forces a rebuild so a
  // credential rotation reaches KMS instead of being pinned to the first-resolved secret forever.
  private clientCredentialsKey: string | null = null;
  // Overall retry deadline (ms) for this client. Defaults to KMS_TIMEOUT_MS; held as a field so
  // it can be tuned and so tests can shrink it instead of waiting on the real 3s budget.
  private timeoutMs = KMS_TIMEOUT_MS;
  // Memoized CA resolution. Both sources are client options fixed for this client's lifetime,
  // so re-reading a PEM from disk on every encrypt/decrypt would be pure waste. Consequence: a CA
  // file rotated in place is not picked up until the process restarts -- same as the Java and Go
  // clients, which also read the CA once at client construction. A rejected read is NOT memoized,
  // so a transient filesystem error can recover on the next call instead of poisoning the client.
  private caPromise: Promise<string | undefined> | null = null;

  constructor(configuration: IConfiguration) {
    this.configuration = configuration;
  }

  private async ensureClient(): Promise<any> {
    // A client assigned directly (no tracked fingerprint) is used verbatim; this keeps the client
    // injectable and honors any externally provided instance.
    if (this.client && this.clientCredentialsKey === null) {
      return this.client;
    }
    // ClientKey/AAP authentication needs the DKMS instance protocol (protobuf body + RSA request
    // signing), which this client does not speak. Rejecting here beats an opaque signature failure
    // from the gateway and points at the seam that does support it.
    if (this.configuration.get(ClientOptionKeys.KMS_CLIENT_KEY_CONTENT) ||
      this.configuration.get(ClientOptionKeys.KMS_CLIENT_KEY_FILE_PATH)) {
      throw new Error('[Nacos#Cipher] kmsClientKeyContent / kmsClientKeyFilePath require a kmsClientFactory: ' +
        'the built-in client authenticates with AK/STS (plus an optional CA for a dedicated gateway) ' +
        'and cannot use a ClientKey.');
    }
    let kmsModule: any;
    try {
      kmsModule = require('@alicloud/kms20160120');
    } catch (err) {
      throw new Error('[Nacos#Cipher] KMS-encrypted config requires the optional dependency ' +
        '"@alicloud/kms20160120". Run `npm install @alicloud/kms20160120` to use cipher- dataIds.');
    }
    const ClientCtor = kmsModule.default || kmsModule;
    const credentials = await resolveAliyunCredentialsAsync(this.configuration);
    const endpoint = this.configuration.get(ClientOptionKeys.KMS_ENDPOINT);
    const regionId = this.configuration.get(ClientOptionKeys.KMS_REGION_ID) || credentials.signatureRegionId;
    // Rebuild the client whenever the resolved credentials (or endpoint/region) change, so a
    // rotated AK/SK or refreshed STS token actually reaches KMS instead of being pinned forever.
    const credentialsKey = [
      credentials.accessKeyId,
      credentials.accessKeySecret,
      credentials.securityToken || '',
      endpoint || '',
      regionId || '',
    ].join('|');
    if (this.client && this.clientCredentialsKey === credentialsKey) {
      return this.client;
    }
    const config: any = {
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      // Bound each KMS request individually so a hung gateway terminates instead of stalling the
      // retry loop's overall deadline (mirrors the Java client's per-request RuntimeOptions timeout).
      readTimeout: this.timeoutMs,
      connectTimeout: this.timeoutMs,
    };
    if (credentials.securityToken) {
      config.securityToken = credentials.securityToken;
      config.type = 'sts';
    } else {
      config.type = 'access_key';
    }
    if (endpoint) {
      config.endpoint = endpoint;
    }
    if (regionId) {
      config.regionId = regionId;
    }
    const ca = await this.resolveCa();
    if (ca) {
      // A dedicated gateway (<instance>.cryptoservice.kms.aliyuncs.com) presents a private CA; the
      // shared gateway uses a publicly trusted one and needs nothing here. Only set it when
      // non-empty: an empty string would be forwarded to node's https as ca:'' and break the
      // handshake for the public-gateway case.
      config.ca = ca;
    }
    this.models = kmsModule;
    this.client = new ClientCtor(config);
    this.clientCredentialsKey = credentialsKey;
    return this.client;
  }

  private resolveCa(): Promise<string | undefined> {
    if (!this.caPromise) {
      this.caPromise = this.loadCa().catch(err => {
        this.caPromise = null;
        throw err;
      });
    }
    return this.caPromise;
  }

  private async loadCa(): Promise<string | undefined> {
    const content = this.configuration.get(ClientOptionKeys.KMS_CA_FILE_CONTENT);
    if (content) {
      return content;
    }
    const filePath = this.configuration.get(ClientOptionKeys.KMS_CA_FILE_PATH);
    if (!filePath) {
      return undefined;
    }
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (err) {
      throw new Error(`[Nacos#Cipher] cannot read kmsCaFilePath "${filePath}": ${err.message}`);
    }
  }

  private async requestWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    const begin = Date.now();
    let lastError: any;
    let attempts = 0;
    // Mirrors the Java KmsEncryptor.locallyRunWithRetryTimesAndTimeout loop: retry only while
    // attempts remain AND the overall deadline has not passed, so a hung or persistently
    // throttling gateway cannot stall a config operation for the full attempts * delay budget.
    while (attempts < KMS_MAX_ATTEMPTS && Date.now() < begin + this.timeoutMs) {
      attempts++;
      try {
        return await operation();
      } catch (err) {
        lastError = err;
        if (attempts < KMS_MAX_ATTEMPTS) {
          await new Promise(resolve => setTimeout(resolve, KMS_RETRY_DELAY_MS));
        }
      }
    }
    // Guarantee a real Error even when the deadline precluded any attempt (never throw undefined).
    throw lastError || new Error('[Nacos#Cipher] KMS request did not complete within the timeout budget');
  }

  async encrypt(plaintext: string, keyId?: string): Promise<string> {
    return this.requestWithRetry(async () => {
      const client = await this.ensureClient();
      const request = new this.models.EncryptRequest({ keyId: keyId || DEFAULT_KMS_KEY_ID, plaintext });
      const response = await client.encrypt(request);
      const ciphertextBlob = response && response.body ? response.body.ciphertextBlob : undefined;
      if (!ciphertextBlob) {
        throw new Error('[Nacos#Cipher] KMS Encrypt returned an empty ciphertext');
      }
      return ciphertextBlob;
    });
  }

  async generateDataKey(keyId: string, keySpec: string): Promise<{ plaintext: string; ciphertextBlob: string }> {
    return this.requestWithRetry(async () => {
      const client = await this.ensureClient();
      const request = new this.models.GenerateDataKeyRequest({ keyId, keySpec });
      const response = await client.generateDataKey(request);
      const body = response && response.body ? response.body : {};
      if (!body.plaintext || !body.ciphertextBlob) {
        throw new Error('[Nacos#Cipher] KMS GenerateDataKey returned an empty data key');
      }
      return { plaintext: body.plaintext, ciphertextBlob: body.ciphertextBlob };
    });
  }

  async decrypt(ciphertextBlob: string): Promise<string> {
    return this.requestWithRetry(async () => {
      const client = await this.ensureClient();
      const request = new this.models.DecryptRequest({ ciphertextBlob });
      const response = await client.decrypt(request);
      const plaintext = response && response.body ? response.body.plaintext : undefined;
      if (!plaintext) {
        throw new Error('[Nacos#Cipher] KMS Decrypt returned an empty plaintext');
      }
      return plaintext;
    });
  }

  async describeKey(keyId: string): Promise<any> {
    return this.requestWithRetry(async () => {
      const client = await this.ensureClient();
      const request = new this.models.DescribeKeyRequest({ keyId });
      const response = await client.describeKey(request);
      return response && response.body ? response.body : {};
    });
  }

  async setDeletionProtection(keyId: string, metadata?: any): Promise<void> {
    const keyMetadata = metadata || (await this.describeKey(keyId));
    const arn = pickFirstValue(keyMetadata, [ 'arn', 'Arn' ]) ||
      pickFirstValue(pickFirstValue(keyMetadata, [ 'keyMetadata', 'KeyMetadata' ]), [ 'arn', 'Arn' ]);
    if (!arn) {
      return;
    }
    await this.requestWithRetry(async () => {
      const client = await this.ensureClient();
      const request = new this.models.SetDeletionProtectionRequest({
        protectedResourceArn: arn,
        enableDeletionProtection: true,
        deletionProtectionDescription: 'key is used by nacos-sdk-nodejs encrypted config',
      });
      await client.setDeletionProtection(request);
    });
  }
}

/**
 * In-memory plaintext data-key cache keyed by the KMS-encrypted data key, with a size bound
 * (FIFO eviction of the oldest entry) and per-item expiry (after-access / after-write). Mirrors
 * the Java KmsLocalCache: it avoids a KMS round trip on every config read/notification and is
 * never persisted, so a plaintext data key lives only in process memory.
 */
class DataKeyCache {

  private readonly configuration: IConfiguration;
  private readonly items = new Map<string, DataKeyCacheItem>();

  constructor(configuration: IConfiguration) {
    this.configuration = configuration;
  }

  get(encryptedDataKey: string): string {
    if (!this.isEnabled()) {
      return null;
    }
    const item = this.items.get(encryptedDataKey);
    if (!item) {
      return null;
    }
    if (this.isExpired(item)) {
      this.items.delete(encryptedDataKey);
      return null;
    }
    item.accessedAt = Date.now();
    return item.value;
  }

  put(encryptedDataKey: string, plaintext: string): void {
    if (!this.isEnabled()) {
      return;
    }
    const now = Date.now();
    this.items.set(encryptedDataKey, { value: plaintext, createdAt: now, accessedAt: now });
    const maxSize = this.maxSize();
    while (this.items.size > maxSize) {
      const oldestKey = this.items.keys().next().value;
      this.items.delete(oldestKey);
    }
  }

  clear(): void {
    this.items.clear();
  }

  private isEnabled(): boolean {
    return this.configuration.get(ClientOptionKeys.KMS_CACHE_ENABLED) !== false;
  }

  private maxSize(): number {
    const maxSize = Number(this.configuration.get(ClientOptionKeys.KMS_CACHE_MAX_SIZE));
    return maxSize > 0 ? maxSize : DEFAULT_KMS_CACHE_MAX_SIZE;
  }

  private isExpired(item: DataKeyCacheItem): boolean {
    const afterAccessSeconds = Number(this.configuration.get(ClientOptionKeys.KMS_CACHE_AFTER_ACCESS_SECONDS));
    const afterWriteSeconds = Number(this.configuration.get(ClientOptionKeys.KMS_CACHE_AFTER_WRITE_SECONDS));
    const afterAccess = afterAccessSeconds > 0 ? afterAccessSeconds * 1000 : DEFAULT_KMS_CACHE_AFTER_ACCESS_MS;
    const afterWrite = afterWriteSeconds > 0 ? afterWriteSeconds * 1000 : DEFAULT_KMS_CACHE_AFTER_WRITE_MS;
    const now = Date.now();
    return (now - item.accessedAt) > afterAccess || (now - item.createdAt) > afterWrite;
  }
}

/**
 * Applies KMS encryption/decryption to config content, triggered by the `cipher-` dataId prefix.
 * Two shapes, both mirroring the Java / Go / Python clients:
 *   - `cipher-kms-aes-128-*` / `cipher-kms-aes-256-*` (envelope): GenerateDataKey → AES/ECB/PKCS5
 *     over the UTF-8 content with the Base64-decoded data key → Base64, carrying the KMS-encrypted
 *     data key alongside as `encryptedDataKey`.
 *   - any other `cipher-*` (direct): the whole value goes to KMS Encrypt/Decrypt as-is.
 * The plaintext data key is cached in memory (keyed by encryptedDataKey) to avoid a KMS round trip
 * on every read/notification, and is never persisted.
 */
export class ConfigCipher {

  private configuration: IConfiguration;
  private kmsClient: IKmsClient | null;
  private readonly dataKeyCache: DataKeyCache;
  private readonly scheduledKeyProtections = new Set<string>();
  private closed = false;

  constructor(configuration: IConfiguration, kmsClient?: IKmsClient) {
    this.configuration = configuration;
    this.kmsClient = kmsClient || null;
    this.dataKeyCache = new DataKeyCache(configuration);
  }

  isCipherDataId(dataId: string): boolean {
    return isCipherDataId(dataId);
  }

  /**
   * Encrypt content before publish. Non-cipher dataIds (and empty content) pass through
   * untouched so the plaintext path is unaffected.
   */
  async encryptIfNeeded(dataId: string, content: string): Promise<EncryptResult> {
    if (!isCipherDataId(dataId)) {
      return { content };
    }
    if (content === null || content === undefined || content === '') {
      return { content };
    }
    // Aligning with the Java KmsEncryptor.encrypt(), which calls protectKeyId() as part of
    // publishing an encrypted config: schedule CMK deletion protection here (best-effort and
    // off the publish path) instead of relying on callers to remember to protect the key.
    this.scheduleKeyProtection();
    const keySpec = matchKeySpec(dataId);
    if (!keySpec) {
      // Bare `cipher-*` dataId (no envelope data key): let KMS encrypt the whole value directly,
      // matching the legacy Nacos / Java KMS path where the CMK protects the content itself.
      // The config text goes on the wire as-is: Java (RamKmsEncryptor.encrypt), Go
      // (KmsBasePlugin + RamKmsClient.Encrypt) and the official KMS transfer SDKs all pass the raw
      // string here, and the transfer handlers turn it into bytes with no Base64 decode. Wrapping it
      // would self-round-trip but leave every other SDK reading this dataId as garbage.
      const encrypted = await this.getKmsClient().encrypt(content, this.getKeyId());
      return { content: encrypted };
    }
    const { plaintext, ciphertextBlob } = await this.getKmsClient().generateDataKey(this.getKeyId(), keySpec);
    this.dataKeyCache.put(ciphertextBlob, plaintext);
    return {
      content: aesEcbEncryptToBase64(content, plaintext),
      encryptedDataKey: ciphertextBlob,
    };
  }

  /**
   * Decrypt content read from the server or the local snapshot. Non-cipher dataIds and empty
   * content pass through unchanged. Bare `cipher-*` dataIds are decrypted directly by KMS.
   * Envelope `cipher-kms-aes-*` dataIds need the encryptedDataKey that travels with the content;
   * without it the payload cannot be decrypted, so it is reported as an error instead of being
   * handed back as if it were plaintext (the Java extension throws on the same condition).
   * `isFailover` marks content read from a user-maintained failover file, which is plaintext by
   * contract (see disaster_recovery) and is never sent to KMS -- for any cipher dataId shape,
   * including bare `cipher-*` whose server form is direct KMS ciphertext.
   */
  async decryptIfNeeded(dataId: string, content: string, encryptedDataKey?: string, isFailover?: boolean): Promise<string> {
    if (isFailover) {
      // Failover content is a user-maintained plaintext emergency file, never KMS ciphertext, so
      // it passes through undecrypted for every cipher dataId shape (bare `cipher-*` included).
      return content;
    }
    if (!isCipherDataId(dataId)) {
      return content;
    }
    if (content === null || content === undefined || content === '') {
      return content;
    }
    if (!matchKeySpec(dataId)) {
      // Bare `cipher-*` dataId: the content itself is KMS ciphertext, so decrypt it directly. The
      // service hands back the exact string that was encrypted -- the raw config text -- so return
      // it verbatim. (The envelope path below gets the same verbatim value, but there the payload is
      // a Base64 data key rather than user text, which is why only that path decodes it.)
      return await this.getKmsClient().decrypt(content);
    }
    if (!encryptedDataKey) {
      throw new CipherDataKeyMissingError(dataId);
    }
    const plainDataKey = await this.resolvePlainDataKey(encryptedDataKey);
    return aesEcbDecryptFromBase64(content, plainDataKey);
  }

  /**
   * Schedule {@link protectKey} off the publish path, mirroring the Java KmsEncryptor which
   * protects the CMK automatically on every encrypt. Deduplicated per keyId so repeated
   * publishes of the same key trigger at most one protection attempt, and fire-and-forget so
   * it never blocks or fails the config publish. protectKey() already swallows protection
   * errors; the trailing catch only keeps the detached promise from an unhandled rejection and
   * clears the marker so a later publish can retry if scheduling itself throws.
   */
  private scheduleKeyProtection(): void {
    const keyId = this.getKeyId();
    if (this.scheduledKeyProtections.has(keyId)) {
      return;
    }
    this.scheduledKeyProtections.add(keyId);
    Promise.resolve()
      .then(() => this.protectKey())
      .catch(() => this.scheduledKeyProtections.delete(keyId));
  }

  /**
   * Best-effort: enable deletion protection on the CMK backing encrypted configs so it cannot be
   * removed by accident. Opt-in and never throws - a protection failure must not block config
   * operations. No-op when the KMS client does not support deletion protection.
   */
  async protectKey(): Promise<void> {
    // A closed cipher must never resurrect a KMS client. protectKey can still be in flight
    // (scheduled fire-and-forget by a publish) or invoked directly after close(); without this
    // guard getKmsClient() would lazily rebuild a client that nobody will ever close again.
    if (this.closed) {
      return;
    }
    // Only protect a key the user actually wired KMS for. Without any KMS configuration
    // (kmsKeyId / kmsClient / kmsClientFactory), getKmsClient() would lazily build the
    // public-gateway client and touch the MSE default key -- a surprising side effect for
    // callers that never opted into KMS. Mirrors the fork's guard.
    const configured = this.configuration.get(ClientOptionKeys.KMS_KEY_ID) ||
      this.configuration.get(ClientOptionKeys.KMS_CLIENT) ||
      this.configuration.get(ClientOptionKeys.KMS_CLIENT_FACTORY);
    if (!configured) {
      return;
    }
    const kmsClient = this.getKmsClient();
    if (!kmsClient.setDeletionProtection) {
      return;
    }
    try {
      await kmsClient.setDeletionProtection(this.getKeyId());
    } catch (_) {
      // Key protection is best effort; swallow so config operations are never blocked.
    }
  }

  /**
   * Release resources held by the cipher, cascading to the KMS client's optional close() so a
   * custom client (e.g. a ClientKey/DKMS adapter) can shut down its connection pool or async
   * workers. Mirrors the Java KmsEncryptor being Closeable and AliyunConfigFilter.close()
   * cascading to it. Idempotent and never throws: cleanup must not break client shutdown. A
   * close() that returns a promise has its rejection swallowed so teardown cannot surface an
   * unhandled rejection. Uses the already-built client (never getKmsClient()) so closing a
   * cipher that never touched KMS does not lazily build a client just to close it.
   */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.dataKeyCache.clear();
    this.scheduledKeyProtections.clear();
    const kmsClient = this.kmsClient;
    if (kmsClient && kmsClient.close) {
      const result = kmsClient.close();
      if (result && typeof (result as Promise<void>).catch === 'function') {
        (result as Promise<void>).catch(() => {
          // Best-effort cleanup: a KMS client close failure must never break shutdown.
        });
      }
    }
  }

  private async resolvePlainDataKey(encryptedDataKey: string): Promise<string> {
    const cached = this.dataKeyCache.get(encryptedDataKey);
    if (cached) {
      return cached;
    }
    const plaintext = await this.getKmsClient().decrypt(encryptedDataKey);
    this.dataKeyCache.put(encryptedDataKey, plaintext);
    return plaintext;
  }

  private getKmsClient(): IKmsClient {
    // close() released whatever client we had. Building another one here would leak a connection
    // pool nothing will ever close again (a late push notification after shutdown is exactly how
    // this gets reached), and reusing the released one fails opaquely inside the transport. Throw a
    // named lifecycle error instead; callers already route cipher failures to their error channel.
    if (this.closed) {
      throw new Error('[Nacos#Cipher] ConfigCipher is closed and can no longer reach KMS');
    }
    if (!this.kmsClient) {
      this.kmsClient = this.createKmsClient();
    }
    return this.kmsClient;
  }

  /**
   * Resolve the KMS client by priority: an explicitly configured client wins, then a
   * {@link KmsClientFactory} (so applications can plug in a ClientKey/DKMS adapter without
   * nacos-config depending on that SDK), then the lazy Alibaba Cloud public-gateway client.
   */
  private createKmsClient(): IKmsClient {
    const injected = this.configuration.get(ClientOptionKeys.KMS_CLIENT);
    if (injected) {
      return injected;
    }
    const factory: KmsClientFactory | undefined = this.configuration.get(ClientOptionKeys.KMS_CLIENT_FACTORY);
    if (typeof factory === 'function') {
      return factory(this.configuration);
    }
    return new AliyunKmsClient(this.configuration);
  }

  private getKeyId(): string {
    return this.configuration.get(ClientOptionKeys.KMS_KEY_ID) || DEFAULT_KMS_KEY_ID;
  }

}

export function createConfigCipher(configuration: IConfiguration): ConfigCipher {
  return new ConfigCipher(configuration, configuration.get(ClientOptionKeys.KMS_CLIENT));
}
