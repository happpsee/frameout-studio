import { describe, expect, test } from 'vitest';
import { queue } from './queue.ts';

describe('queue', () => {
  test('同一 key 的操作按调用顺序串行执行', async () => {
    const order: string[] = [];
    const first = queue('test', async () => {
      await new Promise(resolve => setTimeout(resolve, 80));
      order.push('A');
    });
    const second = queue('test', () => {
      order.push('B');
    });
    await Promise.all([first, second]);
    expect(order).toEqual(['A', 'B']);
  });

  test('前一个操作失败不会阻塞后面的操作', async () => {
    const failed = queue('failing', () => Promise.reject(new Error('boom')));
    const next = queue('failing', () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('ok');
  });
});
