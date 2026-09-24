# Spec Delta

## Purpose

vnode 层把 A2UI 单 key 组件对象映射成框架无关描述，抽出 renderMap 入参和 children.explicitList，供 parser 与 treebuilder 使用。

## ADDED Requirements

### Requirement: Single-key component mapping
映射函数 SHALL 只接受恰好一个组件类型 key 的对象。Text、Column、Row SHALL 能映射成功；类型数量不是 1 时 MUST 返回失败（null）。

#### Scenario: Text literal
- **WHEN** 组件为 `{ Text: { text: { literalString: "Hello, A2UI" }, usageHint: "h1" } }`
- **THEN** 映射结果类型为 Text，text 为该字面量，usageHint 为 h1

#### Scenario: Invalid multi-key component
- **WHEN** 同一对象同时带 Text 与 Column 两个 key
- **THEN** 映射失败，不产生可用的 render request

### Requirement: Render request props
`getComponentRenderRequest` SHALL 为 Text 提供 `text` 与 `usageHint` props；为 Column / Row 提供布局字段（如 distribution、alignment），MUST NOT 把 child id 列表当作要渲染的 children 元素。

#### Scenario: Column request has no child elements
- **WHEN** Column 的 children.explicitList 为若干 id
- **THEN** render request 的 props 不含已渲染子节点，只含布局信息；child id 由 getChildIds 另给

### Requirement: Child id extraction
`getChildIds` SHALL 从容器的 `children.explicitList` 返回子组件 id 数组；叶子 Text MUST 得到空列表。

#### Scenario: Row explicit list
- **WHEN** Row 的 explicitList 为 `["a", "b"]`
- **THEN** getChildIds 返回 `["a", "b"]`
