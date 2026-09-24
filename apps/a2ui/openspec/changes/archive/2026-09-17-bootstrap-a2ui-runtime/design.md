# Design

## Context

客户端按 README 的 monorepo 切分落地：`a2ui-core` 解析协议并持有状态，`a2ui-react` 只提供目录实现，playground 用 Vite 把两者接到浏览器。协议是 A2UI v0.8 JSONL，不是单个 pretty JSON 文档。store 初稿写过 `_vnode` / ReactElement，实现时改成框架无关的 `v_node`，避免 core 依赖 React。

## Goals / Non-Goals

**Goals:**

- 一份可归档的现状规格，覆盖已经能跑的 mock → parse → tree → React 预览路径。
- 明确 SDK 与宿主的边界：`init({ renderMap, renderTree })`，parse 结束后由 SDK 决定何时挂树。
- 明确流式路径：缓冲区凑齐一个对象 → `toProtocolJsonl` → 逐行 `parse`。

**Non-Goals:**

- 不实现 playground 对话 Agent、多轮改 UI、Koa / OpenAI server。
- 不实现标准目录里除 Text / Column / Row 以外的组件。
- 不把 playground 的 CSS（例如 Row 灰底）写成协议需求。
- 本次不改运行时代码。

## Decisions

1. **core 无 React。** store 用 `zustand/vanilla` 全局单例；`v_node` 类型为 `VNode`（unknown）。React 元素只出现在 `a2ui-react` 与 playground。备选是把 React 放进 core，会让非 React 宿主无法用 parser。

2. **`init({ renderMap, renderTree })`。** `renderMap` 画单个组件；`renderTree` 由宿主提供、SDK 在 `parse()` 末尾 `commitTree()` 时调用。备选是 playground 每次 `buildTree()` 再 `createRoot`，会在 stream 下重复卸载预览根。

3. **叶子立即 render，容器推迟到 treebuild。** Text 等叶子在 `surfaceUpdate` 时调用 `renderMap`；Column / Row 只登记 hydrateNode 与 `childIds`，后序组装后再 `render({ ...props, children })`。不用 `cloneElement`，避免 core 绑定 React。

4. **`Surface.root` 是 id，`rootNode` 是 HydrateNode。** `beginRendering.root` 指向根组件 id；treebuild 成功后把组装结果写到 `rootNode`。

5. **`hasMounted` 标记清除。** 新 componentId 为 `false`，已存在节点更新时保持原值；React 入场动画结束后 `markHydrateNodeMounted`。

6. **store.deleteSurface 只删 surface。** 协议 `deleteSurface` 由 parser 同时清掉该 surface 拥有的 hydrateNode。store API 保持小而可组合。

7. **流缓冲按花括号匹配抽对象。** 分片可能切断 pretty JSON 或数组。抽出完整 `{...}` 后 `JSON.parse` 成对象（不要把 pretty 原文当 JSONL 再按行 split），再 `toProtocolJsonl`。`surfaceUpdate.components` 按组件拆成独立 JSONL，与 `nested-column.json` 单组件一行一致。

8. **测试套件隔离。** parser / treebuilder / buffer 使用独立 `.mocharc.*.json`，避免和 `initStore` 用例抢同一份单例。

9. **Playground 用 antd Select / Modal。** mock 选项中文展示；Store 对话框展示当前渲染组件总数；模拟 stream 对 `JSON.stringify(nestedColumnMock, null, 2)` 按 50 字符 / 50ms 推入 `A2UIStreamBuffer`。

## Risks / Trade-offs

- 全局单例 store 让测试必须 `resetA2UIStore`；隔离 Mocha 配置降低串扰，但不能完全避免漏 reset。
- 流缓冲把 `[` `]` `,` 当噪声丢掉，适合 mock JSON 数组，不适合把这些字符当 payload 的非 A2UI 流。
- 容器缺子节点时跳过该 child，方便增量 stream，但一时不完整的布局会先画出来。
- OpenSpec 规格是事后补录，个别措辞可能比代码略抽象；以测试与实现为准，后续用 `/opsx-propose` 改需求。
