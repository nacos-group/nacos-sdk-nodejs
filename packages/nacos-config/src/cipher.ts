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

/** dataId prefix that triggers KMS envelope encryption (aligned with Java / Go / Python SDK). */
export const CIPHER_PREFIX = 'cipher-';

/** HTTP response header the server uses to carry the encryptedDataKey back on config reads. */
export const ENCRYPTED_DATA_KEY_HEADER = 'Encrypted-Data-Key';

/** HTTP publish form parameter / gRPC additionMap key used to carry the encryptedDataKey. */
export const ENCRYPTED_DATA_KEY_PARAM = 'encryptedDataKey';

const KMS_AES_128_ALGORITHM = 'cipher-kms-aes-128';
const KMS_AES_256_ALGORITHM = 'cipher-kms-aes-256';
const AES_128_KEY_SPEC = 'AES_128';
const AES_256_KEY_SPEC = 'AES_256';
// MSE-managed default CMK alias, used when no explicit kmsKeyId is configured (aligned with Go / Python SDK).
const DEFAULT_KMS_KEY_ID = 'alias/acs/mse';

// Longest matching prefix wins, so `cipher-kms-aes-128-*` never falls through to a shorter alias.
const ALGORITHM_KEY_SPECS: Array<{ prefix: string; keySpec: string }> = [
  { prefix: KMS_AES_128_ALGORITHM, keySpec: AES_128_KEY_SPEC },
  { prefix: KMS_AES_256_ALGORITHM, keySpec: AES_256_KEY_SPEC },
];

/**
 * Minimal KMS surface required by the cipher. Kept small and injectable so the
 * Alibaba Cloud SDK stays an optional dependency and unit tests need no network.
 */
export interface IKmsClient {
  /** GenerateDataKey: returns the Base64 plaintext data key and its KMS-encrypted form. */
  generateDataKey(keyId: string, keySpec: string): Promise<{ plaintext: string; ciphertextBlob: string }>;
  /** Decrypt: turns an encryptedDataKey (ciphertextBlob) back into the Base64 plaintext data key. */
  decrypt(ciphertextBlob: string): Promise<string>;
}

/** Result of an encrypt pass: the (possibly encrypted) content plus the data key to carry. */
export interface EncryptResult {
  content: string;
  encryptedDataKey?: string;
}

function isCipherDataId(dataId: string): boolean {
  return typeof dataId === 'string' && dataId.indexOf(CIPHER_PREFIX) === 0;
}

function matchKeySpec(dataId: string): string | null {
  let matchedKeySpec: string | null = null;
  let matchedLength = 0;
  for (const algorithm of ALGORITHM_KEY_SPECS) {
    if (dataId.indexOf(algorithm.prefix) === 0 && algorithm.prefix.length > matchedLength) {
      matchedKeySpec = algorithm.keySpec;
      matchedLength = algorithm.prefix.length;
    }
  }
  return matchedKeySpec;
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
 * Default {@link IKmsClient} backed by the Alibaba Cloud public-gateway OpenAPI SDK
 * (`@alicloud/kms20160120`). The SDK is an optional dependency and is required lazily,
 * so non-KMS users are never forced to install it. Credentials reuse `aliyun_auth` (AK/SK).
 */
export class AliyunKmsClient implements IKmsClient {

  private configuration: IConfiguration;
  private client: any;
  private models: any;

  constructor(configuration: IConfiguration) {
    this.configuration = configuration;
  }

  private async ensureClient(): Promise<any> {
    if (this.client) {
      return this.client;
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
    const config: any = {
      accessKeyId: credentials.accessKeyId,
      accessKeySecret: credentials.accessKeySecret,
    };
    if (credentials.securityToken) {
      config.securityToken = credentials.securityToken;
      config.type = 'sts';
    } else {
      config.type = 'access_key';
    }
    const endpoint = this.configuration.get(ClientOptionKeys.KMS_ENDPOINT);
    if (endpoint) {
      config.endpoint = endpoint;
    }
    const regionId = this.configuration.get(ClientOptionKeys.KMS_REGION_ID) || credentials.signatureRegionId;
    if (regionId) {
      config.regionId = regionId;
    }
    this.models = kmsModule;
    this.client = new ClientCtor(config);
    return this.client;
  }

  async generateDataKey(keyId: string, keySpec: string): Promise<{ plaintext: string; ciphertextBlob: string }> {
    const client = await this.ensureClient();
    const request = new this.models.GenerateDataKeyRequest({ keyId, keySpec });
    const response = await client.generateDataKey(request);
    const body = response && response.body ? response.body : {};
    if (!body.plaintext || !body.ciphertextBlob) {
      throw new Error('[Nacos#Cipher] KMS GenerateDataKey returned an empty data key');
    }
    return { plaintext: body.plaintext, ciphertextBlob: body.ciphertextBlob };
  }

  async decrypt(ciphertextBlob: string): Promise<string> {
    const client = await this.ensureClient();
    const request = new this.models.DecryptRequest({ ciphertextBlob });
    const response = await client.decrypt(request);
    const plaintext = response && response.body ? response.body.plaintext : undefined;
    if (!plaintext) {
      throw new Error('[Nacos#Cipher] KMS Decrypt returned an empty data key');
    }
    return plaintext;
  }
}

/**
 * Applies KMS envelope encryption/decryption to config content, triggered by the `cipher-`
 * dataId prefix. Mirrors the Java / Go / Python wire format: GenerateDataKey → AES/ECB/PKCS5
 * with the Base64-decoded data key → Base64. The plaintext data key is cached in memory
 * (keyed by encryptedDataKey) to avoid a KMS round trip on every read/notification, and is
 * never persisted.
 */
export class ConfigCipher {

  private configuration: IConfiguration;
  private kmsClient: IKmsClient | null;
  private dataKeyCache: Map<string, string> = new Map();

  constructor(configuration: IConfiguration, kmsClient?: IKmsClient) {
    this.configuration = configuration;
    this.kmsClient = kmsClient || null;
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
    const keySpec = matchKeySpec(dataId);
    if (!keySpec) {
      throw new Error(`[Nacos#Cipher] unsupported cipher dataId, expected a ` +
        `${KMS_AES_128_ALGORITHM}- or ${KMS_AES_256_ALGORITHM}- prefix: ${dataId}`);
    }
    const { plaintext, ciphertextBlob } = await this.getKmsClient().generateDataKey(this.getKeyId(), keySpec);
    this.dataKeyCache.set(ciphertextBlob, plaintext);
    return {
      content: aesEcbEncryptToBase64(content, plaintext),
      encryptedDataKey: ciphertextBlob,
    };
  }

  /**
   * Decrypt content read from the server or the local snapshot. Non-cipher dataIds, empty
   * content, or a missing encryptedDataKey (e.g. user-maintained plaintext failover) pass
   * through unchanged.
   */
  async decryptIfNeeded(dataId: string, content: string, encryptedDataKey?: string): Promise<string> {
    if (!isCipherDataId(dataId)) {
      return content;
    }
    if (content === null || content === undefined || content === '') {
      return content;
    }
    if (!encryptedDataKey) {
      return content;
    }
    const plainDataKey = await this.resolvePlainDataKey(encryptedDataKey);
    return aesEcbDecryptFromBase64(content, plainDataKey);
  }

  private async resolvePlainDataKey(encryptedDataKey: string): Promise<string> {
    const cached = this.dataKeyCache.get(encryptedDataKey);
    if (cached) {
      return cached;
    }
    const plaintext = await this.getKmsClient().decrypt(encryptedDataKey);
    this.dataKeyCache.set(encryptedDataKey, plaintext);
    return plaintext;
  }

  private getKmsClient(): IKmsClient {
    if (!this.kmsClient) {
      // An explicitly injected client wins; otherwise fall back to the lazy Alibaba Cloud gateway client.
      this.kmsClient = this.configuration.get(ClientOptionKeys.KMS_CLIENT) || new AliyunKmsClient(this.configuration);
    }
    return this.kmsClient;
  }

  private getKeyId(): string {
    return this.configuration.get(ClientOptionKeys.KMS_KEY_ID) || DEFAULT_KMS_KEY_ID;
  }
}

export function createConfigCipher(configuration: IConfiguration): ConfigCipher {
  return new ConfigCipher(configuration, configuration.get(ClientOptionKeys.KMS_CLIENT));
}
