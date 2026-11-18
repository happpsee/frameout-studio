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

let current: { handler: AgentHandler; projectId: string } | null = null;
let app: AgentHandler | null = null;
/** Commands about the app itself, answered whether or not a project is open. */
const APP_COMMANDS = new Set(['list_projects', 'open_project']);

/** The open project takes the agent's commands until the returned function is called. */
export function setAgentHandler(handler: AgentHandler, projectId: string) {
  const entry = { handler, projectId };
  current = entry;
  return () => {
    if (current === entry) current = null;
  };
}

/** The app shell answers list_projects and open_project. */
export function setAppHandler(handler: AgentHandler) {
  app = handler;
  return () => {
    if (app === handler) app = null;
  };
}

/** Resolves once the project with this id is open and taking commands. */
export async function projectReady(projectId: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (current?.projectId !== projectId) {
    if (Date.now() > deadline) throw new AgentCommandError('OPEN_TIMEOUT', '项目没能及时打开');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
}

async function answer(id: string, name: string, args: unknown) {
  let body: unknown;
  try {
    const input =
      typeof args === 'object' && args !== null ? (args as Record<string, unknown>) : {};
    const handler = APP_COMMANDS.has(name) ? app : current?.handler;
    if (!handler)
      throw new AgentCommandError('NO_PROJECT', '没有打开的项目，请先用 open_project 打开一个');
    body = { result: await handler(name, input) };
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
