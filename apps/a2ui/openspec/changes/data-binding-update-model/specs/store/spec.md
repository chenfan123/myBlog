# Spec Delta

## MODIFIED Requirements

### Requirement: Runtime init callbacks
`init` SHALL 接受 `renderMap`（组件名到单组件 render）、可选的 `renderTree`（整棵树挂载函数），以及可选的 `onUserAction`（解析后的协议 userAction 回调），并把它们写入 store。`resetA2UIStore` SHALL 清掉 surface / hydrateNode / error，并可再次写入这些回调。

#### Scenario: Playground boots the SDK
- **WHEN** playground 调用 `init({ renderMap, renderTree, onUserAction })`
- **THEN** 之后的 parse 能从 store 取到 renderMap，批次结束时调用同一 renderTree，Button 触发的 userAction 进入同一 onUserAction
