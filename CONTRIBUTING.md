# 参与贡献

欢迎提 Issue 和 PR。帧外还很年轻，代码量不大、结构清楚，适合第一次参与开源。

## 从哪里开始

- 带 [`good first issue`](https://github.com/happpsee/frameout-studio/labels/good%20first%20issue) 标签的 Issue 范围小、说明全，适合上手。
- 想做较大的改动（新供应商、新面板、架构调整），请先开 Issue 说明想法，避免做完了方向不合适。
- 前端代码地图在 `apps/web/src/README.md`，从 `core/` 读起。

## 本地开发

需要 Node.js 22.18+、pnpm 11 和 [uv](https://docs.astral.sh/uv/)。

```bash
pnpm install --frozen-lockfile
pnpm dev:server   # 终端 1，后端 http://127.0.0.1:8000
pnpm dev:web      # 终端 2，前端 http://127.0.0.1:5173
```

桌面端、FastAPI 等其他启动方式见 [README](README.md)。开发和测试不需要真实 API Key：测试使用模拟的供应商响应。

## 提交前

```bash
pnpm check
```

它依次跑格式检查、ESLint / ruff、类型检查和全部测试，CI 跑的是同一个命令，必须通过。

- 格式问题用 `pnpm format` 修，Python 用 `pnpm --filter @frameout/api format`。
- lint 报错信息里写了该怎么改，照做；不要用注释关掉规则，确实需要豁免时写明理由（`-- 理由`）。
- 新代码里，单个文件不超过 400 行、单个函数不超过 150 行。`eslint.config.mjs` 里的 `OVERSIZED_FILES` / `OVERSIZED_FUNCTIONS` 是待拆分的存量，只能删不能加。
- 改了行为就补测试；修 bug 先写一个能复现的测试。

## PR 约定

- 一个 PR 只做一件事，标题说清楚改了什么（中英文都可以）。
- 界面改动请附截图或录屏。
- 涉及付费请求（生成、重试、任务查询）的改动，说明会不会导致重复提交或重复扣费。
- API Key 不能写进日志、localStorage、项目文件或测试快照。

## 引入第三方代码

可以借鉴其他项目的设计和做法，但**不要复制它们的代码**，尤其是 GPL / AGPL 或“源码可见”许可的项目，否则会和本项目的 MIT 许可冲突。引入第三方代码或素材时，在 PR 里写明来源和许可证。

## 许可

提交 PR 即表示你同意你的贡献按本项目的 [MIT 许可证](LICENSE) 发布。
