import { ConfigCipher, KmsClient } from '../src/cipher';
import * as crypto from 'crypto';

const assert = require('assert');

function dataKey(length: number): string {
  return crypto.randomBytes(length).toString('base64');
}

class FakeKmsClient implements KmsClient {
  public encryptCalls = 0;
  public decryptCalls = 0;
  public generateCalls = 0;
  private keys: { [key: string]: string } = {};

  async encrypt(plaintext: string): Promise<string> {
    this.encryptCalls++;
    return Buffer.from('direct:' + plaintext).toString('base64');
  }

  async decrypt(ciphertext: string): Promise<string> {
    this.decryptCalls++;
    if (this.keys[ciphertext]) return this.keys[ciphertext];
    return Buffer.from(ciphertext, 'base64').toString().replace(/^direct:/, '');
  }

  async generateDataKey(keySpec: 'AES_128' | 'AES_256'): Promise<{ plaintext: string; ciphertext: string }> {
    this.generateCalls++;
    const plaintext = dataKey(keySpec === 'AES_256' ? 32 : 16);
    const ciphertext = 'edk-' + this.generateCalls;
    this.keys[ciphertext] = plaintext;
    return { plaintext, ciphertext };
  }
}

describe('ConfigCipher', function() {
  it('round trips KMS AES-128 and AES-256 values', async function() {
    const kms = new FakeKmsClient();
    const cipher = new ConfigCipher({ kmsClient: kms });
    const plain = 'name=配置\nvalue=secret';

    const encrypted128 = await cipher.encrypt('cipher-kms-aes-128-app', 'DEFAULT_GROUP', plain);
    assert(encrypted128.encryptedDataKey);
    assert(encrypted128.content !== plain);
    assert(await cipher.decrypt('cipher-kms-aes-128-app', 'DEFAULT_GROUP', encrypted128.content, encrypted128.encryptedDataKey) === plain);

    const encrypted256 = await cipher.encrypt('cipher-kms-aes-256-app', 'DEFAULT_GROUP', plain);
    assert(await cipher.decrypt('cipher-kms-aes-256-app', 'DEFAULT_GROUP', encrypted256.content, encrypted256.encryptedDataKey) === plain);
  });

  it('matches Node AES ECB output and caches the DataKey', async function() {
    const kms = new FakeKmsClient();
    const cipher = new ConfigCipher({ kmsClient: kms });
    const encrypted = await cipher.encrypt('cipher-kms-aes-128-cache', 'G', 'hello');
    const key = Buffer.from((kms as any).keys[encrypted.encryptedDataKey], 'base64');
    const independent = crypto.createCipheriv('aes-128-ecb', key, null);
    independent.setAutoPadding(true);
    const expected = Buffer.concat([independent.update(Buffer.from('hello')), independent.final()]).toString('base64');
    assert(encrypted.content === expected);

    await cipher.decrypt('cipher-kms-aes-128-cache', 'G', encrypted.content, encrypted.encryptedDataKey);
    await cipher.decrypt('cipher-kms-aes-128-cache', 'G', encrypted.content, encrypted.encryptedDataKey);
    assert(kms.decryptCalls === 0);
  });

  it('supports direct cipher-* encryption and non-cipher passthrough', async function() {
    const kms = new FakeKmsClient();
    const cipher = new ConfigCipher({ kmsClient: kms });
    const direct = await cipher.encrypt('cipher-app', 'G', 'hello');
    assert(await cipher.decrypt('cipher-app', 'G', direct.content) === 'hello');
    assert((await cipher.encrypt('plain-app', 'G', 'hello')).content === 'hello');
    assert((await cipher.decrypt('plain-app', 'G', 'hello')) === 'hello');
  });

  it('uses the last known plaintext when KMS is temporarily unavailable', async function() {
    const kms = new FakeKmsClient();
    const cipher = new ConfigCipher({ kmsClient: kms });
    const encrypted = await cipher.encrypt('cipher-kms-aes-128-fallback', 'G', 'cached');
    const original = kms.decrypt;
    kms.decrypt = async () => { throw new Error('unavailable'); };
    assert(await cipher.decrypt('cipher-kms-aes-128-fallback', 'G', encrypted.content, encrypted.encryptedDataKey) === 'cached');
    kms.decrypt = original;
  });
});

