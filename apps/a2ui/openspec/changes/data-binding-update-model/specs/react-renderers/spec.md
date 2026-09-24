# Spec Delta

## ADDED Requirements

### Requirement: Bound form controls write the model
TextField、CheckBox、Slider、DateTimeInput、MultipleChoice 在存在对应 path 与 `surfaceId` 时 SHALL 使用 props 中的已解析值作为受控值，`onChange` MUST 调用 `updateModel(surfaceId, path, next)`。Text / Image / Icon 只展示 treebuild 已解析的值。

#### Scenario: TextField path write-back
- **WHEN** TextField 的 textPath 为 `/email`，用户输入新字符串
- **THEN** SDK `updateModel` 将该字符串写入该 surface 的 `/email`，随后重渲染看到新值

### Requirement: Button emits userAction
Button 点击 SHALL 调用 `dispatchUserAction`，携带 `action.name`、`action.context`、`surfaceId` 与 `componentId`。MUST NOT 再以非协议的 `a2ui-action` 作为唯一派发路径（兼容别名可以由 SDK 在无 onUserAction 时派出）。

#### Scenario: Login button
- **WHEN** 用户点击带 action.name "login" 且 context 含 email path 的 Button
- **THEN** `onUserAction` 收到 name 为 login、context.email 为当前模型值的 payload
