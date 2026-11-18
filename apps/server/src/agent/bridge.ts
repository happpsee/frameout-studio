// Carries an agent's calls to the open app window, which owns the project, and their answers
// back. The window subscribes to commands over SSE and posts each result; the agent's request
// waits for it. Desktop only.
import { randomUUID } from 'node:crypto';

export type AgentCommand = { id: string; name: string; args: unknown };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

/** Errors an agent can act on: what went wrong and a hint, by code. */
export class AgentError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class AgentBridge {
  readonly #windows = new Set<(command: AgentCommand) => void>();
  readonly #pending = new Map<string, Pending>();
  readonly #timeoutMs: number;

  constructor({ timeoutMs = 120_000 }: { timeoutMs?: number } = {}) {
    this.#timeoutMs = timeoutMs;
  }

  /** A window starts taking commands; the returned function stops it. */
  subscribe(deliver: (command: AgentCommand) => void): () => void {
    this.#windows.add(deliver);
    return () => this.#windows.delete(deliver);
  }

  /** Sends a command to the window and waits for its answer. */
  call(name: string, args: unknown, timeoutMs = this.#timeoutMs): Promise<unknown> {
    // The newest window is the one in front; older ones may be closing.
    const deliver = [...this.#windows].at(-1);
    if (!deliver)
      return Promise.reject(new AgentError('NO_WINDOW', '帧外没有打开，或窗口还没准备好'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new AgentError('WINDOW_TIMEOUT', '帧外窗口没有及时回应'));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        },
      });
      deliver({ id, name, args });
    });
  }

  /** The window's answer to a command. False when nothing was waiting for it. */
  settle(id: string, outcome: { result?: unknown; error?: { code?: unknown; message?: unknown } }) {
    const pending = this.#pending.get(id);
    if (!pending) return false;
    this.#pending.delete(id);
    if (outcome.error)
      pending.reject(
        new AgentError(
          typeof outcome.error.code === 'string' ? outcome.error.code : 'WINDOW_ERROR',
          typeof outcome.error.message === 'string' ? outcome.error.message : '操作失败',
        ),
      );
    else pending.resolve(outcome.result ?? null);
    return true;
  }
}
