/**
 * Aliyun MSE configuration encryption support.
 *
 * The implementation deliberately keeps the KMS SDK behind a small adapter.
 * This lets applications use ClientKey/DKMS clients without making the
 * optional public gateway SDK a hard dependency of nacos-config.
 */
import * as crypto from 'crypto';

export const CIPHER_PREFIX = 'cipher-';
export const CIPHER_KMS_AES_128_PREFIX = 'cipher-kms-aes-128-';
export const CIPHER_KMS_AES_256_PREFIX = 'cipher-kms-aes-256-';
export const DEFAULT_KMS_KEY_ID = 'alias/acs/mse';

export type KmsKeySpec = 'AES_128' | 'AES_256';

export interface KmsDataKey {
  plaintext: string;
  ciphertext: string;
}

export interface KmsClient {
  encrypt(plaintext: string, keyId?: string): Promise<string>;
  decrypt(ciphertext: string): Promise<string>;
  generateDataKey(keySpec: KmsKeySpec, keyId?: string): Promise<KmsDataKey>;
  describeKey?(keyId: string): Promise<any>;
  setDeletionProtection?(keyId: string, metadata?: any): Promise<void>;
  close?(): Promise<void> | void;
}

export interface KmsCipherOptions {
  kmsClient?: KmsClient;
  kmsClientFactory?: (options: KmsCipherOptions) => KmsClient;
  kmsEndpoint?: string;
  kmsRegionId?: string;
  kmsKeyId?: string;
  kmsCacheEnabled?: boolean;
  kmsCacheMaxSize?: number;
  kmsCacheAfterAccessSeconds?: number;
  kmsCacheAfterWriteSeconds?: number;
  credentials?: any;
  credentialsProvider?: () => Promise<any>;
  kmsClientKeyContent?: string;
  kmsClientKeyFilePath?: string;
  kmsPassword?: string;
  kmsCaFileContent?: string;
  kmsCaFilePath?: string;
  openSSL?: boolean;
}

export interface EncryptedConfig {
  content: string;
  encryptedDataKey?: string;
}

interface CacheItem<T> {
  value: T;
  createdAt: number;
  accessedAt: number;
}

interface ConfigCacheItem {
  dataId: string;
  group: string;
  encryptedContent: string;
  encryptedDataKey?: string;
  plaintextDataKey?: string;
  plaintextContent?: string;
  createdAt: number;
  accessedAt: number;
}

function loadAliyunKmsSdk(): any {
  try {
    // eslint-disable-next-line global-require
    return require('@alicloud/kms20160120');
  } catch (err) {
    const error: any = new Error(
      'KMS encryption requires the optional @alicloud/kms20160120 package, ' +
      'or a custom kmsClient adapter.'
    );
    error.code = 'NACOS_KMS_SDK_MISSING';
    error.cause = err;
    throw error;
  }
}

function responseBody(response: any): any {
  return response && (response.body || response.data || response);
}

function getFirst(source: any, keys: string[]): any {
  for (const key of keys) {
    if (source && source[key] !== undefined && source[key] !== null) {
      return source[key];
    }
  }
  return undefined;
}

/** Public-gateway KMS adapter. The SDK is loaded only on first KMS use. */
export class AliyunKmsClient implements KmsClient {
  private options: KmsCipherOptions;
  private client: any;
  private clientCredentialsKey: string;

  constructor(options: KmsCipherOptions = {}) {
    this.options = options;
  }

  private async getClient(): Promise<any> {
    const rawCredentials = this.options.credentialsProvider ?
      await this.options.credentialsProvider() : this.options.credentials || {};
    const credentials = {
      accessKeyId: rawCredentials.accessKeyId || rawCredentials.accessKey || rawCredentials.alibabaCloudAccessKeyId,
      accessKeySecret: rawCredentials.accessKeySecret || rawCredentials.secretKey || rawCredentials.alibabaCloudAccessKeySecret,
      securityToken: rawCredentials.securityToken || rawCredentials.alibabaCloudSecurityToken,
    };
    const key = [
      credentials.accessKeyId,
      credentials.accessKeySecret,
      credentials.securityToken,
      this.options.kmsEndpoint,
      this.options.kmsRegionId,
    ].join('|');
    if (this.client && this.clientCredentialsKey === key) {
      return this.client;
    }
    const sdk = loadAliyunKmsSdk();
    const Client = sdk.default || sdk;
    const config: any = {
      endpoint: this.options.kmsEndpoint,
      regionId: this.options.kmsRegionId,
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
      securityToken: credentials.securityToken,
    };
    this.client = new Client(config);
    this.clientCredentialsKey = key;
    return this.client;
  }

  private async request(method: string, request: any): Promise<any> {
    let lastError: any;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const client = await this.getClient();
        const baseMethod = method.replace(/WithOptions$/, '');
        const fn = client[method] || client[baseMethod];
        if (typeof fn !== 'function') {
          throw new Error('Aliyun KMS SDK does not expose ' + method);
        }
        const response = fn.length >= 2 ? await fn.call(client, request, {}) : await fn.call(client, request);
        return responseBody(response);
      } catch (err) {
        lastError = err;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    throw lastError;
  }

  async encrypt(plaintext: string, keyId?: string): Promise<string> {
    const body = await this.request('encryptWithOptions', {
      keyId: keyId || DEFAULT_KMS_KEY_ID,
      plaintext,
    });
    return getFirst(body, ['ciphertextBlob', 'CiphertextBlob']);
  }

  async decrypt(ciphertext: string): Promise<string> {
    const body = await this.request('decryptWithOptions', {
      ciphertextBlob: ciphertext,
    });
    return getFirst(body, ['plaintext', 'Plaintext']);
  }

  async generateDataKey(keySpec: KmsKeySpec, keyId?: string): Promise<KmsDataKey> {
    const body = await this.request('generateDataKeyWithOptions', {
      keyId: keyId || DEFAULT_KMS_KEY_ID,
      keySpec,
    });
    return {
      plaintext: getFirst(body, ['plaintext', 'Plaintext']),
      ciphertext: getFirst(body, ['ciphertextBlob', 'CiphertextBlob']),
    };
  }

  async describeKey(keyId: string): Promise<any> {
    return this.request('describeKeyWithOptions', { keyId });
  }

  async setDeletionProtection(keyId: string, metadata?: any): Promise<void> {
    const keyMetadata = metadata || await this.describeKey(keyId);
    const arn = getFirst(keyMetadata, ['arn', 'Arn']) ||
      getFirst(getFirst(keyMetadata, ['keyMetadata', 'KeyMetadata']), ['arn', 'Arn']);
    if (!arn) return;
    await this.request('setDeletionProtectionWithOptions', {
      protectedResourceArn: arn,
      enableDeletionProtection: true,
      deletionProtectionDescription: 'key is used by nacos-mse-extension',
    });
  }
}

function encryptAes(content: string, plaintextDataKey: string, encoding: string): string {
  const key = Buffer.from(plaintextDataKey, 'base64');
  const expectedLength = key.length;
  if (expectedLength !== 16 && expectedLength !== 32) {
    throw new Error('KMS plaintext DataKey must decode to 16 or 32 bytes');
  }
  const cipher = crypto.createCipheriv('aes-' + (expectedLength * 8) + '-ecb', key, null);
  cipher.setAutoPadding(true);
  return Buffer.concat([cipher.update(encodeText(content, encoding)), cipher.final()]).toString('base64');
}

function decryptAes(content: string, plaintextDataKey: string, encoding: string): string {
  const key = Buffer.from(plaintextDataKey, 'base64');
  const expectedLength = key.length;
  if (expectedLength !== 16 && expectedLength !== 32) {
    throw new Error('KMS plaintext DataKey must decode to 16 or 32 bytes');
  }
  const decipher = crypto.createDecipheriv('aes-' + (expectedLength * 8) + '-ecb', key, null);
  decipher.setAutoPadding(true);
  return decodeText(Buffer.concat([decipher.update(Buffer.from(content, 'base64')), decipher.final()]), encoding);
}

function encodeText(value: string, encoding: string): Buffer {
  try {
    return Buffer.from(value, encoding as any);
  } catch (_) {
    // iconv-lite is already a nacos-config dependency for GBK responses.
    const iconv = require('iconv-lite');
    return iconv.encode(value, encoding);
  }
}

function decodeText(value: Buffer, encoding: string): string {
  try {
    return value.toString(encoding as any);
  } catch (_) {
    const iconv = require('iconv-lite');
    return iconv.decode(value, encoding);
  }
}

function groupKey(dataId: string, group: string): string {
  return encodeURIComponent(dataId) + '+' + encodeURIComponent(group || '');
}

/**
 * Encrypts/decrypts MSE configuration values and keeps a bounded in-memory
 * cache for DataKeys and last known plaintext values.
 */
export class ConfigCipher {
  private options: KmsCipherOptions;
  private kmsClient: KmsClient;
  private dataKeyCache: Map<string, CacheItem<string>> = new Map();
  private configCache: Map<string, CacheItem<ConfigCacheItem>> = new Map();

  constructor(options: KmsCipherOptions = {}) {
    this.options = options;
    this.kmsClient = options.kmsClient ||
      (options.kmsClientFactory ? options.kmsClientFactory(options) : new AliyunKmsClient(options));
  }

  isEncrypted(dataId: string): boolean {
    return dataId.indexOf(CIPHER_PREFIX) === 0;
  }

  isDataKeyCipher(dataId: string): boolean {
    return dataId.indexOf(CIPHER_KMS_AES_128_PREFIX) === 0 ||
      dataId.indexOf(CIPHER_KMS_AES_256_PREFIX) === 0;
  }

  private cacheEnabled(): boolean {
    return this.options.kmsCacheEnabled !== false;
  }

  private maxSize(): number {
    return Number(this.options.kmsCacheMaxSize) > 0 ? Number(this.options.kmsCacheMaxSize) : 1000;
  }

  private expired(item: CacheItem<any>): boolean {
    const now = Date.now();
    const afterAccess = Number(this.options.kmsCacheAfterAccessSeconds) > 0 ?
      Number(this.options.kmsCacheAfterAccessSeconds) * 1000 : 60 * 60 * 1000;
    const afterWrite = Number(this.options.kmsCacheAfterWriteSeconds) > 0 ?
      Number(this.options.kmsCacheAfterWriteSeconds) * 1000 : 24 * 60 * 60 * 1000;
    return now - item.accessedAt > afterAccess || now - item.createdAt > afterWrite;
  }

  private getCached<T>(cache: Map<string, CacheItem<T>>, key: string): T | undefined {
    if (!this.cacheEnabled()) return undefined;
    const item = cache.get(key);
    if (!item) return undefined;
    if (this.expired(item)) {
      cache.delete(key);
      return undefined;
    }
    item.accessedAt = Date.now();
    return item.value;
  }

  private putCached<T>(cache: Map<string, CacheItem<T>>, key: string, value: T): void {
    if (!this.cacheEnabled()) return;
    const now = Date.now();
    cache.set(key, { value, createdAt: now, accessedAt: now });
    while (cache.size > this.maxSize()) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  }

  private remember(dataId: string, group: string, item: ConfigCacheItem): void {
    this.putCached(this.configCache, groupKey(dataId, group), item);
  }

  async encrypt(dataId: string, group: string, content: string, encoding: string = 'utf8'): Promise<EncryptedConfig> {
    if (!this.isEncrypted(dataId) || content === '') {
      return { content };
    }
    if (this.isDataKeyCipher(dataId)) {
      const keySpec: KmsKeySpec = dataId.indexOf(CIPHER_KMS_AES_256_PREFIX) === 0 ? 'AES_256' : 'AES_128';
      const generated = await this.kmsClient.generateDataKey(keySpec, this.options.kmsKeyId || DEFAULT_KMS_KEY_ID);
      if (!generated || !generated.plaintext || !generated.ciphertext) {
        throw new Error('KMS GenerateDataKey returned an empty DataKey');
      }
      const encryptedContent = encryptAes(content, generated.plaintext, encoding);
      this.putCached(this.dataKeyCache, generated.ciphertext, generated.plaintext);
      this.remember(dataId, group, {
        dataId, group, encryptedContent, encryptedDataKey: generated.ciphertext,
        plaintextDataKey: generated.plaintext, plaintextContent: content,
        createdAt: Date.now(), accessedAt: Date.now(),
      });
      return { content: encryptedContent, encryptedDataKey: generated.ciphertext };
    }
    const encryptedContent = await this.kmsClient.encrypt(content, this.options.kmsKeyId || DEFAULT_KMS_KEY_ID);
    this.remember(dataId, group, {
      dataId, group, encryptedContent, plaintextContent: content,
      createdAt: Date.now(), accessedAt: Date.now(),
    });
    return { content: encryptedContent };
  }

  async decrypt(dataId: string, group: string, content: string, encryptedDataKey?: string, encoding: string = 'utf8'): Promise<string> {
    if (!this.isEncrypted(dataId) || content === '') return content;
    try {
      let result: string;
      let plaintextDataKey: string;
      if (this.isDataKeyCipher(dataId)) {
        if (!encryptedDataKey) throw new Error('Encrypted-Data-Key is required for KMS DataKey configurations');
        plaintextDataKey = this.getCached(this.dataKeyCache, encryptedDataKey);
        if (!plaintextDataKey) {
          const cache = this.getCached(this.configCache, groupKey(dataId, group));
          if (cache && cache.encryptedDataKey === encryptedDataKey) plaintextDataKey = cache.plaintextDataKey;
        }
        if (!plaintextDataKey) {
          plaintextDataKey = await this.kmsClient.decrypt(encryptedDataKey);
          this.putCached(this.dataKeyCache, encryptedDataKey, plaintextDataKey);
        }
        result = decryptAes(content, plaintextDataKey, encoding);
      } else {
        result = await this.kmsClient.decrypt(content);
      }
      this.remember(dataId, group, {
        dataId, group, encryptedContent: content, encryptedDataKey,
        plaintextDataKey, plaintextContent: result,
        createdAt: Date.now(), accessedAt: Date.now(),
      });
      return result;
    } catch (err) {
      const cache = this.getCached(this.configCache, groupKey(dataId, group));
      if (cache && cache.encryptedContent === content &&
          (!this.isDataKeyCipher(dataId) || cache.encryptedDataKey === encryptedDataKey) &&
          cache.plaintextContent !== undefined) {
        return cache.plaintextContent;
      }
      throw err;
    }
  }

  async protectKey(): Promise<void> {
    if ((this.options.kmsKeyId || this.options.kmsClient || this.options.kmsClientFactory) &&
        this.kmsClient.setDeletionProtection) {
      try {
        await this.kmsClient.setDeletionProtection(this.options.kmsKeyId || DEFAULT_KMS_KEY_ID);
      } catch (_) {
        // Key protection is best effort and must not block config operations.
      }
    }
  }

  getEncryptedConfig(dataId: string, group: string): EncryptedConfig | null {
    const cached = this.getCached(this.configCache, groupKey(dataId, group));
    if (!cached) return null;
    return {
      content: cached.encryptedContent,
      encryptedDataKey: cached.encryptedDataKey,
    };
  }

  async close(): Promise<void> {
    if (this.kmsClient && this.kmsClient.close) await this.kmsClient.close();
    this.dataKeyCache.clear();
    this.configCache.clear();
  }
}

export function createConfigCipher(options: KmsCipherOptions = {}): ConfigCipher {
  return new ConfigCipher(options);
}
