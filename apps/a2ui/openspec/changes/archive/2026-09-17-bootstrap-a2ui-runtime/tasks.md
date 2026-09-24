# Tasks

## 1. Store 与运行时初始化

- [x] 1.1 用 zustand/vanilla 实现全局单例 store（surfaceMap / hydrateNodeMap / errorMap）
- [x] 1.2 导出 getA2UIStore、init({ renderMap, renderTree })、resetA2UIStore
- [x] 1.3 HydrateNode 使用 v_node、childIds、parentId、hasMounted；Surface.root 为 id、rootNode 为对象
- [x] 1.4 实现 markHydrateNodeMounted；store.deleteSurface 只删除 surface 记录
- [x] 1.5 补充 init-store 与 surface 单测

## 2. Parser / vnode / treebuilder

- [x] 2.1 实现 JSONL parse：beginRendering、surfaceUpdate、dataModelUpdate、deleteSurface
- [x] 2.2 非法 JSON 与非法消息记 PARSE_ERROR；未注册组件记 UNREGISTERED_COMPONENT
- [x] 2.3 vnode 映射 Text / Column / Row，抽出 childIds 与 render props
- [x] 2.4 叶子立即 render；容器推迟到 treebuild；parse 结束 commitTree 并调用 renderTree
- [x] 2.5 parser 的 deleteSurface 同时清除该 surface 拥有的 hydrateNode
- [x] 2.6 后序 DFS 组装树，缺子节点则跳过；容器经 renderMap 注入 children
- [x] 2.7 隔离 Mocha：test:parser、test:treebuilder

## 3. React 渲染器与 mock

- [x] 3.1 a2ui-react 实现 Text / Column / Row 与 renderMap
- [x] 3.2 根元素带 data-a2ui-id；distribution / alignment 映射 flex
- [x] 3.3 hasMounted 入场淡入，动画结束 markHydrateNodeMounted
- [x] 3.4 提供 simple-text、column-text、nested-column（Row+Column 混排，beginRendering 在前）mock

## 4. 流缓冲与 playground

- [x] 4.1 实现 A2UIStreamBuffer、chunkText、toProtocolJsonl（surfaceUpdate 按组件拆行）
- [x] 4.2 nested-column mock 拆成单组件 JSONL；隔离 test:buffer
- [x] 4.3 playground init 传入 renderMap + renderTree；Preview 用 createRoot 挂树
- [x] 4.4 中文 Select 切换 mock；Store Modal 展示组件总数；antd 作为 UI 库
- [x] 4.5 模拟 stream：每 50ms 推 50 字符，缓冲区凑齐对象后 parse
