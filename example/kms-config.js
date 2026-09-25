'use strict';

/**
 * Nacos KMS-encrypted Config Example
 *
 * Configurations whose dataId starts with `cipher-` are transparently
 * encrypted/decrypted through Aliyun KMS (envelope encryption, same wire
 * format as the Java / Go / Python SDKs).
 *
 * Prerequisites:
 *   - Nacos server running at 127.0.0.1:8848
 *   - Aliyun credentials in the environment:
 *       ALIBABA_CLOUD_ACCESS_KEY_ID / ALIBABA_CLOUD_ACCESS_KEY_SECRET
 *     (or pass accessKey / secretKey client options)
 *   - The `@alicloud/kms20160120` optional dependency installed
 *     (npm installs it automatically; it is required lazily)
 *
 * Usage:
 *   KMS_REGION_ID=cn-hangzhou node kms-config.js
 */

const { NacosConfigClient } = require('nacos');
const sleep = require('mz-modules/sleep');

async function main() {
  const configClient = new NacosConfigClient({
    serverAddr: '127.0.0.1:8848',
    namespace: 'public',
    // KMS public gateway
    kmsRegionId: process.env.KMS_REGION_ID || 'cn-hangzhou',
    // kmsKeyId: 'alias/acs/mse',  // default CMK, aligned with the Java MSE client
    // Dedicated KMS instance (ClientKey/DKMS): inject an adapter instead
    // kmsClientFactory: configuration => createDkmsAdapter({ ... }),
  });
  await configClient.ready();
  console.log('NacosConfigClient ready\n');

  // cipher-kms-aes-128-* / cipher-kms-aes-256-*: envelope encryption.
  // Bare cipher-*: direct KMS Encrypt/Decrypt of the whole value.
  const dataId = 'cipher-kms-aes-256-example.nodejs.secret';
  const group = 'DEFAULT_GROUP';

  // 1. Publish — content is encrypted locally with a KMS data key;
  //    the encryptedDataKey travels alongside the ciphertext.
  //    Publishing also enables best-effort deletion protection on the CMK.
  await configClient.publishSingle(dataId, group, 'db.password=s3cret');
  console.log('Published encrypted config');
  await sleep(1000);

  // 2. Get — decryption is transparent at user boundaries.
  const value = await configClient.getConfig(dataId, group);
  console.log('Decrypted content:', value); // 'db.password=s3cret'

  // 3. Subscribe — listeners always receive decrypted content.
  configClient.subscribe({ dataId, group }, newContent => {
    console.log('[subscribe] decrypted config changed:', newContent);
  });
  console.log('Subscribed to config changes');
  await sleep(1000);

  // 4. Update — triggers the subscription callback with plaintext.
  await configClient.publishSingle(dataId, group, 'db.password=n3w-secret');
  console.log('Updated encrypted config, waiting for notification...');
  await sleep(5000);

  // 5. Remove — also cleans up the ciphertext snapshot and its edk/ entry.
  await configClient.remove(dataId, group);
  console.log('Removed config');
  await sleep(1000);

  // Cleanup — cascades to the cipher and releases the KMS client.
  configClient.close();
  console.log('Done');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
