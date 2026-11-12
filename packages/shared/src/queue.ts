const queues = new Map<unknown, Promise<unknown>>();

/**
 * Runs operations that share a key one after another, in call order.
 *
 * 对同一个 key 的操作，先调用的一定先执行完，后面的才开始；
 * 前一个操作失败不会阻塞后面的操作。不同 key 之间互不影响。
 */
export function queue<K, T>(key: K, operation: (key: K) => T | Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(() => operation(key));
  queues.set(key, current);
  const clear = () => {
    if (queues.get(key) === current) queues.delete(key);
  };
  current.then(clear, clear);
  return current;
}
