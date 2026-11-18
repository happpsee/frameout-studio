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

const SPEND =
  '会花钱：提交后就计费、不能取消。先用 dryRun: true 报价，告诉用户价钱并得到同意再正式生成。';

server.registerTool(
  'generate_image',
  {
    title: '生成图片',
    description: `用 Seedream 生成一张图片，放到画布上，立刻返回新卡片 id（之后用 wait_card 等它完成）。references 里的图片按顺序是提示词里的「图1、图2…」，画布上会从它们连线过来。${SPEND}`,
    inputSchema: {
      prompt: z.string(),
      references: z
        .array(z.string())
        .optional()
        .describe('参考图片的卡片 id，按顺序对应 图1、图2…'),
      size: z
        .string()
        .optional()
        .describe('如 2K、1584x2816（9:16）、2816x1584（16:9）；不填用界面当前设置'),
      x: z.number().optional(),
      y: z.number().optional(),
      dryRun: z.boolean().optional().describe('只报价，不生成'),
    },
  },
  safely(async (args: Record<string, unknown>) => text(await call('generate_image', args))),
);

server.registerTool(
  'generate_video',
  {
    title: '生成视频',
    description: `用 Seedance 生成视频，立刻返回新卡片 id（之后用 wait_card 等它完成，通常几分钟）。两种用法二选一：
1. firstFrame：一张图片作为首帧；
2. 全模态参考（方舟 Seedance 2.5）：images 最多 30 张参考图，按顺序是提示词里的「@图像1、@图像2…」；sounds 最多 10 段从视频里截的声音（每段 2–30 秒，总共不超过 30 秒），按顺序是「@音频1…」。提示词里写清楚谁参考哪张、以哪张为首帧（如「以 @图像3 作为首帧，耄耋参考 @图像1」）。本地视频不能直接作为参考视频，需要的话取几帧当参考图、截声音当参考音频。
${SPEND}`,
    inputSchema: {
      prompt: z.string(),
      firstFrame: z.string().optional().describe('首帧图片的卡片 id'),
      images: z.array(z.string()).optional().describe('参考图片的卡片 id'),
      sounds: z
        .array(z.object({ cardId: z.string(), from: z.number(), length: z.number() }))
        .optional()
        .describe('从视频卡片截取的参考声音：从第 from 秒起，长 length 秒'),
      duration: z.number().optional().describe('秒数，4–15；不填用界面当前设置'),
      ratio: z.string().optional().describe('9:16、16:9、1:1 等'),
      resolution: z.string().optional().describe('480p、720p、1080p'),
      x: z.number().optional(),
      y: z.number().optional(),
      dryRun: z.boolean().optional().describe('只报价，不生成'),
    },
  },
  safely(async (args: Record<string, unknown>) => text(await call('generate_video', args))),
);

const RUNNING = new Set(['submitting', 'queued', 'running']);

server.registerTool(
  'wait_card',
  {
    title: '等生成完成',
    description:
      '等一张正在生成的卡片结束，返回 ready（完成）、failed（失败，附原因）或仍在进行（超时）。完成后用 view_card 检查画面。',
    inputSchema: {
      cardId: z.string(),
      timeoutSeconds: z.number().optional().describe('最多等多久，默认 600 秒'),
    },
    annotations: { readOnlyHint: true },
  },
  safely(async ({ cardId, timeoutSeconds = 600 }: { cardId: string; timeoutSeconds?: number }) => {
    const deadline = Date.now() + timeoutSeconds * 1000;
    for (;;) {
      const status = (await call('card_status', { cardId })) as { status: string };
      if (!RUNNING.has(status.status) || Date.now() > deadline) return text(status);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }),
);

await server.connect(new StdioServerTransport());
