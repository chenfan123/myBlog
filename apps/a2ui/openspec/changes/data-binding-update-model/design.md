# Design

## Context

parser 已把 `dataModelUpdate` 写成 `Surface.dataModel`，vnode 把 BoundValue 展成 `text` / `textPath`。但 `assembleNode` 对叶子直接返回 parse 时的 `v_node`，后续模型更新不会刷新 Text。React 控件用 `useState` 初始化后不再跟模型；Button 只派 `a2ui-action`。

## Goals / Non-Goals

**Goals:**

- 只读绑定：仅 literal 静态；仅 path 从 dataModel 取值；两者都有则先写 literal 再绑 path。
- SDK `updateModel(surfaceId, path, value)` 写普通 JSON 后 `commitTree()`。
- `userAction` 解析 context BoundValue 后回调；`__localUpdatePath` + typed 值先改模型。
- React 表单受控写回；playground 能演示绑定与 userAction。

**Non-Goals:**

- `children.template` 列表克隆。
- `weight` / catalog 主题 styles。
- Agent / Koa 真正接收 userAction（playground 只本地展示）。

## Decisions

1. **独立 datamodel 模块。** path 读写、`applyDataModelUpdate`、BoundValue 解析、`updateModel` / `dispatchUserAction` 放在 `packages/a2ui-core/src/datamodel/`。parser 不再内联 adjacency-list 写入。`/user/name` 与 `user/name` 等价。

2. **`commitTree` 放在 treebuilder。** `updateModel` 需要组装树但不能从 parser 反向依赖。parser 的 `parse()` 末尾仍调用同一 `commitTree()`。

3. **叶子也走 renderMap。** parse 阶段叶子仍可占位 render（流式第一帧）；`commitTree` 用当前 dataModel 解析 `*Path` 后重 render，结果写回 `hydrateNode.v_node`。`dataModelUpdate` 与 `updateModel` 都走这条路径。

4. **path+literal 只写一次。** `applyBoundInitializers` 在模型该 path 已有值时不覆盖，避免后续 `dataModelUpdate` 被重复 `surfaceUpdate` 冲掉。

5. **`updateModel` 不是第四种 JSONL 消息。** 它是 SDK API，对应协议本地模型更新，也给表单 onChange 用。

6. **`onUserAction` 优先于 CustomEvent。** 有回调则只回调；否则在浏览器派 `a2ui-user-action`，并兼容旧名 `a2ui-action`。`__localUpdate*` 键从发出的 context 中去掉。

7. **React 有 path 则受控。** 存在 `surfaceId` 与对应 `*Path` 时 `onChange` 调用 `updateModel`。无 path 的目录示例仍可用本地 state，避免标准目录表单完全冻住。

## Risks / Trade-offs

- 每次 `commitTree` 会重 render 整棵已 beginRendering 的树；mock 规模小，可接受。
- 根级 `dataModelUpdate`（省略 path）整棵替换，可能清掉隐式 literal；渲染时 path 缺省仍回退 mapped literal。
- 全局单例 + `onUserAction` 闭包：playground 每次切 mock 都要随 `resetA2UIStore` 重新注入回调。
