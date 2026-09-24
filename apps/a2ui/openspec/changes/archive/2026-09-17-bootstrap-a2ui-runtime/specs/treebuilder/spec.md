# Spec Delta

## Purpose

treebuilder 从每个已 beginRendering 的 surface.root 出发，按 childIds 后序深度优先组装可挂载组件树，让容器通过 renderMap 拿到真实 children。

## ADDED Requirements

### Requirement: Post-order assembly from surface root
treebuild SHALL 从 Surface.root 指向的 HydrateNode 开始，按 `childIds` 后序 DFS 组装。父节点的 `parentId` SHALL 在遍历时回填。成功后 SHALL 把根 HydrateNode 写到 `Surface.rootNode`。

#### Scenario: Nested column and row
- **WHEN** store 中有多级 Column / Row / Text，且 root 指向最外层容器
- **THEN** 组装结果是从该 root 出发的树，子节点顺序与 explicitList 一致

### Requirement: Missing children skipped
若 childIds 中的某个 id 在 hydrateNodeMap 中尚不存在，treebuild SHALL 跳过该 child，MUST NOT 因此失败整棵树，以便增量 stream 先渲染已到达的节点。

#### Scenario: Parent arrived before a child
- **WHEN** Column 已入库但其中一个 child id 还没有 HydrateNode
- **THEN** 该 Column 仍可组装，children 只包含已经存在的子节点

### Requirement: Container re-render with children
容器节点 SHALL 在子树就绪后再次调用 renderMap，把子节点作为 `props.children` 传入，并带上 `componentId` 与 `hasMounted`。组装 MUST NOT 依赖 React `cloneElement`。

#### Scenario: Column receives three text children
- **WHEN** Column 与三个已渲染 Text 都在 store 中
- **THEN** Column 的最终 v_node 来自 renderMap("Column")，其 props.children 为三个子 v_node

### Requirement: Returned tree is host-mountable
`buildTree` / `parse` 返回的树 SHALL 可被宿主直接挂载（playground 中即 React 元素树），宿主 MUST NOT 再解析 hydrateNodeMap 才能画 UI。

#### Scenario: Preview mounts parse result
- **WHEN** SDK 把 commitTree 的结果交给 playground renderTree
- **THEN** Preview 可以对有效元素调用 createRoot().render，无需再从 protocol 字段拼 JSX
