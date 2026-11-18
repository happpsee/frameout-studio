// Tools that open projects and change them: lines, notes, consistency, the film and its sound.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { call } from './app-client.ts';

type Reply = { content: { type: 'text'; text: string }[] };
type Safely = <A>(run: (args: A) => Promise<Reply>) => (args: A) => Promise<Reply>;
const text = (value: unknown): Reply => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});

const OPERATIONS = `每个操作是 { op, ... }：
- link { from, to }：从 from 连线到 to，to 成为 from 的参考；from 是文本时写 "note:<id>"，文本内容会加到 to 的提示词前面
- unlink { from, to }；rename_link { from, to, name }：线上的名字也是提示词里 @ 引用的名字
- move_card { cardId, x, y }；rename_card { cardId, name }；delete_cards { cardIds }
- add_note { text, title?, kind?: "text"|"script", x?, y? } → 返回 noteId；update_note { noteId, text?, title? }；delete_note { noteId }
- set_consistency { notes?, references? }：所有生成都会带上的统一设定文字和参考图卡片
- set_film { shots: [{ cardId, seconds? }] }：按顺序整体替换成片，seconds 是这一镜播放几秒（1–15，默认素材长度）
- add_sound { cardId, from, length, at, mode?: "replace"|"mix", volume? } → 返回 soundId：从视频卡片取 from 秒起 length 秒的声音，放在成片第 at 秒；replace 替换镜头原声，mix 叠加
- update_sound { soundId, from?, length?, at?, mode?, volume? }；remove_sound { soundId }`;

export function registerProjectTools(server: McpServer, safely: Safely) {
  server.registerTool(
    'list_projects',
    {
      title: '列出项目',
      description: '列出帧外里的所有项目（id、标题、素材数、成片镜头数和时长、最后修改时间）。',
      annotations: { readOnlyHint: true },
    },
    safely(async () => text(await call('list_projects'))),
  );

  server.registerTool(
    'open_project',
    {
      title: '打开项目',
      description: '在帧外里打开一个项目，打开后其他工具都作用于它。项目 id 来自 list_projects。',
      inputSchema: { projectId: z.string() },
    },
    safely(async (args: { projectId: string }) => text(await call('open_project', args))),
  );

  server.registerTool(
    'edit_project',
    {
      title: '修改项目',
      description: `整批修改当前项目，要么全部生效、要么一处都不改，在界面上算一步，可以撤销。必须带上 get_project 返回的 version；项目在那之后被改过（包括用户自己改、或刚生成/导入了素材）会返回 VERSION_CONFLICT，重新 get_project 再改。
${OPERATIONS}`,
      inputSchema: {
        version: z.string().describe('get_project 返回的 version'),
        operations: z.array(z.object({ op: z.string() }).passthrough()),
      },
    },
    safely(async (args: { version: string; operations: unknown[] }) =>
      text(await call('edit_project', args)),
    ),
  );
}
