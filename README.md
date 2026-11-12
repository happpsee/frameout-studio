# 帧外 FRAMEOUT

Vite + React + TypeScript 前端，FastAPI + HTTPX 后端。原来的原生页面和 Worker 已迁移，首页、画布、素材卡片、镜头序列、预览和 API 设置均由 React 组件渲染。

## macOS 桌面版

首次启动展示产品介绍，之后启动直接恢复工作台；可从使用指南再次查看介绍。桌面工作台采用 56px 顶栏、左侧工具栏、中央画布和右侧生成面板。素材、镜头计划与版本记录按需打开，空镜头序列默认收起。

双击「帧外.app」直接打开工作台。应用自带前端和 FastAPI 服务。画布、镜头顺序、模型偏好和素材自动保存在 `~/Library/Application Support/FRAMEOUT/storage/`。可从菜单栏「帧外 → 打开数据文件夹」找到它。应用退出时会等待正在保存的项目。单个素材最多保存 100 MiB。供应商链接允许下载时，生成的文件也会存到本机。API Key 默认只在本次运行期间有效；在 API 设置中勾选「在本机钥匙串中记住此 Key」后，Key 经 Electron safeStorage 加密（macOS 由钥匙串保管加密密钥）保存在 `~/Library/Application Support/FRAMEOUT/secrets/`，取消勾选或点「清除所有密钥」即删除。钥匙串不可用时不提供此选项，也不会明文保存。

浏览器版和桌面版使用各自的数据目录。已有浏览器素材可先下载，再导入桌面版。桌面版当前维护一份自动保存的工作区。

开发和打包前先完成下节的 Node.js、Python 依赖安装。`npm run desktop` 构建并运行桌面版源码。打包使用 Homebrew 的 Python 3.12，运行以下命令生成与当前 Mac 架构对应的本地应用，输出在 `dist/desktop/`。

```bash
"$(brew --prefix python@3.12)/bin/python3.12" -m venv backend/.desktop-venv
backend/.desktop-venv/bin/python -m pip install -r backend/requirements.lock pyinstaller==6.22.3
npm run build:desktop
```

## 本地启动

需要 Node.js 22.12+、Python 3.10+。在项目根目录运行：

```bash
npm ci
python3 -m venv backend/.venv
backend/.venv/bin/python -m pip install -r backend/requirements.lock
npm run dev
```

前端：http://127.0.0.1:5173 ；后端：http://127.0.0.1:8000 ；API 文档：http://127.0.0.1:8000/docs 。`Ctrl+C` 会停止前后端。`npm run dev:frontend` 和 `npm run dev:backend` 可分别启动，开发时 Vite 将 `/api` 代理到 FastAPI。

Windows 创建虚拟环境后，将上面的 Python 路径换成 `backend/.venv/Scripts/python.exe`。统一启动脚本会自动选择系统对应路径。

## 构建后运行

```bash
npm run build
backend/.venv/bin/python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000
```

构建产物在 `frontend/dist/`。FastAPI 同时提供前端静态文件和 API，访问 http://127.0.0.1:8000 即可。此项目目前按单机本地使用设计，未新增账号、多人协作或云端项目存储。

## 目录

```text
frontend/
  src/
    components/      首页、画布、镜头序列、预览、API 设置和下拉控件
    hooks/           项目状态、生成流程、画布手势和首页动效
    lib/             相机计算、供应商协议、项目序列化、IndexedDB
    styles/          原视觉样式与 React 控件适配
    types.ts         项目、素材、镜头与视频任务类型
  public/assets/     原有图片、字体、图标和来源说明
  vite.config.ts     React、开发代理和 Vitest 配置
backend/
  app/main.py        应用生命周期、路由、静态文件
  app/relay.py       AI 请求校验、转发、超时和断连处理
  app/config.py      Origin、大小与时限配置
  tests/            后端回归测试
  requirements.lock 本轮验证使用的精确 Python 依赖版本
scripts/dev.mjs      同时启动 Vite 与 FastAPI
electron/           桌面窗口、退出保存和本地文件读写
backend/desktop.py  桌面版专用的本机 FastAPI 入口
scripts/build-desktop.mjs  打包 macOS 应用
```

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

点击画布右上角「API 设置」配置自己的供应商。OpenAI 配置提供图片生成；火山方舟提供图片与异步视频协议；自定义兼容服务使用浏览器直连，需要供应商支持相应接口与跨域。模型名可以修改，实际可用模型与参数取决于账户权限。

FastAPI 提供：

| 接口 | 用途 |
| --- | --- |
| `GET /api/health` | 服务健康检查 |
| `POST /api/ai` | 按指定供应商协议转发图片、任务提交与查询 |

`/api/ai` 沿用 `{ provider, baseUrl, apiKey, path, method, body? }` 请求格式。后端仅向 OpenAI 和火山方舟的官方地址及允许路径转发；不跟随重定向，不自动重试付费请求。默认请求上限 16 MiB、响应上限 32 MiB、图片请求总时限 300 秒、其他请求 90 秒。

浏览器版的 Key 仅保留在页面内存并用于当次请求，不写入 localStorage、IndexedDB、项目 JSON 或后端文件，刷新后补填 Key。桌面版仅在用户勾选后加密保存到本机（见上文）。未配置 Key 时点生成会直接打开 API 设置并保留提示词，设置里提供 OpenAI 与火山方舟控制台的获取入口。后端不会记录请求正文或转发浏览器 Cookie、站点身份头。密钥清除和连接测试取消均有回归测试。

视频停止等待后保留已取得的任务号；刷新后需补填相同供应商的 Key，再继续查询原任务。未取得任务号时提示先到供应商后台核对，不自动再次提交。停止本地等待不等于取消供应商任务，已经提交的请求仍可能计费。供应商返回的临时媒体链接可能失效，请及时下载。

默认允许 localhost / 127.0.0.1 的 5173 和 8000 端口来源。需要不同前端地址时，用环境变量 `FRAMEOUT_ALLOWED_ORIGINS` 添加以逗号分隔的准确 Origin。`FRAMEOUT_FRONTEND_DIST` 可指定其他前端构建目录。配置示例见 `backend/.env.example`，应用不会自动加载 `.env`，请使用 shell 环境变量。

## 验证

```bash
npm test
npm run build
npm run test:backend
npm run test:desktop
```

`npm run test:all` 依次运行前端、桌面存储和后端测试。`npm run bench` 用 200 个素材、8 个版本和 160 条计划记录的项目测量编辑、自动保存和画布渲染耗时，不包含在 `npm test` 中。

前端测试覆盖相机计算、手势取消与提交、双指转单指、历史操作、镜头排序与时长、浏览器媒体恢复、生成停止及续查、配置密钥隔离、下拉框键盘导航。后端测试覆盖协议校验、大小限制、错误脱敏、超时、断连取消、Cookie 隔离和静态文件。

迁移验收使用模拟供应商响应。未使用真实 API Key 发起付费出图或出片，未实测大规模素材性能和真实触屏多指手感。浏览器人工检查了首页进入、供应商切换、加入镜头、预览、缩放输入及 390px 画布布局。

## 迁移说明

本次只修改桌面项目，保留 Git 历史和原目录备份；没有提交、推送或替换线上 Sites 版本。FastAPI 是独立 Python 服务，旧 Worker 的发布脚本和托管清单已移除。

参考：[Vite 官方文档](https://vite.dev/guide/)、[React 官方文档](https://react.dev/learn/creating-a-react-app)、[FastAPI 异步测试](https://fastapi.tiangolo.com/advanced/async-tests/)、[OpenAI 图片接口](https://developers.openai.com/api/reference/resources/images/methods/generate)。素材来源说明保留在 `frontend/public/assets/`。

## 公网部署

服务器部署文件和 HTTPS 配置见 [部署说明](deploy/README.md)。可用于国内云厂商的香港节点，或满足备案要求的大陆节点；需填入实际域名后部署。
