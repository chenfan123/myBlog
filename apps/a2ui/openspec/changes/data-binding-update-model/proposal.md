# Proposal

## Why

协议里的 BoundValue 与 `dataModelUpdate` 已经进 store，但渲染仍用 parse 时冻住的 literal，表单也不写回模型，Button 派的是非协议事件。要在 playground 里真正生成可交互页面，需要 SDK 级 `updateModel`、渲染时解析 path，以及协议 `userAction`。

## What Changes

- 抽出 `a2ui-core` datamodel 模块：path 读写、`applyDataModelUpdate`、`resolveBound` / `resolveRenderProps`、`updateModel`、`dispatchUserAction`。
- `surfaceUpdate` 在 path+literal 同时出现时隐式写入 dataModel（不覆盖已有值）。
- treebuild 对叶子也重 render，用当前 dataModel 解析 `*Path`，并传入 `surfaceId`。
- `init({ onUserAction })`；Button 发出解析后的 `userAction`；`__localUpdatePath` 先本地写模型。
- React 表单受控写回 `updateModel`；playground 增加登录绑定 mock，并展示最近一次 userAction。

## Capabilities

### New Capabilities

- `datamodel`: BoundValue 解析、dataModel 路径读写、SDK `updateModel`、协议 `userAction`（含 `__localUpdatePath`）。

### Modified Capabilities

- `parser`: surfaceUpdate 隐式初始化；dataModelUpdate 支持深层路径与无 leading slash。
- `store`: `init` 增加 `onUserAction`。
- `treebuilder`: 叶子也按当前 dataModel 重 render；props 含 `surfaceId`。
- `react-renderers`: 表单写回模型；Button 走 `dispatchUserAction`。
- `playground`: 登录绑定 mock；展示最近一次 userAction JSON。

## Impact

- 代码：`packages/a2ui-core/src/datamodel/`、parser、treebuilder、store、`packages/a2ui-react` 控件、`web/a2ui-playground`。
- API：新增 `updateModel`、`dispatchUserAction`、`init({ onUserAction })`；render props 增加 `surfaceId` 与 `*Path`。
- 测试：`test/datamodel` 与现有 parser / treebuilder 回归。
- Non-goals：`children.template` 动态列表、weight / catalog 主题 styles、真正把 userAction 发到 Agent / Koa。
