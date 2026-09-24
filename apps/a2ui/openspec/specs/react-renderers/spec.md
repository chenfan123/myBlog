# react-renderers Specification

## Purpose
a2ui-react 为 Text、Column、Row 提供 React 实现与 renderMap，把协议 props 画成可挂载元素，并处理入场动画与 flex 布局。

## Requirements

### Requirement: Catalog renderMap
`a2ui-react` SHALL 导出 `renderMap`，注册 v0.8 标准目录全部组件：Text、Image、Icon、Video、AudioPlayer、Column、Row、List、Card、Tabs、Divider、Modal、Button、CheckBox、TextField、DateTimeInput、MultipleChoice、Slider。每个 renderer SHALL 在根元素上设置 `data-a2ui-id` 为 componentId，并用 `data-a2ui` 标明类型。

#### Scenario: Text root identity
- **WHEN** renderMap.Text 以 componentId "title" 被调用
- **THEN** 产出的 React 元素根节点带 data-a2ui-id="title" 与 data-a2ui="Text"

### Requirement: Flex layout props
Column 与 Row SHALL 把协议 `distribution` 映射为 CSS justify-content，把 `alignment` 映射为 align-items，并用 flex 方向区分纵向 / 横向。它们 SHALL 渲染 `props.children`。

#### Scenario: Row spaceBetween
- **WHEN** Row 的 distribution 为 spaceBetween
- **THEN** 根节点横向 flex，justify-content 对应 space-between，子节点按 children 渲染

### Requirement: Enter animation via hasMounted
当 `hasMounted` 为 false 时，renderer SHALL 播放约 0.3s 的入场淡入。动画结束 MUST 调用 `markHydrateNodeMounted(componentId)`。`hasMounted` 为 true 时 MUST NOT 再强制以透明状态遮挡内容。

#### Scenario: First mount fades in
- **WHEN** 新节点以 hasMounted false 交给 Text / Column / Row
- **THEN** 元素带入场动画 class，onAnimationEnd 后 store 中该节点 hasMounted 为 true
