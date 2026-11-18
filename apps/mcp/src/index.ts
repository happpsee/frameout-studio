// The frameout MCP server: lets Claude work in the open project of the frameout desktop app
// through the app's own agent channel, instead of clicking its window.
import fs from 'node:fs/promises';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { AppError, call, upload } from './app-client.ts';

const MEDIA_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
});

/** Errors go back to Claude as text it can act on, never as a crash. */
const safely =
  <A>(run: (args: A) => Promise<ReturnType<typeof text> | { content: unknown[] }>) =>
  async (args: A) => {
    try {
      return (await run(args)) as ReturnType<typeof text>;
    } catch (error) {
      const code = error instanceof AppError ? error.code : 'FAILED';
      const message = error instanceof Error ? error.message : String(error);
      return { ...text({ error: { code, message } }), isError: true };
    }
  };

const server = new McpServer({ name: 'frameout', version: '0.1.0' });

server.registerTool(
  'get_project',
  {
    title: '读取当前项目',
    description:
      '读取帧外当前打开的项目：所有卡片（id、类型、提示词、状态、花费）、卡片之间的连线、文本、一致性设置、成片镜头顺序和音频轨、累计花费。其他工具用这里的 id。',
    annotations: { readOnlyHint: true },
  },
  safely(async () => text(await call('get_project'))),
);

server.registerTool(
  'view_card',
  {
    title: '查看卡片画面',
    description:
      '看一张卡片的画面：图片返回缩小后的原图；视频返回 8 帧拼图（4×2，按时间从左到右、从上到下），并说明每帧取自第几秒。用来检查生成结果、对比参考。',
    inputSchema: { cardId: z.string().describe('卡片 id，来自 get_project') },
    annotations: { readOnlyHint: true },
  },
  safely(async ({ cardId }: { cardId: string }) => {
    const result = (await call('view_card', { cardId })) as { data: string; note: string };
    return {
      content: [
        { type: 'image' as const, data: result.data, mimeType: 'image/jpeg' },
        { type: 'text' as const, text: result.note },
      ],
    };
  }),
);

server.registerTool(
  'import_media',
  {
    title: '导入本地图片或视频',
    description:
      '把本机的一张图片或一段视频导入当前项目，放到画布上（不经过文件选择框）。返回新卡片的 id。',
    inputSchema: {
      path: z.string().describe('文件的绝对路径'),
      name: z.string().optional().describe('卡片名字，默认用文件名'),
      x: z.number().optional().describe('放在画布上的位置；不填则放在当前视野中央'),
      y: z.number().optional(),
    },
  },
  safely(async (args: { path: string; name?: string; x?: number; y?: number }) => {
    const type = MEDIA_TYPES[path.extname(args.path).toLowerCase()];
    if (!type)
      throw new AppError(
        'UNSUPPORTED_FILE',
        '只能导入图片（png/jpg/webp/gif）或视频（mp4/mov/webm）',
      );
    const fileId = await upload(await fs.readFile(args.path), type);
    const name = args.name ?? path.basename(args.path).replace(/\.[^.]+$/, '');
    return text(await call('import_media', { fileId, name, x: args.x, y: args.y }));
  }),
);

server.registerTool(
  'extract_frame',
  {
    title: '从视频取一帧',
    description:
      '从视频卡片的某一秒取一帧原尺寸画面，作为新的图片卡片放在它右边。常用来取上一段的最后一帧，作为下一段的首帧或参考。',
    inputSchema: {
      cardId: z.string().describe('视频卡片 id'),
      seconds: z.number().describe('第几秒；超过视频长度时取最后一帧'),
    },
  },
  safely(async (args: { cardId: string; seconds: number }) =>
    text(await call('extract_frame', args)),
  ),
);

await server.connect(new StdioServerTransport());
