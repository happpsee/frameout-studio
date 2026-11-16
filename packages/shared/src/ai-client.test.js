// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PROVIDERS, createClient, validateBaseUrl } from './ai-client.ts';

const key = 'fixture-secret-key-123456';
const image = { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUg==' }] };
const reference = 'data:image/png;base64,' + image.data[0].b64_json;
const MODERATED = '内容被供应商的安全审核拒绝，请调整描述或参考图后再试';
const reply = (value, status = 200, headers = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const configuration = (provider = 'openai', overrides = {}) => ({
  provider,
  key,
  ...(provider === 'compatible'
    ? { baseUrl: 'https://models.provider.example/v1', videoModel: 'vendor-video-model' }
    : {}),
  ...overrides,
});
// A fetch that records each call and answers with the given responses in order.
const captureFetch = (...responses) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, 'unexpected extra network request');
    return next;
  };
  return { calls, fetchImpl };
};
const codeIs = code => error => error.code === code;

test('OpenAI image goes through the backend relay, with the key in the envelope only', async () => {
  const mock = captureFetch(reply(image, 200, { 'x-request-id': 'req-fixture' }));
  const client = createClient(
    configuration('openai', { imageModel: 'my-image-model', imageSize: '1024x1536' }),
    mock,
  );
  const result = await client.generateImage({ prompt: '  森林里的信  ' });
  assert.equal(mock.calls[0].url, '/api/ai');
  assert.equal(mock.calls[0].init.headers.Authorization, undefined);
  assert.deepEqual(mock.calls[0].body, {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: key,
    path: '/images/generations',
    method: 'POST',
    body: { model: 'my-image-model', prompt: '森林里的信', n: 1, size: '1024x1536' },
  });
  assert.equal(result.src, reference);
  assert.equal(result.requestId, 'req-fixture');
});

test('Ark image sends the Seedream body', async () => {
  const mock = captureFetch(reply({ data: [{ b64_json: '/9j/AA==' }] }));
  const result = await createClient(configuration('ark'), mock).generateImage({ prompt: '海边' });
  assert.deepEqual(mock.calls[0].body.body, {
    model: PROVIDERS.ark.defaultImageModel,
    prompt: '海边',
    size: '2K',
    response_format: 'b64_json',
    watermark: false,
  });
  assert.equal(result.src, 'data:image/jpeg;base64,/9j/AA==');
});

test('direct transport calls the provider itself with a Bearer header', async () => {
  const mock = captureFetch(reply(image));
  await createClient(configuration('compatible'), mock).generateImage({ prompt: '海边' });
  assert.equal(mock.calls[0].url, 'https://models.provider.example/v1/images/generations');
  assert.equal(mock.calls[0].init.method, 'POST');
  assert.equal(mock.calls[0].init.headers.Authorization, 'Bearer ' + key);
  assert.deepEqual(mock.calls[0].body, {
    model: 'gpt-image-1.5',
    prompt: '海边',
    n: 1,
    size: '1536x1024',
  });
});

test('reference images: Ark uses the image field, OpenAI uses the edits endpoint', async () => {
  const input = { prompt: '同一个角色', references: [reference] };
  const ark = captureFetch(reply(image));
  await createClient(configuration('ark'), ark).generateImage(input);
  assert.equal(ark.calls[0].body.path, '/images/generations');
  assert.equal(ark.calls[0].body.body.image, reference);

  const openai = captureFetch(reply(image));
  await createClient(configuration(), openai).generateImage(input);
  assert.equal(openai.calls[0].body.path, '/images/edits');
  assert.deepEqual(openai.calls[0].body.body.images, [{ image_url: reference }]);
});

test('Ark video: submit with a first frame, then poll until the video is ready', async () => {
  const mock = captureFetch(
    reply({ id: 'cgt-fixture' }),
    reply({ id: 'cgt-fixture', status: 'running' }),
    reply({
      id: 'cgt-fixture',
      status: 'succeeded',
      content: { video_url: 'https://media.provider.example/video.mp4?expires=123' },
    }),
  );
  const client = createClient(configuration('ark', { duration: 8, videoRatio: '9:16' }), mock);
  const submitted = await client.submitVideo({ prompt: '镜头向前', reference });
  assert.equal(mock.calls[0].body.path, '/contents/generations/tasks');
  assert.deepEqual(mock.calls[0].body.body, {
    model: PROVIDERS.ark.defaultVideoModel,
    content: [
      { type: 'text', text: '镜头向前' },
      { type: 'image_url', image_url: { url: reference }, role: 'first_frame' },
    ],
    duration: 8,
    ratio: 'adaptive',
    resolution: '720p',
    watermark: false,
  });
  assert.equal(submitted.id, 'cgt-fixture');
  assert.equal(submitted.status, 'queued');

  assert.equal((await client.getVideo({ id: 'cgt-fixture' })).status, 'running');
  assert.equal(mock.calls[1].body.path, '/contents/generations/tasks/cgt-fixture');
  const done = await client.getVideo({ id: 'cgt-fixture' });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.src, 'https://media.provider.example/video.mp4?expires=123');
});

test('compatible video: submit directly, then download the finished file', async () => {
  const mock = captureFetch(
    reply({ id: 'vendor-fixture', status: 'queued' }),
    reply({ id: 'vendor-fixture', status: 'completed' }),
    new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } }),
  );
  const client = createClient(configuration('compatible', { videoRatio: '9:16' }), mock);
  await client.submitVideo({ prompt: '城市下雨' });
  assert.equal(mock.calls[0].url, 'https://models.provider.example/v1/videos');
  assert.deepEqual(mock.calls[0].body, {
    model: 'vendor-video-model',
    prompt: '城市下雨',
    seconds: '4',
    size: '720x1280',
  });
  const done = await client.getVideo({ id: 'vendor-fixture' });
  assert.equal(done.status, 'succeeded');
  assert.equal(done.data.type, 'video/mp4');
  assert.match(mock.calls[2].url, /\/v1\/videos\/vendor-fixture\/content$/);
});

test('a failed video task reports failed, with the key hidden or the moderation message', async () => {
  const mock = captureFetch(
    reply({ id: 'cgt-fixture', status: 'expired', error: { message: 'invalid ' + key } }),
    reply({
      id: 'cgt-fixture',
      status: 'failed',
      error: { code: 'OutputVideoSensitiveContentDetected', message: 'The request failed.' },
    }),
  );
  const client = createClient(configuration('ark'), mock);
  const expired = await client.getVideo({ id: 'cgt-fixture' });
  assert.equal(expired.status, 'failed');
  assert.equal(expired.error, 'invalid [已隐藏]');
  const moderated = await client.getVideo({ id: 'cgt-fixture' });
  assert.equal(moderated.status, 'failed');
  assert.equal(moderated.error, MODERATED);
});

test('OpenAI video is refused before any request is sent', async () => {
  const mock = captureFetch();
  const client = createClient(configuration('openai', { videoModel: 'sora-2' }), mock);
  await assert.rejects(client.submitVideo({ prompt: '镜头向前' }), codeIs('VIDEO_UNAVAILABLE'));
  assert.equal(mock.calls.length, 0);
});

test('base URL must be a public HTTPS host, and the relay only serves official addresses', () => {
  for (const baseUrl of [
    'http://api.provider.example/v1',
    'https://127.0.0.1/v1',
    'https://[::1]/v1',
    'https://localhost/v1',
    'https://metadata.google.internal/v1',
    'https://user:pass@api.provider.example/v1',
    'https://api.provider.example/v1?token=abc',
    'https://api.provider.example:8443/v1',
  ]) {
    const config = configuration('compatible', { baseUrl });
    assert.throws(() => createClient(config), codeIs('CONFIG_URL'), baseUrl);
  }
  for (const config of [
    configuration('openai', { baseUrl: 'https://other.provider.example/v1' }),
    configuration('compatible', { transport: 'proxy' }),
  ]) {
    assert.throws(() => createClient(config), codeIs('CONFIG_TRANSPORT'));
  }
  assert.equal(
    validateBaseUrl(' https://api.provider.example/v1/ '),
    'https://api.provider.example/v1',
  );
});

test('the API key never appears in an error', async () => {
  const upstream = captureFetch(
    reply({ error: { message: 'bad ' + key + ' Authorization: Bearer other-secret' } }, 401),
  );
  await assert.rejects(
    createClient(configuration(), upstream).generateImage({ prompt: '树' }),
    error => {
      assert.equal(error.status, 401);
      assert.ok(error.message.startsWith('API Key 无效或已过期'));
      assert.doesNotMatch(error.message + JSON.stringify(error), /fixture-secret|other-secret/);
      return true;
    },
  );
  const network = captureFetch(new Error('network echoed ' + key));
  await assert.rejects(
    createClient(configuration('compatible'), network).generateImage({ prompt: '树' }),
    error => error.code === 'NETWORK_ERROR' && !error.message.includes(key),
  );
  assert.equal(network.calls.length, 1, 'a paid request is not retried');
});

test('a timeout warns that the provider may still be running', async () => {
  const client = createClient(configuration(), {
    timeoutMs: 5,
    fetchImpl: (_, init) =>
      new Promise((_, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
        ),
      ),
  });
  await assert.rejects(
    client.generateImage({ prompt: '树' }),
    error => error.code === 'TIMEOUT' && /避免重复提交/.test(error.message),
  );
});

test('a moderation rejection shows the moderation message, other 400s stay parameter errors', async () => {
  const rejected = [
    ['ark', { code: 'InputTextSensitiveContentDetected', message: 'The request failed.' }],
    ['openai', { code: 'moderation_blocked', message: 'Rejected by the safety system.' }],
    // Through the backend relay the provider's code arrives as upstreamCode.
    ['ark', { code: 'UPSTREAM_400', message: '供应商请求失败', upstreamCode: 'SensitiveContent' }],
  ];
  for (const [provider, error] of rejected) {
    const client = createClient(configuration(provider), captureFetch(reply({ error }, 400)));
    await assert.rejects(
      client.generateImage({ prompt: '海边' }),
      error => error.code === 'CONTENT_REJECTED' && error.message === MODERATED,
    );
  }
  const client = createClient(
    configuration('ark'),
    captureFetch(reply({ error: { code: 'InvalidParameter', message: 'size is invalid' } }, 400)),
  );
  await assert.rejects(
    client.generateImage({ prompt: '海边' }),
    error => error.code === 'UPSTREAM_ERROR' && error.message.startsWith('请求参数不被模型接受'),
  );
});
