import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../dist/server/index.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
assert.equal(typeof worker.fetch, 'function');
for (const resource of ['/', '/studio.js', '/ai-client.js', '/ai-settings.js', '/select-control.js', '/select-control.css', '/assets/forest-astronaut.png']) {
  const result = await worker.fetch(new Request('https://frameout.test' + resource));
  assert.equal(result.status, 200, resource);
  assert.ok((await result.arrayBuffer()).byteLength > 0, resource);
}
const blocked = await worker.fetch(new Request('https://frameout.test/api/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
assert.equal(blocked.status, 400);
console.log('Worker 静态资源、ESM 入口和 API 校验通过');
