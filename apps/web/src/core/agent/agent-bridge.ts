// The window's end of the agent channel (docs/architecture/agent-plugin.md): commands from an
// agent arrive over SSE, the open project carries them out, and the answer goes back.
// Desktop only; the server turns the channel on there.

/** Carries out one command for the project that is open, or throws an error to report. */
export type AgentHandler = (name: string, args: Record<string, unknown>) => Promise<unknown>;

/** An error whose code tells the agent what to do next. */
export class AgentCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

let current: AgentHandler | null = null;

/** The open project takes the agent's commands until the returned function is called. */
export function setAgentHandler(handler: AgentHandler) {
  current = handler;
  return () => {
    if (current === handler) current = null;
  };
}

async function answer(id: string, name: string, args: unknown) {
  let body: unknown;
  try {
    if (!current) throw new AgentCommandError('NO_PROJECT', '请先在帧外打开一个项目');
    const input =
      typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
    body = { result: await current(name, input) };
  } catch (error) {
    body = {
      error: {
        code: error instanceof AgentCommandError ? error.code : 'FAILED',
        message: error instanceof Error ? error.message : '操作失败',
      },
    };
  }
  await fetch(`/api/agent/bridge/results/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/** Starts taking commands. EventSource reconnects by itself if the server restarts. */
export function connectAgentBridge() {
  if (typeof EventSource === 'undefined') return () => {};
  const source = new EventSource('/api/agent/bridge/events');
  source.onmessage = event => {
    const { id, name, args } = JSON.parse(event.data) as {
      id: string;
      name: string;
      args: unknown;
    };
    void answer(id, name, args);
  };
  return () => source.close();
}
