# 前端代码地图

想看懂帧外怎么工作，先读 `core/`。`shell/` 和 `ui/` 可以先不看。

```
core/                  核心：做片子的主流程
  Studio.tsx           工作台的入口，把下面四块组装在一起
  canvas/              画布：卡片、备注、拖拽、缩放、多选、列表视图
  generation/          生成：输入框和参数、提交和查询结果、镜头计划、失败处理、参考图
  film/                成片：时间线、预览、导出视频和声音
  project/             项目数据：数据结构、保存和读取、版本记录、素材存储
shell/                 外围
  landing/             介绍页和动效
  lobby/               项目列表
  settings/            API 设置、Key 的记忆、模型选项
  misc/                帮助、主题、完成通知、示例导入
  useProjectRoute.ts   什么时候去哪个页面（打开项目、离开介绍页、项目不存在时回列表）
ui/                    通用控件：下拉框、图标、弹窗辅助
styles/                全局样式
App.tsx                三个页面的路由声明（react-router）
types.ts               项目、卡片、任务等数据类型
platform.ts            判断是不是桌面端，读取桌面端接口
```

## 每块从哪个文件读起

| 目录 | 先读 | 它管什么 |
| --- | --- | --- |
| `core/canvas` | `useCanvas.ts` | 画布的状态和所有鼠标、键盘操作 |
| `core/generation` | `useGeneration.ts` | 一次生成从提交到结果放上画布 |
| `core/generation` | `useWorkflow.ts` | 镜头计划：按脚本批量生成 |
| `core/film` | `export-video.ts` | 把时间线上的镜头合成一个 MP4 |
| `core/project` | `project.ts`、`useWorkspace.ts` | 项目的数据结构，以及自动保存和读取 |

调用供应商的代码不在前端，在 `packages/shared/src/ai-client.ts`。
