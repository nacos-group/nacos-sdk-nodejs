import { getMD5String } from '../src/utils';

const assert = require('assert');

describe('test/utils.test.ts', function() {
  it('should getMD5String ok', function() {
    const str = '172.24.13.28:5198#172.24.30.28:5198#172.23.13.10:5198#172.23.14.46:5198#group3#100#Mon Mar 20 13:32:49 CST 2010#online';
    assert(getMD5String(str) === '3001aeb96c243fa3302e42ab2c1a16ad');
  });

  it('should getMD5String ok with 中文', function() {
    const str = 'cashier.function.switcher.status=on\ncashier.function.switcher.whiteListStrategy.tbNickPattern=临观|lichen6928|fangyuct01|朱琳1219|xiaoyin1916|简单de老公|奚薇0716|安桔熟了|七空八档|lichen6928|蝶羽轻尘|漂亮一下吧11|xupingan126|qqk2006|tb5808466|江南好吃|zhang_junlong|ct测试账号002|cguo82|';
    assert(getMD5String(str) === 'f7c5371396b7e7c2777a43590d4c5be2');
  });
});
