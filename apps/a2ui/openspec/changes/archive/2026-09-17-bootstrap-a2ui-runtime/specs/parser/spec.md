# Spec Delta

## Purpose

parser 按行消费 A2UI v0.8 JSONL，把四种 server→client 消息写入 store，并在一次 parse 调用结束时提交组件树给宿主。

## ADDED Requirements

### Requirement: JSONL one action per line
`parse` SHALL 按行处理输入。空行 MUST 跳过。每一行合法消息 MUST 恰好包含一种 action：`beginRendering`、`surfaceUpdate`、`dataModelUpdate` 或 `deleteSurface`。

#### Scenario: Mixed mock stream
- **WHEN** 输入是多行 JSONL，每行一个 beginRendering 或 surfaceUpdate
- **THEN** parser 按顺序 dispatch，而不是把整个文件当一个 JSON 数组解析

### Requirement: Parse errors
无法 `JSON.parse` 的行，以及不是恰好一种合法 action 的对象，SHALL 写入 errorMap，类型为 `PARSE_ERROR`，且 MUST 继续处理后续行。

#### Scenario: Invalid line then valid line
- **WHEN** 第一行不是 JSON，第二行是合法 beginRendering
- **THEN** errorMap 出现 PARSE_ERROR，且第二行仍会创建或更新对应 surface

### Requirement: Begin rendering
`beginRendering` SHALL 创建或更新指定 surface，把 `beginRender` 设为 true，并记录 root 组件 id。mock 数据 SHALL 把 beginRendering 放在该 surface 的组件更新之前。

#### Scenario: First message is beginRendering
- **WHEN** 合法 JSONL 的第一条消息是带 surfaceId 与 root 的 beginRendering
- **THEN** store 中该 surface 的 beginRender 为 true，root 为协议给出的组件 id

### Requirement: Surface update hydration
`surfaceUpdate` SHALL 按 component id upsert HydrateNode，写入 ownerSurfaceId、protocol 与 childIds。未在 renderMap 注册的组件类型 SHALL 记 `UNREGISTERED_COMPONENT` 错误。

#### Scenario: Registered Text
- **WHEN** renderMap 已注册 Text，且 surfaceUpdate 包含带 usageHint 的 Text
- **THEN** hydrateNodeMap 出现该 id，且不因「未注册」写入错误

#### Scenario: Unknown catalog type
- **WHEN** surfaceUpdate 包含 renderMap 没有的组件类型
- **THEN** errorMap 出现 UNREGISTERED_COMPONENT，节点仍可按映射结果占位

### Requirement: Leaf versus container render timing
叶子组件（如 Text）在 surfaceUpdate 时 SHALL 立即调用 renderMap，把结果写入 `v_node`，props 至少包含协议字段、`componentId` 与 `hasMounted`。容器（Column / Row）在 surfaceUpdate 时 MUST NOT 用子树调用 renderMap；子树组装留给 treebuilder。

#### Scenario: Column with three texts in one parse
- **WHEN** 一次 parse 包含 Column 及其三个 Text 子节点
- **THEN** 三个 Text 在 surfaceUpdate 阶段已有 v_node，Column 的最终带 children 的 v_node 在 treebuild 之后才完整

### Requirement: Data model update
`dataModelUpdate` SHALL 把条目写入对应 surface 的 `dataModel`。

#### Scenario: Path value arrives
- **WHEN** 某 surface 已存在且收到 dataModelUpdate
- **THEN** 该 surface.dataModel 包含更新后的键值

### Requirement: Parser deleteSurface
处理协议 `deleteSurface` 时，parser SHALL 删除该 surface，并且 MUST 删除 `ownerSurfaceId` 等于该 surface 的全部 HydrateNode。

#### Scenario: Surface and owned nodes removed
- **WHEN** 已有 surface 及其若干 hydrateNode，然后 parse 一条 deleteSurface
- **THEN** surfaceMap 与这些 hydrateNode 都不再存在

### Requirement: Commit tree after parse
每次 `parse()` 在处理完全部行后 SHALL 调用 treebuild，若 store 中有 `renderTree` 则 MUST 传入组装结果。`parse` SHALL 把该组件树返回给调用方。

#### Scenario: SDK notifies the host
- **WHEN** init 时提供了 renderTree，随后 parse 一段完整 JSONL
- **THEN** renderTree 被调用一次（本批次结束时），返回值即为当前可挂载树
