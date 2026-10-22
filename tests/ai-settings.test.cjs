const test = require('node:test');
const assert = require('node:assert/strict');
const { preferenceOnly, loadPreferences, savePreferences, redact } = require('../web/ai-settings.js');

function memoryStorage(initial = null) {
  let current = initial;
  return { getItem: () => current, setItem: (_, value) => { current = value; }, read: () => current };
}

test('持久化完整配置时所有密钥、认证字段与嵌套数据均被排除', () => {
  const secret = 'fake-ark-test-secret-389a';
  const storage = memoryStorage();
  savePreferences(storage, 'ark', {
    ark: {
      provider: 'ark', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', imageModel: 'model-image', videoModel: 'model-video',
      imageSize: '2K', videoRatio: '16:9', duration: 5, resolution: '720p', transport: 'proxy',
      key: secret, apiKey: secret, token: secret, headers: { Authorization: 'Bearer ' + secret }, credential: secret,
    },
    openai: { provider: 'openai', key: secret, imageModel: 'gpt-image-1.5' },
  });
  assert.ok(!storage.read().includes(secret));
  const saved = JSON.parse(storage.read());
  assert.equal(saved.active, 'ark');
  assert.equal(saved.profiles.ark.videoModel, 'model-video');
  assert.equal(saved.profiles.ark.duration, 5);
  assert.deepEqual(Object.keys(saved.profiles.openai).sort(), ['imageModel', 'provider']);
});

test('重新读取带未知字段的旧记录也只恢复非密钥偏好', () => {
  const storage = memoryStorage(JSON.stringify({ version: 1, active: 'ark', profiles: {
    ark: { key: 'old-secret', apiKey: 'old-secret', provider: 'compatible', baseUrl: 'https://example.com/v1', imageModel: 'ep-image', nested: { value: 'secret' } },
    compatible: { imageModel: 'custom-image', videoModel: 'custom-video', key: 'another-secret' },
    unexpected: { key: 'should-not-restore' },
  } }));
  const value = loadPreferences(storage);
  assert.equal(value.active, 'ark');
  assert.equal(value.profiles.ark.provider, 'ark');
  assert.equal(value.profiles.ark.imageModel, 'ep-image');
  assert.ok(!JSON.stringify(value).includes('secret'));
  assert.ok(!('unexpected' in value.profiles));
});

test('损坏记录或存储不可读时回到 OpenAI 空配置', () => {
  for (const storage of [memoryStorage('oops'), memoryStorage('null'), memoryStorage('{"version":2}'), { getItem() { throw new Error('disabled'); } }]) {
    assert.deepEqual(loadPreferences(storage), { active: 'openai', profiles: {} });
  }
});

test('不带前缀的火山密钥也从错误信息中完整隐藏', () => {
  const key = '9cbecb37a57845f8a53c9229796b3587';
  const message = redact('Authentication failed for ' + key + '; trace ' + key, key);
  assert.ok(!message.includes(key));
  assert.equal((message.match(/密钥已隐藏/g) || []).length, 2);
});

test('供应商意外返回的 Bearer 和 OpenAI 密钥都脱敏且截断长错误', () => {
  const message = redact('Failed Bearer EXPOSED_TOKEN and sk-fake-long-enough-key ' + 'x'.repeat(1000), 'different-key');
  assert.ok(!message.includes('EXPOSED_TOKEN'));
  assert.ok(!message.includes('sk-fake-long-enough-key'));
  assert.ok(message.length <= 420);
});

test('偏好快照是新对象，且只接受字符串或数字的显式字段', () => {
  const value = { provider: 'openai', imageModel: 'model-1', duration: 8, imageSize: { key: 'secret' }, key: 'secret' };
  const saved = preferenceOnly(value);
  value.imageModel = 'model-2';
  assert.equal(saved.imageModel, 'model-1');
  assert.deepEqual(saved, { provider: 'openai', imageModel: 'model-1', duration: 8 });
});
