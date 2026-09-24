# store Specification

## Purpose
a2ui-core 用无 React 依赖的 zustand/vanilla 单例保存 A2UI 表面、水合节点、错误和渲染回调，供 parser、treebuilder 与宿主共享。

## Requirements

### Requirement: Vanilla singleton store
a2ui-core SHALL 以 `zustand/vanilla` 提供全局单例 store，且 MUST NOT 依赖 React。调用方 SHALL 能通过导出函数拿到同一 store 实例。

#### Scenario: Host reads the singleton
- **WHEN** 宿主调用 `getA2UIStore()`
- **THEN** 返回的是进程内同一份 vanilla store，可用于订阅 surfaceMap、hydrateNodeMap 与 errorMap

### Requirement: Runtime init callbacks
`init` SHALL 接受 `renderMap`（组件名到单组件 render）以及可选的 `renderTree`（整棵树挂载函数），并把它们写入 store。`resetA2UIStore` SHALL 清掉 surface / hydrateNode / error，并可再次写入这两类回调。

#### Scenario: Playground boots the SDK
- **WHEN** playground 调用 `init({ renderMap, renderTree })`
- **THEN** 之后的 parse 能从 store 取到 renderMap，并在批次结束时调用同一 renderTree

### Requirement: Surface and hydrate node shape
每个 Surface SHALL 使用字符串 `surfaceId`，`root` 为根组件 id 字符串（若已 beginRendering），`rootNode` 为 HydrateNode 对象而不是字符串。每个 HydrateNode SHALL 包含 `componentId`、`v_node`、`ownerSurfaceId`、原始 `protocol`、`childIds`、`hasMounted`，根节点以外 SHALL 可带 `parentId`。

#### Scenario: Root identity after beginRendering
- **WHEN** parser 处理带 root 组件 id 的 beginRendering
- **THEN** 对应 Surface 的 `root` 等于该 id，且后续 treebuild 把组装结果写到 `rootNode`

### Requirement: Mount flag lifecycle
parser 遇到尚未存在的 componentId 时 SHALL 把 `hasMounted` 设为 false。更新已存在节点时 MUST 保留原 `hasMounted`。`markHydrateNodeMounted` SHALL 把指定节点的 `hasMounted` 设为 true。

#### Scenario: New component then animation end
- **WHEN** 新组件写入 hydrateNodeMap，随后宿主调用 `markHydrateNodeMounted(componentId)`
- **THEN** 该节点先以 hasMounted false 存在，调用后变为 true

### Requirement: Store deleteSurface scope
store 的 `deleteSurface` SHALL 只从 `surfaceMap` 移除该 surface，MUST NOT 自动删除 hydrateNode。

#### Scenario: Direct store API call
- **WHEN** 测试或调用方直接执行 store.deleteSurface(surfaceId)
- **THEN** 该 surface 消失，但 hydrateNodeMap 中仍可保留原先节点
