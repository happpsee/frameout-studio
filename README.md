# 帧外 FRAMEOUT

[![check](https://github.com/happpsee/frameout-studio/actions/workflows/check.yml/badge.svg)](https://github.com/happpsee/frameout-studio/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> An open-source, local-first AI video canvas: generate images and video shots with your own API keys, arrange them on an infinite canvas, and export the film as MP4. TypeScript monorepo (React + Express + Electron). Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

帧外是一个本地优先的 AI 视频创作画布。用你自己的 API Key 生成图片和视频镜头，在无限画布上摆开比较，排成一条片子，在本机导出 MP4。

项目和素材保存在你自己的浏览器或电脑里。没有账号，没有云端，生成费用由你直接付给供应商。

有两种用法：浏览器版，和 macOS 桌面版。

## 现在能做什么

- **画布**：图片卡片、视频卡片、文本和脚本卡片。卡片之间的连线表示来源：哪张图是参考图，哪张图是视频的首帧，哪段文字进了提示词。支持多选、框选、排成网格或一行一列、一键整理、列表视图、撤销和重做，缩放范围 15%～400%。
- **生成**：文字生成图片，文字生成视频，以一张图片为首帧生成视频。参考图可以标明用途（角色、场景、道具、风格）；一段“统一设定”会附在每次生成的提示词后面，让人物和画风在各个镜头里保持一致。
- **价格**：生成前显示预估费用。目前只有火山方舟的默认模型有价格表，其他模型不显示，不会瞎猜。
- **脚本到镜头**：脚本卡片每行写一个镜头，可以整组生成，一次最多 8 个，可以暂停和继续。
- **成片**：把镜头加入成片，排序，调每个镜头的时长，预览，导出 MP4（16:9、9:16、1:1，720p 或 1080p，30 帧）。视频片段自带的声音会保留，也可以从别的视频里取一段声音来替换或叠加。
- **项目**：多个项目，自动保存，每个项目保留最近 8 个版本。
- **让 Claude 操作**（仅桌面版）：一个 Claude Code 插件，Claude 可以直接读项目、看画面、生成、编排和导出，不用点界面。见下面的“Agent 插件”。

画布上的操作方法在应用里的“使用指南”中。

## 现状

项目还很早期，由一个人开发。下面是各部分的真实状态。

| 部分 | 状态 |
| --- | --- |
| 画布、生成、成片导出 | 可用。自动化测试用的是模拟的供应商响应 |
| macOS 桌面版 | 可用，需要自己构建。应用只做了本机临时签名，没有经过 Apple 公证，拷到别的 Mac 上会被系统拦截 |
| 桌面版的生成任务 | 交给本机的任务引擎执行：切换页面或关掉窗口不会中断，结果在下次打开项目时放回画布。退出应用后任务不会继续 |
| Agent 插件 | 实验中（0.1.0），仅桌面版 |
| 自定义兼容服务 | 实验中。能不能用取决于对方的接口和跨域设置 |
| 公网部署（Docker + Caddy） | 配置已经写好，还没有在真实服务器上验证过 |
| Windows、Linux 桌面版 | 还没做，见 [#5](https://github.com/happpsee/frameout-studio/issues/5) |
| 账号、云端同步、多人协作 | 还没做。`apps/api`（FastAPI）目前只有一个健康检查接口 |

导出成片需要浏览器支持 WebCodecs，请用最新版的 Chrome 或 Edge，或者用桌面版。

## 支持的供应商

| 供应商 | 图片 | 视频 | 参考图 | 请求怎么发出去 |
| --- | --- | --- | --- | --- |
| OpenAI | 支持 | 不支持 | 支持 | 经后端的 `/api/ai` 转发到官方地址 |
| 火山方舟 | 支持 | 支持 | 支持 | 经后端的 `/api/ai` 转发到官方地址 |
| 自定义兼容服务 | 支持 | 支持 | 不支持 | 浏览器直接请求，需要对方允许跨域 |

可选的模型在“API 设置”里，实际能用哪些取决于你的账户权限。

### API Key 放在哪

- **浏览器版**：Key 只在页面的内存里，刷新后要重新填。不会写进 localStorage、IndexedDB 或项目文件。
- **桌面版**：默认也只在本次运行期间有效。勾选“在本机钥匙串中记住此 Key”后，用 Electron 的 safeStorage 加密保存在本机；钥匙串不可用时不提供这个选项，不会退回明文。
- **后端**：不保存 Key。任务引擎只把 Key 放在内存里，不写进任务文件。

### 付费请求的规则

生成是花钱的，所以这几条在代码里是硬规则：

- 不自动重发可能已经扣费的请求。只有供应商明确表示没有执行（429、503）时才重试。
- 视频任务先保存供应商给的任务号，再开始查询。应用重启后凭任务号继续查，不重新提交。
- 应用在请求中途退出时，这个任务标为“中断”，由你决定要不要重新生成。
- 只有还在排队的任务可以取消。已经发出去的会跑到结束，因为钱已经花了。

## 快速开始

需要 Node.js 22.18 以上和 pnpm 11。

```bash
pnpm install --frozen-lockfile
```

开两个终端，分别启动后端和前端：

```bash
pnpm dev:server
```

```bash
pnpm dev:web
```

打开 http://127.0.0.1:5173 ，点“API 设置”填入供应商的 Key，就可以生成了。后端在 http://127.0.0.1:8000 ，开发时前端会把 `/api` 请求转给它。

### macOS 桌面版

开发时，在上面两个终端之外再开一个：

```bash
pnpm dev:desktop
```

打包成当前 Mac 架构的应用，输出在 `apps/desktop/release/`：

```bash
pnpm build:desktop
```

正式版的数据在 `~/Library/Application Support/FRAMEOUT/`：`storage/` 是项目和素材，`secrets/` 是加密后的 Key，`tasks/` 是生成任务。开发时的数据在 `apps/desktop/.dev-data/`，和正式版互不影响。单个素材最大 100 MiB。浏览器版和桌面版的数据是分开的。

### 构建后运行

```bash
pnpm build
```

```bash
node apps/server/dist/index.cjs
```

后端同时提供前端页面和接口，默认监听 `127.0.0.1:8000`，可以用环境变量 `HOST` 和 `PORT` 修改。部署到服务器的做法见 [deploy/README.md](deploy/README.md)。

## Agent 插件

让 Claude Code 通过帧外自己的接口操作桌面版，而不是点击界面。帧外桌面版要开着，并且打开了一个项目。

```bash
pnpm --filter @frameout/mcp build
```

```bash
claude plugin marketplace add ./
```

```bash
claude plugin install frameout@frameout-local
```

提供 12 个工具：

| 工具 | 用途 |
| --- | --- |
| `list_projects`、`open_project` | 列出项目，打开项目 |
| `get_project` | 读取卡片、连线、文本、成片、音频轨和花费 |
| `view_card`、`check_video` | 看一张卡片的画面；检查视频有没有画面僵住、声音有没有问题 |
| `import_media`、`extract_frame` | 把本机的图片或视频导入画布；从视频里取一帧 |
| `generate_image`、`generate_video`、`wait_card` | 生成图片和视频，等待完成。可以先只报价（`dryRun`），不生成 |
| `edit_project` | 成批修改连线、文本、成片顺序和音频轨。带版本号校验，整批要么全部生效，要么都不改 |
| `export_film` | 导出 MP4 到本机 |

插件还带一个 `frameout-film` skill，写了用这些工具做一条短片的完整流程。

## 代码结构

全 TypeScript 的 pnpm + Turborepo monorepo。

```text
apps/
  web/        Vite + React 前端，画布用 React Flow。代码地图见 apps/web/src/README.md
  server/     Express 后端：前端页面、/api/ai 转发、任务引擎、Agent 通道
  desktop/    Electron 桌面端：窗口、本机存储、钥匙串
  mcp/        给 Claude Code 用的 MCP 服务，构建后放进 plugins/frameout
  api/        FastAPI 骨架，目前只有健康检查
packages/
  shared/     供应商客户端、请求格式、桌面端和页面之间的约定
plugins/
  frameout/   Claude Code 插件：MCP 配置和 frameout-film skill
deploy/       Docker + Caddy 部署文件
```

后端的接口：

| 接口 | 用途 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `POST /api/ai` | 把图片和视频请求转发到 OpenAI、火山方舟的官方地址。不跟随重定向，不自动重试 |
| `/api/tasks` | 任务引擎：提交、查询、取消、事件流。仅桌面版开启 |
| `/api/agent` | Agent 通道。仅桌面版开启，需要应用每次启动时生成的令牌 |

接口只接受来自本站页面的请求。请求体默认上限 16 MiB，图片请求最长等 300 秒，其他请求 90 秒。

## 检查

```bash
pnpm check
```

依次跑格式检查、ESLint（`apps/api` 用 ruff）、类型检查和全部测试，CI 跑的是同一个命令。`apps/api` 的检查需要先装好 [uv](https://docs.astral.sh/uv/)。

## 参与贡献

欢迎 Issue 和 PR。开发环境、检查命令和 PR 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。不知道从哪开始，可以看带 [`good first issue`](https://github.com/happpsee/frameout-studio/labels/good%20first%20issue) 标签的 Issue。

## 许可证

[MIT](LICENSE)。

导出用到 [mediabunny](https://github.com/Vanilagy/mediabunny)（MPL-2.0，未修改）。示例图片和字体的来源与许可见 `apps/web/public/assets/SOURCES.md`。
