# 帧外 FRAMEOUT

[![check](https://github.com/happpsee/frameout-studio/actions/workflows/check.yml/badge.svg)](https://github.com/happpsee/frameout-studio/actions/workflows/check.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE) [![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

> An open-source, local-first AI video canvas: generate images and video shots with your own API keys, arrange them on an infinite canvas, and export the film as MP4. TypeScript monorepo (React + Express + Electron). Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

全 TypeScript 的 pnpm + Turborepo monorepo：Vite + React 前端、Express 后端、Electron 桌面端，以及前后端与桌面端共用的 `@frameout/shared`。原来的原生页面和 Worker 已迁移，首页、画布、素材卡片、镜头序列、预览和 API 设置均由 React 组件渲染。

## macOS 桌面版

首次启动展示产品介绍，之后启动直接恢复工作台；可从使用指南再次查看介绍。桌面工作台采用 56px 顶栏、左侧工具栏、中央画布和右侧生成面板。素材、镜头计划与版本记录按需打开，空镜头序列默认收起。

双击「帧外.app」直接打开工作台。应用自带前端和本机 Node 服务（由 Electron 的 utilityProcess 运行）。画布、镜头顺序、模型偏好和素材自动保存在 `~/Library/Application Support/FRAMEOUT/storage/`。可从菜单栏「帧外 → 打开数据文件夹」找到它。应用退出时会等待正在保存的项目。单个素材最多保存 100 MiB。供应商链接允许下载时，生成的文件也会存到本机。API Key 默认只在本次运行期间有效；在 API 设置中勾选「在本机钥匙串中记住此 Key」后，Key 经 Electron safeStorage 加密（macOS 由钥匙串保管加密密钥）保存在 `~/Library/Application Support/FRAMEOUT/secrets/`，取消勾选或点「清除所有密钥」即删除。钥匙串不可用时不提供此选项，也不会明文保存。

浏览器版和桌面版使用各自的数据目录。已有浏览器素材可先下载，再导入桌面版。桌面版当前维护一份自动保存的工作区。

开发和打包前先完成下节的依赖安装。开发桌面版用 `pnpm dev:desktop`（见下节）；`pnpm desktop` 先完整构建，再以接近正式版的方式运行。运行以下命令生成与当前 Mac 架构对应的本地应用，输出在 `apps/desktop/release/`。

```bash
pnpm build:desktop
```

## 本地启动

需要 Node.js 22.18+（可直接运行 `.ts` 文件）、pnpm 11（版本见 `package.json` 的 `packageManager`），以及 [uv](https://docs.astral.sh/uv/)（管理 `apps/api` 的 Python 3.12 环境和依赖）。在项目根目录运行：

```bash
pnpm install --frozen-lockfile
```

在两个终端中分别启动后端和前端：

```bash
pnpm dev:server
pnpm dev:web
```

前端：http://127.0.0.1:5173 ；后端：http://127.0.0.1:8000 。开发时 Vite 将 `/api` 代理到后端；`dev:server` 用 `node --watch` 直接运行 TypeScript 源码，修改后自动重启。

开发桌面版时，在上面两个终端之外再运行：

```bash
pnpm dev:desktop
```

Electron 窗口直接加载 `dev:web` 的页面，改页面代码会热更新；改 `apps/desktop/src` 下的主进程或 preload 会自动重新打包并重启 Electron。`/api` 请求经 Vite 代理到 `dev:server`。开发时数据存放在 `apps/desktop/.dev-data/`，不碰正式版的项目；可用环境变量 `FRAMEOUT_USER_DATA_DIR` 改到别处，`FRAMEOUT_DEV_URL` 可指定其他页面地址。

FastAPI 后端（`apps/api`）目前只有健康检查，账号、项目等接口从第 3 期起加入。需要时另开一个终端运行 `pnpm dev:api`，地址 http://127.0.0.1:8001 ，接口文档在 `/docs`。首次运行时 uv 会按 `apps/api/uv.lock` 自动创建虚拟环境。

## 构建后运行

```bash
pnpm build
node apps/server/dist/index.cjs
```

`pnpm build` 由 Turborepo 按依赖顺序构建各包并缓存结果：前端在 `apps/web/dist/`，后端用 esbuild 打成单文件 `apps/server/dist/index.cjs`（已内含 Express，运行时不需要 node_modules）。后端同时提供前端静态文件和 API，可用 `HOST`、`PORT` 环境变量改监听地址（默认 127.0.0.1:8000），访问 http://127.0.0.1:8000 即可。此项目目前按单机本地使用设计，未新增账号、多人协作或云端项目存储。

## 目录

```text
apps/
  web/                 @frameout/web：Vite + React 前端
    src/components/    首页、画布、镜头序列、预览、API 设置和下拉控件
    src/hooks/         项目状态、生成流程、画布手势和首页动效
    src/lib/           相机计算、供应商协议、项目序列化、IndexedDB
    src/styles/        原视觉样式与 React 控件适配
    public/assets/     原有图片、字体、图标和来源说明
    vite.config.ts     React、开发代理和 Vitest 配置
  server/              @frameout/server：Express 后端
    src/app.ts         路由、Host/CORS 中间件、静态文件
    src/relay.ts       AI 请求校验、转发、超时和断连处理
    src/config.ts      Origin、大小与时限配置
    src/index.ts       Web 版入口（HOST/PORT）
    scripts/build.ts   esbuild 打包成单文件
  desktop/             @frameout/desktop：Electron 桌面端
    src/main.ts        窗口、IPC、退出保存
    src/preload.ts     向页面暴露 window.frameoutDesktop
    src/server-process.ts  在 utilityProcess 中运行后端，监听本机随机端口
    src/storage.ts / secrets.ts  本地文件读写与钥匙串加密的 Key
    scripts/build.ts   esbuild 打包 main、preload 和服务进程
    scripts/package.ts 打包 macOS 应用
  api/                 @frameout/api：FastAPI 后端，只供 BFF 在内网调用
    src/frameout_api/  应用代码
    tests/             pytest 测试
    scripts/export_openapi.py  导出接口契约到 dist/openapi.json，供 BFF 生成 TS 类型
packages/
  shared/              @frameout/shared：串行队列、DesktopBridge 与 IPC 通道、/api/ai 请求格式与官方地址
turbo.json             构建、类型检查、测试任务及缓存
pnpm-workspace.yaml    工作区与统一依赖版本（catalog）
```

`@frameout/shared` 直接导出 TypeScript 源码，由 Vite、esbuild 和 Vitest 在使用处编译，不需要单独构建。

## 保留的功能

- 首页保留滚动和鼠标动效，适配减少动态偏好。画布从空项目开始，支持上传或生成素材。
- 无限画布平移、以鼠标为锚点缩放、双指缩放转单指平移、素材拖动与选择、拖动取消、适应全部素材、15%～400% 缩放输入。
- 上传本地图片与视频，撤销、重做、删除素材。
- 镜头加入成片、拖动排序、前后移动、每镜 1～15 秒、连续预览与进度定位。
- 图片生成、文生视频、以图片为首帧的视频任务、停止本页等待与继续查询已有任务。
- 浏览器本地保存、刷新恢复、项目 JSON 导出。上传素材与生成的文件结果保存到 IndexedDB；存储失败时明确提示仅本次可用。

返回首页再进入画布会保留本页密钥、提示词和撤销记录，并停止当前等待。刷新后不恢复密钥或历史栈。项目 JSON 只包含项目结构与媒体引用，不包含素材文件或 API Key。更换浏览器或清除浏览器数据后，本地媒体引用将无法读取。原站点与本地地址的浏览器存储彼此独立，不会自动迁移旧站点素材。

成片区提供顺序预览，并可用顶栏「导出成片」把整条序列在本机编码为 MP4（H.264，30 帧，16:9 / 9:16 / 1:1，720p / 1080p）。导出画面与预览一致：同样的裁切、色调和镜头时长，视频镜头从首帧播放、不足时停在末帧。与预览一样暂不包含声音。编码使用 WebCodecs 和 [mediabunny](https://github.com/Vanilagy/mediabunny)（MPL-2.0，未修改），需要最新版 Chrome、Edge 或桌面版；WebCodecs 无法解码的视频会改用浏览器播放器逐帧读取。供应商临时链接若不允许跨域读取，需先下载素材再导入。

## 生成接口

### 镜头计划与版本记录

画布右上角的「镜头计划」支持每行输入一个镜头，预览图片生成步骤，也可选择在图片完成后继续生成视频。检查计划后点击开始，会先保存一个版本，再按依赖顺序执行，最多编排 8 个镜头。计划使用创建时的模型参数和当前填写的密钥。

暂停保留完成的素材和已取得的视频任务号，继续时查询原任务。没有取得结果的图片请求或没有任务号的视频请求，需要先核对供应商记录，再手动确认是否重新生成。刷新或重启后计划恢复为暂停状态，执行记录和已完成步骤随项目保存。

「版本记录」保留最近 8 个画布与镜头编排快照，显示新增、移除和修改的素材数量。恢复前自动备份当前状态，并暂停计划。快照复用已保存的媒体引用，密钥不进入计划、快照或导出的项目文件。浏览器清除本地素材后，快照中的媒体引用也会失效。

### 镜头一致性

输入框上方的「一致性」用于让同一角色、服装和画风贯穿各个镜头，对之后的单次生成和镜头计划都生效，并随项目保存。

- 统一设定：一段文字（最多 1000 字），附加在每次图片与视频生成的提示词末尾。
- 参考图：在画布上选中图片，点「设为参考」，最多 4 张，画布上以「参考」标记。生成图片时，参考图缩到最长边 1536 像素、转为 JPEG 后随请求发送。火山方舟放在 `/images/generations` 的 `image` 字段（Seedream 5.0 pro/flash 最多 10 张，其他最多 14 张）；OpenAI 改走 JSON 形式的 `/images/edits`（`images` 数组），`gpt-image-1.5` 另加 `input_fidelity: high` 以保留面部特征。自定义兼容服务只附加统一设定。生成视频时以所选图片为首帧，不另传参考图。

点击画布右上角「API 设置」配置自己的供应商。OpenAI 配置提供图片生成；火山方舟提供图片与异步视频协议；自定义兼容服务使用浏览器直连，需要供应商支持相应接口与跨域。模型名可以修改，实际可用模型与参数取决于账户权限。

后端提供：

| 接口 | 用途 |
| --- | --- |
| `GET /api/health` | 服务健康检查 |
| `POST /api/ai` | 按指定供应商协议转发图片（含 OpenAI 参考图编辑 `/images/edits`）、任务提交与查询 |

`/api/ai` 沿用 `{ provider, baseUrl, apiKey, path, method, body? }` 请求格式。后端仅向 OpenAI 和火山方舟的官方地址及允许路径转发；不跟随重定向，不自动重试付费请求。默认请求上限 16 MiB、图片请求总时限 300 秒、其他请求 90 秒。

浏览器版的 Key 仅保留在页面内存并用于当次请求，不写入 localStorage、IndexedDB、项目 JSON 或后端文件，刷新后补填 Key。桌面版仅在用户勾选后加密保存到本机（见上文）。未配置 Key 时点生成会直接打开 API 设置并保留提示词，设置里提供 OpenAI 与火山方舟控制台的获取入口。后端不会记录请求正文或转发浏览器 Cookie、站点身份头。密钥清除和连接测试取消均有回归测试。

视频停止等待后保留已取得的任务号；刷新后需补填相同供应商的 Key，再继续查询原任务。未取得任务号时提示先到供应商后台核对，不自动再次提交。停止本地等待不等于取消供应商任务，已经提交的请求仍可能计费。供应商返回的临时媒体链接可能失效，请及时下载。

接口只接受来自本站页面的请求，前端和后端要部署在同一个地址下。`FRAMEOUT_FRONTEND_DIST` 可指定其他前端构建目录。配置示例见 `apps/server/.env.example`，应用不会自动加载 `.env`，请使用 shell 环境变量。

## 验证

```bash
pnpm check
```

`pnpm check` 依次跑格式检查（Prettier）、代码检查（TS 包用 ESLint，`apps/api` 用 ruff）、类型检查和全部测试，改完代码后必须通过。各项也可单独运行：`pnpm format:check`、`pnpm lint`、`pnpm typecheck`、`pnpm test`；Turborepo 对未改动的包直接使用缓存结果。

前端测试覆盖相机计算、手势取消与提交、双指转单指、历史操作、镜头排序与时长、浏览器媒体恢复、生成停止及续查、配置密钥隔离、下拉框键盘导航。后端测试覆盖协议校验、大小限制、错误脱敏、超时、断连取消、Cookie 隔离、Host 校验和静态文件（含软链接与路径穿越）。

迁移验收使用模拟供应商响应。未使用真实 API Key 发起付费出图或出片，未实测大规模素材性能和真实触屏多指手感。浏览器人工检查了首页进入、供应商切换、加入镜头、预览、缩放输入及 390px 画布布局。

参考：[Vite 官方文档](https://vite.dev/guide/)、[React 官方文档](https://react.dev/learn/creating-a-react-app)、[Electron utilityProcess](https://www.electronjs.org/docs/latest/api/utility-process)、[OpenAI 图片接口](https://developers.openai.com/api/reference/resources/images/methods/generate)。素材来源说明保留在 `apps/web/public/assets/`。

## 公网部署

服务器部署文件和 HTTPS 配置见 [部署说明](deploy/README.md)。可用于国内云厂商的香港节点，或满足备案要求的大陆节点；需填入实际域名后部署。

## 参与贡献

欢迎 Issue 和 PR，开发环境、检查命令和 PR 约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。不知道从哪开始，可以看带 `good first issue` 标签的 Issue。

## 许可证

[MIT](LICENSE)。第三方素材和依赖的许可见 `apps/web/public/assets/SOURCES.md` 与各自的包。
