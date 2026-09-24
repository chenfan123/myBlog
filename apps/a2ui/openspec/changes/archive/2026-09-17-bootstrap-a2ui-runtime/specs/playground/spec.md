# Spec Delta

## Purpose

a2ui-playground 作为 Vite + React 宿主，用 mock 协议与分片 stream 验证 SDK：切换样例、预览组件树、检查 store，不把宿主 CSS 当成协议行为。

## ADDED Requirements

### Requirement: Host wires init callbacks
playground 启动时 SHALL 调用 `init`（或 `resetA2UIStore`）并传入 `a2ui-react` 的 renderMap 以及把有效元素交给 Preview 的 renderTree。Preview SHALL 用 `createRoot().render` 挂载，MUST NOT 在每次树更新时卸载 host 根节点。

#### Scenario: App boot
- **WHEN** 用户打开 playground
- **THEN** 默认 mock 被 parse，预览区出现对应 UI，store 中已有 renderMap 与 renderTree

### Requirement: Chinese mock selector
playground SHALL 用中文选项切换至少三种 mock：单文本、纵向三文本、多级嵌套。切换 MUST 重置 store 后重新 parse，且 MUST 保留 renderMap / renderTree。

#### Scenario: Switch to nested layout
- **WHEN** 用户在下拉里选择「多级嵌套」
- **THEN** 预览变为 Row 与 Column 混排的嵌套布局，而不是残留上一个 mock 的节点

### Requirement: Store inspector
playground SHALL 提供按钮，用对话框展示 store 摘要，顶部展示当前渲染组件总数。因 React 元素无法直接 JSON.stringify，展示前 MUST 把 v_node 转成可序列化摘要。

#### Scenario: Open store dialog
- **WHEN** 用户点击查看 Store
- **THEN** 对话框显示 hydrateNode 数量等信息，且不会因为 v_node 是 React 元素而变成空对象

### Requirement: Simulated JSON stream
playground SHALL 能模拟完整 JSON 流：把嵌套 mock 序列化后每 50ms 推送 50 个字符到 `A2UIStreamBuffer`。界面 SHALL 展示已推送字节与当前组件数量。

#### Scenario: Stream reaches completion
- **WHEN** 用户启动模拟 stream 并等到分片结束
- **THEN** 预览与一次性 parse 同一 mock 的结构一致，store 中组件数等于该 mock 定义的组件数

### Requirement: Host styling is not protocol
playground 附加的视觉样式（例如 Row 的灰色背景）SHALL 只存在于宿主 CSS。规格与协议 MUST NOT 把该背景当成 A2UI 组件语义。

#### Scenario: Gray row background
- **WHEN** 预览中 Row 看起来有浅灰底
- **THEN** 这来自主机 App.css，而不是 Row 协议字段或 a2ui-core
