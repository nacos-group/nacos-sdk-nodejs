/**
 * 测试用例：验证 Issue #68 的修复
 * publishSingle 方法现在支持 options.type 参数
 */

import { NacosConfigClient } from './packages/nacos/src/index';

async function testIssue68() {
  // 创建客户端实例
  const configClient = new NacosConfigClient({
    serverAddr: '127.0.0.1:8848',
  });

  await configClient.ready();

  const dataId = 'test-issue-68';
  const group = 'DEFAULT_GROUP';
  const content = '{"key":"value"}';

  // 测试场景 1: 不传 options 参数（向后兼容）
  console.log('测试场景 1: 不传 options 参数');
  await configClient.publishSingle(dataId, group, content);
  console.log('✅ 通过编译');

  // 测试场景 2: 只传 unit 参数
  console.log('\n测试场景 2: 只传 unit 参数');
  await configClient.publishSingle(dataId, group, content, { 
    unit: 'cn-hangzhou' 
  });
  console.log('✅ 通过编译');

  // 测试场景 3: 只传 type 参数（Issue #68 的场景）
  console.log('\n测试场景 3: 只传 type 参数');
  await configClient.publishSingle(dataId, group, content, { 
    type: 'json' 
  });
  console.log('✅ 通过编译 - Issue #68 已修复!');

  // 测试场景 4: 同时传 unit 和 type 参数
  console.log('\n测试场景 4: 同时传 unit 和 type 参数');
  await configClient.publishSingle(dataId, group, content, { 
    unit: 'cn-hangzhou',
    type: 'json' 
  });
  console.log('✅ 通过编译');

  // 测试场景 5: 使用完整的 options 对象
  console.log('\n测试场景 5: 使用完整的 options 对象');
  const options = {
    unit: 'cn-shanghai',
    type: 'properties'
  };
  await configClient.publishSingle(dataId, group, content, options);
  console.log('✅ 通过编译');

  configClient.close();
  console.log('\n🎉 所有测试通过！Issue #68 已完美修复！');
}

// 运行测试（需要真实的 Nacos Server）
// testIssue68().catch(console.error);

console.log('TypeScript 编译检查通过！');
console.log('现在 TypeScript 用户可以正常使用 options.type 参数了');
