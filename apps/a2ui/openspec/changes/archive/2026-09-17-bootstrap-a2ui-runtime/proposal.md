# Proposal

## Why

A2UI playground 已经从零把客户端运行时搭起来：无 React 依赖的 `a2ui-core`（store / parser / vnode / treebuilder / JSON 流缓冲）、`a2ui-react` 目录渲染器，以及 Vite playground 的 mock 预览与分片 stream。仓库此前没有 OpenSpec，后续改协议或加组件时缺少可归档的需求基线。这次把已落地行为写成 change 并归档，让 `openspec/specs/` 成为现状的 source of truth。

## What Changes

- 接入 OpenSpec（`openspec/` + Cursor `/opsx-*` skills）。
- 新增 7 个 capability，描述已经实现的客户端行为，不改运行时代码。
- 归档后主 specs 记录：全局 store、JSONL parser、vnode 映射、树组装、流式缓冲区、React 渲染器、playground 宿主。

## Capabilities

### New Capabilities

- `store`: zustand/vanilla 单例，持有 surface / hydrateNode / error / renderMap / renderTree。
- `parser`: A2UI v0.8 JSONL 四种 server→client 消息解析，并在批次结束时提交组件树。
- `vnode`: 把协议 component 映射成框架无关描述，抽出 render 入参与 childIds。
- `treebuilder`: 从 surface.root 后序 DFS 组装可挂载树，容器通过 renderMap 注入 children。
- `stream-buffer`: 分片 JSON 抽完整对象，补成 JSONL；surfaceUpdate 按组件拆行后交给 parser。
- `react-renderers`: Text / Column / Row 与 renderMap，含入场动画与布局属性。
- `playground`: mock 切换、Preview 挂载、Store 检查、50 字符 / 50ms 模拟 stream。

### Modified Capabilities

- （无）仓库此前没有主 specs。

## Impact

- 文档与 Cursor 工作流：`openspec/`、`.cursor/commands/`、`.cursor/skills/`。
- 不改 `packages/` 或 `web/` 运行时。
- 对话 Agent、Koa server、标准目录其余组件仍不在范围内。
