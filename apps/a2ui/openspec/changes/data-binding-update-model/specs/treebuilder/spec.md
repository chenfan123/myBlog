# Spec Delta

## ADDED Requirements

### Requirement: Resolve bindings on every assemble
`assembleNode` SHALL 对叶子和容器都调用 renderMap。渲染前 MUST 用该节点 `ownerSurfaceId` 的当前 dataModel 把 `*Path` 解析进对应值。props MUST 包含 `surfaceId`、`componentId` 与 `hasMounted`。结果 MUST 写回 `hydrateNode.v_node`。仅 path 且模型无值时，字符串绑定 MUST 渲染为空串（或 mapped 回退值）。

#### Scenario: dataModelUpdate refreshes Text
- **WHEN** 先 surfaceUpdate 一个 path 绑定的 Text，再 dataModelUpdate 写入该 path，随后再次 dataModelUpdate 改值
- **THEN** 组装树里的 Text 先后为两次模型值

#### Scenario: Path only and empty model
- **WHEN** Text 只有 `text.path`，dataModel 没有该键
- **THEN** 组装结果的 text 为空串

## MODIFIED Requirements

### Requirement: Container re-render with children
容器节点 SHALL 在子树就绪后再次调用 renderMap，把子节点作为 `props.children` 传入，并带上 `componentId`、`surfaceId` 与 `hasMounted`。组装 MUST NOT 依赖 React `cloneElement`。叶子 MUST 同样重 render，不得复用 parse 时冻住的 v_node 作为权威画面。

#### Scenario: Column receives three text children
- **WHEN** Column 与三个已渲染 Text 都在 store 中
- **THEN** Column 的最终 v_node 来自 renderMap("Column")，其 props.children 为三个子 v_node
