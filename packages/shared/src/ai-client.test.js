// @vitest-environment node
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PROVIDERS, AIError, createClient, validateBaseUrl } from './ai-client.ts';

const key = 'fixture-secret-key-123456';
const image = { data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUg==' }] };
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
const captureFetch = (...responses) => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    assert.ok(next, '未预期的额外网络请求');
    return next;
  };
  return { calls, fetchImpl };
};

test('保留原项目的供应商默认值，OpenAI 配置仅提供图片', () => {
  assert.equal(PROVIDERS.openai.defaultImageModel, 'gpt-image-1.5');
  assert.equal(PROVIDERS.openai.canVideo, false);
  assert.equal(PROVIDERS.ark.defaultImageModel, 'doubao-seedream-5-0-pro-260628');
  assert.equal(PROVIDERS.ark.defaultVideoModel, 'doubao-seedance-2-5-260628');
  assert.ok(PROVIDERS.ark.imageSizes.includes('2K'));
});

test('OpenAI 图片请求使用后端转发，保留自填模型与尺寸，不发已废弃 response_format', async () => {
  const mock = captureFetch(reply(image, 200, { 'x-request-id': 'req-fixture' }));
  const client = createClient(
    configuration('openai', { imageModel: 'my-image-model', imageSize: '1024x1536' }),
    mock,
  );
  const result = await client.generateImage({ prompt: '  森林里的信  ' });
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].url, '/api/ai');
  assert.deepEqual(mock.calls[0].body, {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: key,
    path: '/images/generations',
    method: 'POST',
    body: { model: 'my-image-model', prompt: '森林里的信', n: 1, size: '1024x1536' },
  });
  assert.equal(mock.calls[0].init.credentials, 'omit');
  assert.equal(mock.calls[0].init.redirect, 'error');
  assert.equal(mock.calls[0].init.headers.Authorization, undefined);
  assert.equal(result.kind, 'image');
  assert.equal(result.model, 'my-image-model');
  assert.equal(result.src, 'data:image/png;base64,' + image.data[0].b64_json);
  assert.equal(result.requestId, 'req-fixture');
});

test('Ark 单图协议不带不支持的 n、stream 和 sequential_image_generation', async () => {
  const mock = captureFetch(reply({ data: [{ b64_json: '/9j/AA==', output_format: 'jpeg' }] }));
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

test('图片 URL 响应可直接用于画布，拒绝脚本或私网媒体地址', async () => {
  const mock = captureFetch(
    reply({ data: [{ url: 'https://media.provider.example/image.png?signature=abc' }] }),
  );
  const result = await createClient(configuration(), mock).generateImage({ prompt: '海边' });
  assert.equal(result.src, 'https://media.provider.example/image.png?signature=abc');
  for (const url of [
    'javascript:alert(1)',
    'http://media.provider.example/image.png',
    'https://127.0.0.1/a',
    'data:image/svg+xml;base64,PHN2Zz4=',
  ]) {
    const client = createClient(configuration(), captureFetch(reply({ data: [{ url }] })));
    await assert.rejects(
      client.generateImage({ prompt: '海边' }),
      error => error.code === 'INVALID_RESPONSE',
    );
  }
});

test('Ark 连接测试只查询任务列表，不返回用户任务与素材', async () => {
  const mock = captureFetch(
    reply({
      items: [
        { id: 'private-task', content: { video_url: 'https://private.provider.example/v.mp4' } },
      ],
    }),
  );
  const result = await createClient(configuration('ark'), mock).testConnection();
  assert.equal(mock.calls[0].body.method, 'GET');
  assert.equal(mock.calls[0].body.path, '/contents/generations/tasks?page_size=1');
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result).sort(), ['message', 'ok']);
  assert.ok(!JSON.stringify(result).includes('private-task'));
});

test('OpenAI 模型连接测试不触发生成，也不宣称模型生成权限已确认', async () => {
  const mock = captureFetch(reply({ data: [{ id: 'gpt-image-1.5' }, { id: 'custom-image' }] }));
  const result = await createClient(configuration(), mock).testConnection();
  assert.equal(mock.calls[0].body.path, '/models');
  assert.equal(mock.calls[0].body.method, 'GET');
  assert.deepEqual(result.models, ['gpt-image-1.5', 'custom-image']);
  assert.match(result.message, /以实际请求为准/);
});

test('连接测试不会把任意 HTTP 200 JSON 误判为供应商鉴权成功', async () => {
  for (const provider of ['openai', 'ark', 'compatible']) {
    const client = createClient(configuration(provider), captureFetch(reply({ ok: true })));
    await assert.rejects(client.testConnection(), error => error.code === 'INVALID_RESPONSE');
  }
});

test('Ark 图生视频提交首帧和结构化参数，自动采用首帧比例', async () => {
  const mock = captureFetch(reply({ id: 'cgt-fixture' }));
  const reference = 'data:image/png;base64,' + image.data[0].b64_json;
  const result = await createClient(
    configuration('ark', { duration: 8, videoRatio: '9:16', resolution: '720p' }),
    mock,
  ).submitVideo({ prompt: '镜头向前', reference });
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
  assert.equal(result.id, 'cgt-fixture');
  assert.equal(result.status, 'queued');
});

test('Ark 文生视频保留所选比例，排队和运行状态可查询到真实结果', async () => {
  const mock = captureFetch(
    reply({ id: 'cgt-fixture', status: 'queued' }),
    reply({ id: 'cgt-fixture', status: 'running' }),
    reply({
      id: 'cgt-fixture',
      status: 'succeeded',
      content: { video_url: 'https://media.provider.example/video.mp4?expires=123' },
    }),
  );
  const client = createClient(configuration('ark', { videoRatio: '9:16', duration: '5' }), mock);
  await client.submitVideo({ prompt: '镜头向前' });
  assert.equal(mock.calls[0].body.body.ratio, '9:16');
  assert.equal((await client.getVideo({ id: 'cgt-fixture' })).status, 'running');
  const completed = await client.getVideo({ id: 'cgt-fixture' });
  assert.equal(completed.status, 'succeeded');
  assert.equal(completed.src, 'https://media.provider.example/video.mp4?expires=123');
  assert.equal(mock.calls[1].body.path, '/contents/generations/tasks/cgt-fixture');
});

test('失败、过期与取消任务返回 failed，错误文本会脱敏', async () => {
  for (const status of ['failed', 'cancelled', 'expired']) {
    const mock = captureFetch(
      reply({ id: 'cgt-fixture', status, error: { message: 'invalid ' + key } }),
    );
    const result = await createClient(configuration('ark'), mock).getVideo({ id: 'cgt-fixture' });
    assert.equal(result.status, 'failed');
    assert.ok(result.error.includes('[已隐藏]'));
    assert.ok(!result.error.includes(key));
  }
});

test('OpenAI 官方视频在发出网络请求前拒绝，不会消耗生成额度', async () => {
  let calls = 0;
  const client = createClient(configuration('openai', { videoModel: 'sora-2' }), {
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(
    client.submitVideo({ prompt: '镜头向前' }),
    error => error.code === 'VIDEO_UNAVAILABLE',
  );
  await assert.rejects(
    client.getVideo({ id: 'video-fixture' }),
    error => error.code === 'VIDEO_UNAVAILABLE',
  );
  assert.equal(calls, 0);
  const compatible = createClient(
    configuration('compatible', { baseUrl: 'https://api.openai.com/v1' }),
    {
      fetchImpl: async () => {
        calls++;
      },
    },
  );
  await assert.rejects(
    compatible.submitVideo({ prompt: '镜头向前' }),
    error => error.code === 'VIDEO_UNAVAILABLE',
  );
  assert.equal(calls, 0);
});

test('自定义兼容接口仅浏览器直连，视频采用其 OpenAI JSON 协议', async () => {
  const mock = captureFetch(reply({ id: 'vendor-fixture', status: 'queued' }));
  await createClient(
    configuration('compatible', { duration: 8, videoRatio: '9:16' }),
    mock,
  ).submitVideo({ prompt: '城市下雨' });
  assert.equal(mock.calls[0].url, 'https://models.provider.example/v1/videos');
  assert.equal(mock.calls[0].init.headers.Authorization, 'Bearer ' + key);
  assert.deepEqual(mock.calls[0].body, {
    model: 'vendor-video-model',
    prompt: '城市下雨',
    seconds: '8',
    size: '720x1280',
  });
  assert.throws(
    () => createClient(configuration('compatible', { transport: 'proxy' })),
    error => error.code === 'CONFIG_TRANSPORT',
  );
});

test('兼容视频的横竖屏与分辨率映射正确，方形请求在联网前明确拒绝', async () => {
  for (const [videoRatio, resolution, size] of [
    ['16:9', '720p', '1280x720'],
    ['9:16', '720p', '720x1280'],
    ['16:9', '1080p', '1792x1024'],
    ['9:16', '1080p', '1024x1792'],
  ]) {
    const mock = captureFetch(reply({ id: 'vendor-fixture', status: 'queued' }));
    await createClient(configuration('compatible', { videoRatio, resolution }), mock).submitVideo({
      prompt: '城市下雨',
    });
    assert.equal(mock.calls[0].body.size, size);
  }
  let calls = 0;
  const square = createClient(configuration('compatible', { videoRatio: '1:1' }), {
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(
    square.submitVideo({ prompt: '方形画面' }),
    error => error.code === 'CONFIG_VALUE' && /16:9.*9:16/.test(error.message),
  );
  assert.equal(calls, 0);
  const ark = captureFetch(reply({ id: 'cgt-fixture' }));
  await createClient(configuration('ark', { videoRatio: '1:1' }), ark).submitVideo({
    prompt: '方形画面',
  });
  assert.equal(ark.calls[0].body.body.ratio, '1:1');
});

test('兼容接口完成后没有下载 URL 时，使用受鉴权的 content 下载返回 blob URL', async () => {
  const mock = captureFetch(
    reply({ id: 'vendor-fixture', status: 'completed', progress: 100 }),
    new Response(new Uint8Array([0, 0, 0, 24]), { headers: { 'content-type': 'video/mp4' } }),
  );
  const result = await createClient(configuration('compatible'), mock).getVideo({
    id: 'vendor-fixture',
  });
  assert.equal(result.status, 'succeeded');
  assert.equal(result.progress, 100);
  assert.match(result.src, /^blob:/);
  assert.equal(
    mock.calls[1].url,
    'https://models.provider.example/v1/videos/vendor-fixture/content',
  );
  URL.revokeObjectURL(result.src);
});

test('URL 校验拦截私网、非 HTTPS、账号与查询参数，官方 proxy 不接受改域名', () => {
  for (const baseUrl of [
    'http://api.provider.example/v1',
    'https://127.0.0.1/v1',
    'https://2130706433/v1',
    'https://[::1]/v1',
    'https://localhost/v1',
    'https://metadata.google.internal/v1',
    'https://api.local/v1',
    'https://user:pass@api.provider.example/v1',
    'https://api.provider.example/v1?token=abc',
    'https://api.provider.example/v1#x',
    'https://api.provider.example:8443/v1',
  ]) {
    assert.throws(
      () => createClient(configuration('compatible', { baseUrl })),
      error => error.code === 'CONFIG_URL',
    );
  }
  assert.throws(
    () => createClient(configuration('openai', { baseUrl: 'https://other.provider.example/v1' })),
    error => error.code === 'CONFIG_TRANSPORT',
  );
  assert.equal(
    validateBaseUrl(' https://api.provider.example/v1/ '),
    'https://api.provider.example/v1',
  );
});

test('401 与 429 显示可操作错误，原始 Key 与 Authorization 均不会进入错误对象', async () => {
  for (const status of [401, 429, 503]) {
    const mock = captureFetch(
      reply(
        { error: { message: 'credential ' + key + ' Authorization: Bearer secret-other-fixture' } },
        status,
      ),
    );
    await assert.rejects(
      createClient(configuration(), mock).generateImage({ prompt: '树' }),
      error => {
        assert.equal(error.status, status);
        assert.ok(error instanceof AIError);
        assert.ok(!JSON.stringify(error).includes(key));
        assert.ok(!error.message.includes(key));
        assert.ok(!error.message.includes('secret-other-fixture'));
        return true;
      },
    );
    assert.equal(mock.calls.length, 1);
  }
});

test('网络失败不会自动重试付费 POST，也不会泄漏 fetch 异常中的 Key', async () => {
  const mock = captureFetch(new Error('network echoed ' + key));
  await assert.rejects(
    createClient(configuration('compatible'), mock).generateImage({ prompt: '树' }),
    error => error.code === 'NETWORK_ERROR' && !error.message.includes(key),
  );
  assert.equal(mock.calls.length, 1);
});

test('已取消请求不会联网，进行中的 AbortSignal 会传递给 fetch', async () => {
  const first = new AbortController();
  first.abort();
  let calls = 0;
  const client = createClient(configuration(), {
    fetchImpl: async () => {
      calls++;
    },
  });
  await assert.rejects(
    client.generateImage({ prompt: '树', signal: first.signal }),
    error => error.name === 'AbortError',
  );
  assert.equal(calls, 0);
  const second = new AbortController();
  const waiting = createClient(configuration(), {
    fetchImpl: (_, init) =>
      new Promise((_, reject) => {
        assert.equal(init.signal.aborted, false);
        init.signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
          { once: true },
        );
      }),
  }).generateImage({ prompt: '树', signal: second.signal });
  second.abort();
  await assert.rejects(waiting, error => error.name === 'AbortError');
});

test('超时停止等待而不重发付费请求，提示查询已有任务', async () => {
  let calls = 0;
  const client = createClient(configuration(), {
    timeoutMs: 5,
    fetchImpl: (_, init) => {
      calls++;
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('abort'), { name: 'AbortError' })),
        ),
      );
    },
  });
  await assert.rejects(
    client.generateImage({ prompt: '树' }),
    error => error.code === 'TIMEOUT' && /避免重复提交/.test(error.message),
  );
  assert.equal(calls, 1);
});

test('无媒体、未知任务状态和无效任务 ID 明确失败，不会退回示例素材', async () => {
  const missing = createClient(configuration(), captureFetch(reply({ data: [] })));
  await assert.rejects(
    missing.generateImage({ prompt: '树' }),
    error => error.code === 'INVALID_RESPONSE',
  );
  const unknown = createClient(
    configuration('ark'),
    captureFetch(reply({ id: 'cgt-fixture', status: 'mystery' })),
  );
  await assert.rejects(
    unknown.getVideo({ id: 'cgt-fixture' }),
    error => error.code === 'INVALID_RESPONSE',
  );
  const client = createClient(configuration('ark'), {
    fetchImpl: async () => assert.fail('不应发送非法 ID'),
  });
  await assert.rejects(
    client.getVideo({ id: '../models' }),
    error => error.code === 'CONFIG_VALUE',
  );
});

test('参考图：方舟放在同一生成接口的 image 字段，OpenAI 改用 JSON 图片编辑接口', async () => {
  const ref = 'data:image/jpeg;base64,/9j/AA==';
  const ark = captureFetch(reply(image), reply(image));
  await createClient(configuration('ark'), ark).generateImage({
    prompt: '同一个角色',
    references: [ref],
  });
  await createClient(configuration('ark'), ark).generateImage({
    prompt: '同一个角色',
    references: [ref, ref],
  });
  assert.equal(ark.calls[0].body.path, '/images/generations');
  assert.equal(ark.calls[0].body.body.image, ref);
  assert.deepEqual(ark.calls[1].body.body.image, [ref, ref]);

  const openai = captureFetch(reply(image), reply(image), reply(image));
  await createClient(configuration(), openai).generateImage({
    prompt: '同一个角色',
    references: [ref],
  });
  await createClient(configuration('openai', { imageModel: 'gpt-image-2' }), openai).generateImage({
    prompt: '同一个角色',
    references: [ref],
  });
  await createClient(configuration(), openai).generateImage({ prompt: '没有参考' });
  assert.equal(openai.calls[0].body.path, '/images/edits');
  assert.deepEqual(openai.calls[0].body.body.images, [{ image_url: ref }]);
  assert.equal(openai.calls[0].body.body.input_fidelity, 'high');
  assert.equal(
    openai.calls[1].body.body.input_fidelity,
    undefined,
    'gpt-image-2 不接受 input_fidelity',
  );
  assert.equal(openai.calls[2].body.path, '/images/generations');
  assert.equal(openai.calls[2].body.body.images, undefined);

  const compatible = captureFetch();
  await assert.rejects(
    createClient(configuration('compatible'), compatible).generateImage({
      prompt: '树',
      references: [ref],
    }),
    error => error.code === 'CONFIG_REFERENCE',
  );
  await assert.rejects(
    createClient(configuration('ark'), compatible).generateImage({
      prompt: '树',
      references: ['http://127.0.0.1/a.png'],
    }),
    error => error.code === 'CONFIG_REFERENCE',
  );
  assert.equal(compatible.calls.length, 0);
});

const MODERATED = '内容被供应商的安全审核拒绝，请调整描述或参考图后再试';

test('内容审核拒绝显示成中文的审核提示，不显示成参数错误', async () => {
  const cases = [
    // Ark, straight from the provider.
    [
      'ark',
      { error: { code: 'InputTextSensitiveContentDetected', message: 'The request failed.' } },
      MODERATED,
    ],
    // Through the backend relay only the provider's message survives.
    [
      'ark',
      {
        error: {
          code: 'UPSTREAM_400',
          message:
            '供应商请求失败：The request failed because the output image may contain sensitive information.',
        },
      },
      MODERATED,
    ],
    [
      'ark',
      {
        error: {
          code: 'InputImageSensitiveContentDetected.PrivacyInformation',
          message: 'The request failed because the input image may contain real person.',
        },
      },
      '图片可能含有真人人像，被供应商的安全审核拒绝，请换一张图后再试',
    ],
    [
      'openai',
      {
        error: {
          code: 'moderation_blocked',
          message: 'Your request was rejected by the safety system.',
        },
      },
      MODERATED,
    ],
    ['openai', { error: { code: 'content_policy_violation', message: 'Rejected.' } }, MODERATED],
    // Through the backend relay the provider's code arrives as upstreamCode.
    [
      'ark',
      {
        error: {
          code: 'UPSTREAM_400',
          message: '供应商请求失败：The request failed.',
          upstreamCode: 'InputImageSensitiveContentDetected',
        },
      },
      MODERATED,
    ],
  ];
  for (const [provider, body, message] of cases) {
    const client = createClient(configuration(provider), captureFetch(reply(body, 400)));
    await assert.rejects(client.generateImage({ prompt: '海边' }), error => {
      assert.equal(error.message, message);
      assert.equal(error.code, 'CONTENT_REJECTED');
      assert.equal(error.status, 400);
      return true;
    });
  }
});

test('其他 400 错误仍按参数错误处理', async () => {
  const client = createClient(
    configuration('ark'),
    captureFetch(reply({ error: { code: 'InvalidParameter', message: 'size is invalid' } }, 400)),
  );
  await assert.rejects(client.generateImage({ prompt: '海边' }), error => {
    assert.equal(error.code, 'UPSTREAM_ERROR');
    assert.ok(error.message.startsWith('请求参数不被模型接受'));
    return true;
  });
});

test('视频任务因审核失败时返回中文的审核提示', async () => {
  const mock = captureFetch(
    reply({
      id: 'cgt-fixture',
      status: 'failed',
      error: {
        code: 'OutputVideoSensitiveContentDetected',
        message: 'The request failed because the output video may contain sensitive information.',
      },
    }),
  );
  const result = await createClient(configuration('ark'), mock).getVideo({ id: 'cgt-fixture' });
  assert.equal(result.status, 'failed');
  assert.equal(result.error, MODERATED);
});
