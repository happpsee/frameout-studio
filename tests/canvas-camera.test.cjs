const test = require('node:test');
const assert = require('node:assert/strict');
const { create, normalizeWheel, clamp } = require('../dist/canvas-camera.js');

function harness(t, extra = {}) {
  let time = 0;
  let nextId = 1;
  const frames = new Map();
  const renders = [];
  const rests = [];
  const camera = create({
    initial: { x: 70, y: 20, zoom: 0.8 },
    onRender: (value) => renders.push(value),
    onRest: (value) => rests.push(value),
    requestFrame: (callback) => { const id = nextId++; frames.set(id, callback); return id; },
    cancelFrame: (id) => frames.delete(id),
    now: () => time,
    ...extra,
  });
  t.after(() => camera.destroy());
  function frame(nextTime = time + 16) {
    time = nextTime;
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(time));
  }
  frame(0);
  renders.length = 0;
  return { camera, frames, renders, rests, frame };
}

test('直接输入即时更新逻辑相机，同一帧只渲染一次', (t) => {
  const { camera, renders, frames, frame } = harness(t);
  camera.pan(4, -8);
  camera.pan(-1, 5);
  camera.zoomBy(1.2, { x: 300, y: 150 });
  assert.equal(renders.length, 0);
  assert.equal(frames.size, 1);
  assert.equal(camera.get().zoom, 0.96);
  frame();
  assert.equal(renders.length, 1);
  assert.deepEqual(renders[0], camera.get());
});

test('二维平移保持缩放比例，返回值不会泄漏内部状态', (t) => {
  const { camera } = harness(t);
  camera.pan(-120, 85);
  assert.deepEqual(camera.get(), { x: -50, y: 105, zoom: 0.8 });
  const value = camera.get();
  value.x = 999;
  assert.equal(camera.get().x, -50);
});

test('多轮缩放和边界钳制后，鼠标世界锚点不漂移', (t) => {
  const { camera } = harness(t);
  const point = { x: 531.25, y: 218.5 };
  const initial = camera.get();
  const world = { x: (point.x - initial.x) / initial.zoom, y: (point.y - initial.y) / initial.zoom };
  for (const factor of [1.12, 1.8, 0.4, 20, 0.01, 1.5, 2.5, 0.7]) {
    camera.zoomBy(factor, point);
    const next = camera.get();
    assert.ok(Math.abs(next.x + world.x * next.zoom - point.x) < 1e-6);
    assert.ok(Math.abs(next.y + world.y * next.zoom - point.y) < 1e-6);
    assert.ok(next.zoom >= 0.15 && next.zoom <= 4);
  }
});

test('连续放大按钮按目标比例累计，动画过程仍保持锚点', (t) => {
  const { camera, frame } = harness(t);
  const point = { x: 400, y: 250 };
  const initial = camera.get();
  const world = { x: (point.x - initial.x) / initial.zoom, y: (point.y - initial.y) / initial.zoom };
  camera.zoomBy(1.2, point, { animate: true });
  camera.zoomBy(1.2, point, { animate: true });
  assert.ok(Math.abs(camera.getTarget().zoom - 1.152) < 1e-12);
  assert.equal(camera.get().zoom, 0.8);
  for (const time of [30, 60, 110, 180]) {
    frame(time);
    const next = camera.get();
    assert.ok(Math.abs(next.x + world.x * next.zoom - point.x) < 1e-6);
    assert.ok(Math.abs(next.y + world.y * next.zoom - point.y) < 1e-6);
  }
  assert.ok(Math.abs(camera.get().zoom - 1.152) < 1e-12);
});

test('直接拖动中断动画，从当前画面继续且没有尾随帧', (t) => {
  const { camera, frame, frames } = harness(t);
  camera.set({ x: 300, y: 200, zoom: 2 }, { animate: true });
  frame(70);
  const displayed = camera.get();
  camera.pan(18, -12);
  assert.deepEqual(camera.get(), { x: displayed.x + 18, y: displayed.y - 12, zoom: displayed.zoom });
  frame(200);
  assert.deepEqual(camera.getTarget(), camera.get());
  assert.equal(frames.size, 0);
});

test('flush 只提交当前画面，不跳到动画终点；cancel 保留当前画面', (t) => {
  const { camera, renders, frame, frames } = harness(t);
  camera.set({ x: 0, y: 0, zoom: 2 }, { animate: true });
  frame(50);
  const displayed = camera.get();
  camera.flush();
  assert.deepEqual(camera.get(), displayed);
  assert.notDeepEqual(camera.get(), camera.getTarget());
  camera.cancel();
  frame(250);
  assert.deepEqual(camera.get(), displayed);
  assert.equal(frames.size, 0);
  assert.deepEqual(renders.at(-1), displayed);
});

test('减少动态效果时按钮与 fit 立即到达目标，只排一次渲染', (t) => {
  const { camera, frame, frames, renders } = harness(t, { reducedMotion: () => true });
  camera.set({ x: 1, y: 2, zoom: 1.5 }, { animate: true });
  assert.deepEqual(camera.get(), { x: 1, y: 2, zoom: 1.5 });
  assert.deepEqual(camera.getTarget(), camera.get());
  frame(16);
  assert.equal(renders.length, 1);
  assert.equal(frames.size, 0);
});

test('输入稳定后只触发一次保存回调，动画完成也触发一次', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { camera, rests, frame } = harness(t);
  camera.pan(1, 2);
  t.mock.timers.tick(100);
  camera.pan(3, 4);
  t.mock.timers.tick(179);
  assert.equal(rests.length, 0);
  t.mock.timers.tick(1);
  assert.equal(rests.length, 1);
  assert.deepEqual(rests[0], camera.get());
  camera.zoomTo(2, { x: 20, y: 30 }, { animate: true });
  frame(180);
  assert.equal(rests.length, 2);
  t.mock.timers.tick(500);
  assert.equal(rests.length, 2);
});

test('destroy 取消动画帧和保存回调，之后调用不产生更新', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { camera, frame, frames, renders, rests } = harness(t);
  camera.pan(2, 4);
  camera.destroy();
  const final = camera.get();
  camera.pan(100, 100);
  camera.zoomBy(2, { x: 1, y: 1 });
  camera.set({ x: 99, y: 99, zoom: 4 });
  frame(500);
  t.mock.timers.tick(500);
  assert.deepEqual(camera.get(), final);
  assert.equal(frames.size, 0);
  assert.equal(renders.length, 0);
  assert.equal(rests.length, 0);
});

test('滚轮 deltaMode 按像素、行、页统一，并保留横向分量', () => {
  assert.deepEqual(normalizeWheel({ deltaX: 2, deltaY: -3, deltaMode: 0 }, 600), { dx: 2, dy: -3 });
  assert.deepEqual(normalizeWheel({ deltaX: 2, deltaY: -3, deltaMode: 1 }, 600), { dx: 32, dy: -48 });
  assert.deepEqual(normalizeWheel({ deltaX: 2, deltaY: -3, deltaMode: 2 }, 600), { dx: 1200, dy: -1800 });
  assert.deepEqual(normalizeWheel({ deltaX: NaN, deltaY: Infinity, deltaMode: 0 }), { dx: 0, dy: 0 });
});

test('坏存档和非法输入始终被归一为有限相机', (t) => {
  const { camera } = harness(t, { initial: { x: NaN, y: Infinity, zoom: 0 } });
  assert.deepEqual(camera.get(), { x: 0, y: 0, zoom: 0.15 });
  camera.set({ x: NaN, y: -Infinity, zoom: Infinity });
  camera.pan(NaN, Infinity);
  camera.zoomTo(NaN, { x: NaN, y: Infinity });
  assert.deepEqual(camera.get(), { x: 0, y: 0, zoom: 0.15 });
  assert.equal(clamp(NaN, 0.15, 4, 1), 1);
  assert.equal(clamp(Infinity, 0.15, 4, 1), 1);
});
