// Tools that open projects and change them: lines, notes, consistency, the film and its sound.
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError, call, download } from './app-client.ts';

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

  server.registerTool(
    'export_film',
    {
      title: '导出成片',
      description:
        '按成片顺序把镜头和音频轨导出成 MP4，写到本机（默认桌面）。在帧外里渲染，可能要一两分钟；完成后返回文件路径、大小和声音情况。',
      inputSchema: {
        ratio: z.enum(['9:16', '16:9', '1:1']).optional().describe('默认 9:16'),
        quality: z.enum(['720p', '1080p']).optional().describe('默认 1080p'),
        path: z
          .string()
          .optional()
          .describe('保存到哪里（绝对路径，.mp4）；不填存到桌面，用项目名命名'),
      },
    },
    safely(async (args: { ratio?: string; quality?: string; path?: string }) => {
      const started = (await call('export_film', { ratio: args.ratio, quality: args.quality })) as {
        exportId: string;
      };
      const deadline = Date.now() + 20 * 60_000;
      for (;;) {
        const run = (await call('export_status', { exportId: started.exportId })) as {
          status: string;
          error?: string;
          fileId?: string;
          fileName?: string;
          bytes?: number;
          sound?: string;
        };
        if (run.status === 'failed') throw new AppError('EXPORT_FAILED', run.error ?? '导出失败');
        if (run.status === 'done') {
          const target = args.path ?? path.join(os.homedir(), 'Desktop', run.fileName!);
          await fs.mkdir(path.dirname(target), { recursive: true });
          await fs.writeFile(target, await download(run.fileId!), { flag: 'wx' }).catch(error => {
            if (error.code === 'EEXIST')
              throw new AppError('FILE_EXISTS', `已有同名文件：${target}，换个 path`);
            throw error;
          });
          return text({ path: target, bytes: run.bytes, sound: run.sound });
        }
        if (Date.now() > deadline) throw new AppError('EXPORT_TIMEOUT', '导出超过 20 分钟还没完成');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }),
  );
}
