# Spec Delta

## ADDED Requirements

### Requirement: Path read and write
datamodel SHALL 把协议 path 拆成段，`/user/name` 与 `user/name` MUST 等价。`getValue` SHALL 沿 path 读取；`setValue` SHALL 不可变地写入普通 JSON，并补齐缺失的中间对象。空 path 或 `/` 表示整棵模型。

#### Scenario: Slash optional
- **WHEN** 向 `/user/name` 写入 "Ada"
- **THEN** `getValue(model, "user/name")` 返回 "Ada"

### Requirement: Apply dataModelUpdate
`applyDataModelUpdate` SHALL 把 adjacency list `contents` 转成对象。path 省略或 `/` 时 MUST 整棵替换；否则 MUST 把 contents 挂到该路径节点。MUST 支持无 leading slash 的深层 path。

#### Scenario: Nested path without slash
- **WHEN** 当前模型为 `{ user: { name: "Ada" } }`，更新 path 为 `user`，contents 含 name 与 role
- **THEN** 结果为 `{ user: { name: "Grace", role: "admin" } }` 这类按 contents 替换该节点的对象

### Requirement: Resolve BoundValue
有 path 时 SHALL 从 dataModel 取值；模型没有该键则 MUST 回退已有 literal。`resolveRenderProps` SHALL 把 JSON 描述里的 `fooPath` 解析进 `foo`（含 Tabs `tabItems[].titlePath`）。

#### Scenario: Path then model update
- **WHEN** Text 绑定 `/headline` 且随后 dataModelUpdate 写入 headline
- **THEN** 组装树中的 text 为模型新值

### Requirement: SDK updateModel
`updateModel(surfaceId, path, value)` SHALL 把普通 JSON 写进该 surface 的 dataModel，然后 MUST 调用 `commitTree()`。它 MUST NOT 作为第四种 JSONL 消息出现。

#### Scenario: Form writes a path
- **WHEN** 调用 `updateModel("bound", "/headline", "From SDK")`
- **THEN** `surface.dataModel.headline` 为 "From SDK"，且 `buildTree()` 中对应 Text 为该值

### Requirement: dispatchUserAction
`dispatchUserAction` SHALL 解析 action.context 的 BoundValue，组成 `{ name, surfaceId, sourceComponentId, timestamp, context }`。若 context 含 `__localUpdatePath` 以及 `__localUpdateString` / `__localUpdateNumber` / `__localUpdateBoolean` 之一，MUST 先 `updateModel` 再发出 action，且发出的 context MUST NOT 包含 `__localUpdate*` 键。有 `init({ onUserAction })` 时 SHALL 调用该回调；否则在浏览器环境 MUST 派 `a2ui-user-action` CustomEvent。

#### Scenario: Context path resolves
- **WHEN** 模型 email 为 demo@a2ui.dev，userAction context 含 `{ key: "email", value: { path: "/email" } }`
- **THEN** 回调收到的 context.email 为 demo@a2ui.dev
