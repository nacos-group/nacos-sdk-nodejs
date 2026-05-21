import * as assert from 'assert';
import { PayloadCodec } from '../../src/grpc/payload_codec';

describe('PayloadCodec', () => {
  let codec: PayloadCodec;

  beforeEach(() => {
    codec = new PayloadCodec();
  });

  it('round-trip encode/decode of InstanceRequest', () => {
    const msg = {
      requestId: 'req-001',
      namespace: 'public',
      serviceName: 'test-service',
      groupName: 'DEFAULT_GROUP',
      type: 'REGISTER_INSTANCE',
      instance: undefined,
    };
    const payload = codec.encode(msg, 'InstanceRequest');
    assert.strictEqual(payload.metadata.type, 'InstanceRequest');
    assert.ok(Buffer.isBuffer(payload.body.value));

    const result = codec.decode(payload);
    assert.strictEqual(result.type, 'InstanceRequest');
    assert.strictEqual(result.body.requestId, 'req-001');
    assert.strictEqual(result.body.namespace, 'public');
    assert.strictEqual(result.body.serviceName, 'test-service');
    assert.strictEqual(result.body.groupName, 'DEFAULT_GROUP');
    assert.strictEqual(result.body.type, 'REGISTER_INSTANCE');
  });

  it('encode with custom headers', () => {
    const msg = {
      requestId: 'req-002',
      namespace: 'public',
      serviceName: 'svc',
      groupName: 'DEFAULT_GROUP',
      type: 'DEREGISTER_INSTANCE',
      instance: undefined,
    };
    const headers = { 'X-Custom-Header': 'value1', 'X-Another': 'value2' };
    const payload = codec.encode(msg, 'InstanceRequest', headers);
    assert.deepStrictEqual(payload.metadata.headers, headers);
    assert.strictEqual(payload.metadata.type, 'InstanceRequest');
  });

  it('decode unknown type returns raw JSON', () => {
    const rawMsg = { foo: 'bar', num: 42 };
    const payload = codec.encode(rawMsg, 'UnknownType');
    const result = codec.decode(payload);
    assert.strictEqual(result.type, 'UnknownType');
    assert.strictEqual(result.body.foo, 'bar');
    assert.strictEqual(result.body.num, 42);
  });

  it('empty body (HealthCheckRequest with just requestId)', () => {
    const msg = { requestId: 'hc-001' };
    const payload = codec.encode(msg, 'HealthCheckRequest');
    assert.strictEqual(payload.metadata.type, 'HealthCheckRequest');

    const result = codec.decode(payload);
    assert.strictEqual(result.type, 'HealthCheckRequest');
    assert.strictEqual(result.body.requestId, 'hc-001');
  });
});
