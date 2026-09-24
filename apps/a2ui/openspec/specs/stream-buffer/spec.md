# stream-buffer Specification

## Purpose
stream-buffer 把分片 JSON 拼成完整 A2UI 对象，再转成可 parse 的 JSONL；多组件 surfaceUpdate 会拆成每个组件一行，以便动态渲染。

## Requirements

### Requirement: Chunk helpers for simulated streams
core SHALL 导出 `JSON_STREAM_CHUNK_SIZE = 50`、`JSON_STREAM_INTERVAL_MS = 50` 以及 `chunkText`。`chunkText` SHALL 按给定长度切分源文本；size ≤ 0 时 MUST 把非空源当作一整块。

#### Scenario: Default playground chunking
- **WHEN** 对一段 JSON 文本调用 chunkText() 且不改 size
- **THEN** 除最后一块外每块长度为 50

### Requirement: Extract complete objects from fragments
`A2UIStreamBuffer.push` SHALL 把分片追加到 pending，跳过 `[` `]` `,` 与空白，用忽略字符串与转义的花括号匹配抽出完整 `{...}`。不完整对象 MUST 留在 pending，且 MUST NOT 调用 parse。

#### Scenario: Object split across two pushes
- **WHEN** 第一次 push 只有半个 JSON 对象，第二次 push 补全收尾
- **THEN** 第一次不 parse；第二次抽出该对象后再进入协议转换

### Requirement: Pretty JSON is not split as JSONL
抽出对象后 SHALL 先作为单个 JSON 值解析，MUST NOT 把带换行的 pretty 原文按行交给 parser（否则会把一个对象拆成非法 JSONL）。

#### Scenario: Pretty-printed object in the stream
- **WHEN** 缓冲区凑齐一个带内部换行的 JSON 对象
- **THEN** 该对象被完整解析，而不是按换行切成多条失败的 parse

### Requirement: Convert to protocol JSONL
`toProtocolJsonl` SHALL 把 beginRendering、dataModelUpdate、deleteSurface 写成一行 JSON。对于带非空 `components` 数组的 surfaceUpdate，SHALL 为每个 component 产出一条独立 JSONL，每条都包含同一 surfaceId 且 components 长度为 1。

#### Scenario: Four components in one surfaceUpdate
- **WHEN** 抽出的对象是 column-text 那种一次带 4 个 component 的 surfaceUpdate
- **THEN** toProtocolJsonl 返回 4 行，每行一个 component，形状与 nested-column 单组件消息一致

### Requirement: Parse each completed protocol line
每凑齐一条协议 JSONL，缓冲区 SHALL 立刻调用 `parse`。SDK 仍按 parser 规则在该次 parse 结束时决定是否 renderTree。

#### Scenario: One object then parse
- **WHEN** 流中出现一条完整 beginRendering 对象
- **THEN** 缓冲区把它转成一行 JSONL 并 parse，store 中出现对应 surface
