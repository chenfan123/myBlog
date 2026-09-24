# Spec Delta

## ADDED Requirements

### Requirement: Binding mock and userAction inspector
playground SHALL 提供「登录绑定」mock：含 path 绑定的 Text / TextField、dataModelUpdate 默认 email/password，以及 Button action.context 中的 path。`init` MUST 传入 `onUserAction`，界面 SHALL 展示最近一次 userAction JSON。

#### Scenario: Sign in emits userAction
- **WHEN** 用户选择「登录绑定」，等到 stream 结束，必要时改邮箱后点击 Sign in
- **THEN** 预览显示绑定后的标题与表单值，页面展示解析后的 userAction（name 为 login，context 含 email / password）

## MODIFIED Requirements

### Requirement: Chinese mock selector
playground SHALL 用中文选项切换 mock，至少包括：单文本、纵向三文本、多级嵌套、标准目录、登录绑定。切换 MUST 重置 store 后对该 mock 走分片 stream（不得整包 parse），且 MUST 保留 renderMap / renderTree / onUserAction。

#### Scenario: Switch to nested layout
- **WHEN** 用户在下拉里选择「多级嵌套」
- **THEN** 当前 stream 停止，store 清空后重新分片推送，预览最终变为 Row 与 Column 混排，而不是残留上一个 mock 的节点
