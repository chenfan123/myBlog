# Spec Delta

## ADDED Requirements

### Requirement: Implicit BoundValue initialization
`surfaceUpdate` SHALL 扫描组件协议中的 BoundValue。当同一绑定同时带 path 与 literal 时，MUST 把 literal 写入该 path，且 MUST NOT 覆盖 dataModel 里已有的同 path 值。

#### Scenario: Path plus literal seeds the model
- **WHEN** Text 的 text 为 `{ path: "/headline", literalString: "Hello" }`，且该 path 尚无值
- **THEN** 该 surface.dataModel.headline 为 "Hello"

#### Scenario: Later surfaceUpdate does not clobber model
- **WHEN** 模型 headline 已被 dataModelUpdate 改成 "Updated"，随后再次 surfaceUpdate 带同一 path+literal "Hello"
- **THEN** dataModel.headline 仍为 "Updated"

## MODIFIED Requirements

### Requirement: Data model update
`dataModelUpdate` SHALL 把条目写入对应 surface 的 `dataModel`。path 省略或 `/` 时 MUST 整棵替换；否则 MUST 把 contents 挂到该路径下。`/a/b` 与 `a/b` MUST 等价。

#### Scenario: Path value arrives
- **WHEN** 某 surface 已存在且收到 dataModelUpdate
- **THEN** 该 surface.dataModel 包含更新后的键值

#### Scenario: Nested path without leading slash
- **WHEN** dataModelUpdate 的 path 为 `user`（无 leading slash）
- **THEN** contents 被写到 dataModel.user 下
