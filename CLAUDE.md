# 帧外 FRAMEOUT

## 改完代码必须跑 `pnpm check`

`pnpm check` 依次跑格式检查、ESLint（TS 包）和 ruff（`apps/api`）、类型检查、全部测试，必须通过才算完成。格式问题用 `pnpm format` 修，Python 用 `pnpm --filter @frameout/api format`。

- lint 规则在 `eslint.config.mjs`，报错信息写了该怎么改，照做，不要用注释关掉规则；确实需要豁免时写明理由（`-- 理由`）。
- `OVERSIZED_FILES` / `OVERSIZED_FUNCTIONS` 是还没拆分的存量，只许删、不许加：新代码超过 400 行的文件或 150 行的函数要拆开。
