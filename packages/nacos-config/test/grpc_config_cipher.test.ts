import { GrpcConfigProxy } from '../src/grpc_config_proxy';
import { ConfigCipher, KmsClient } from '../src/cipher';

const assert = require('assert');

class FakeKms implements KmsClient {
  private key = Buffer.alloc(16, 3).toString('base64');
  async encrypt(value: string): Promise<string> { return Buffer.from(value).toString('base64'); }
  async decrypt(value: string): Promise<string> {
    return value === 'edk' ? this.key : Buffer.from(value, 'base64').toString();
  }
  async generateDataKey(): Promise<{ plaintext: string; ciphertext: string }> {
    return { plaintext: this.key, ciphertext: 'edk' };
  }
}

describe('GrpcConfigProxy KMS carriers', function() {
  it('uses additionMap on publish and decrypts encryptedDataKey on get', async function() {
    const calls: any[] = [];
    let storedContent = '';
    const transport: any = {
      request: async (request, type) => {
        calls.push({ request, type });
        if (type === 'ConfigPublishRequest') {
          storedContent = request.content;
          return { resultCode: 200 };
        }
        return { content: storedContent, encryptedDataKey: 'edk' };
      },
      registerServerPushHandler: () => {},
      onReconnect: () => {},
      removeServerPushHandler: () => {},
    };
    const proxy = new GrpcConfigProxy({
      transportClient: transport,
      namespace: 'public',
      logger: console,
      cipher: new ConfigCipher({ kmsClient: new FakeKms() }),
    });
    assert(await proxy.publishSingle('cipher-kms-aes-128-grpc', 'G', 'public', 'hello'));
    const publish = calls[0].request;
    assert(publish.content !== 'hello');
    assert(publish.additionMap.encryptedDataKey === 'edk');
    const content = await proxy.getConfig('cipher-kms-aes-128-grpc', 'G');
    assert(content === 'hello');
    proxy.close();
  });
});
