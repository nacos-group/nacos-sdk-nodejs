import { ClientWorker } from '../src/client_worker';
import { Configuration } from '../src/configuration';
import { ConfigCipher, KmsClient } from '../src/cipher';
import { ClientOptionKeys } from '../src/interface';

const assert = require('assert');

class FakeKms implements KmsClient {
  private keys: { [key: string]: string } = {};
  async encrypt(value: string): Promise<string> { return Buffer.from(value).toString('base64'); }
  async decrypt(value: string): Promise<string> {
    return this.keys[value] || Buffer.from(value, 'base64').toString();
  }
  async generateDataKey(): Promise<{ plaintext: string; ciphertext: string }> {
    const plaintext = Buffer.alloc(16, 7).toString('base64');
    const ciphertext = 'edk';
    this.keys[ciphertext] = plaintext;
    return { plaintext, ciphertext };
  }
}

describe('ClientWorker KMS carriers', function() {
  it('publishes encryptedDataKey and decrypts HTTP responses while snapshotting ciphertext', async function() {
    const snapshots: { [key: string]: string } = {};
    const kms = new FakeKms();
    const cipher = new ConfigCipher({ kmsClient: kms });
    const encrypted = await cipher.encrypt('cipher-kms-aes-128-app', 'G', 'secret=value');
    const requests: any[] = [];
    const httpAgent: any = {
      request: async (path, options) => {
        requests.push({ path, options });
        if (options.method === 'POST') return '';
        return { content: encrypted.content, headers: { 'Encrypted-Data-Key': encrypted.encryptedDataKey } };
      },
    };
    const snapshot: any = {
      get: async key => snapshots[key] === undefined ? null : snapshots[key],
      save: async (key, value) => { snapshots[key] = value; },
      delete: async key => { delete snapshots[key]; },
    };
    const configuration = new Configuration({
      [ClientOptionKeys.CIPHER]: cipher,
      [ClientOptionKeys.HTTP_AGENT]: httpAgent,
      [ClientOptionKeys.SNAPSHOT]: snapshot,
      [ClientOptionKeys.NAMESPACE]: 'public',
      [ClientOptionKeys.UNIT]: 'CURRENT_UNIT',
      [ClientOptionKeys.APPNAME]: '',
      [ClientOptionKeys.DEFAULT_ENCODING]: 'utf8',
    });
    const worker = new ClientWorker({ configuration });
    assert(await worker.getConfig('cipher-kms-aes-128-app', 'G') === 'secret=value');
    assert(snapshots['config/CURRENT_UNIT/public/G/cipher-kms-aes-128-app'] === encrypted.content);
    assert(snapshots['config/CURRENT_UNIT/public/G/cipher-kms-aes-128-app.encryptedDataKey'] === encrypted.encryptedDataKey);

    await worker.publishSingle('cipher-kms-aes-128-app', 'G', 'new=value');
    const publish = requests.filter(item => item.options.method === 'POST')[0];
    assert(publish.options.data.content !== 'new=value');
    assert(publish.options.data.encryptedDataKey);
  });
});

