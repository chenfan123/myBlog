# 本仓库 A2UI 组件与协议约定（材料）

这份是 **catalog / 字段材料**，给 Agent prompt 模板引用，不是可直接发送的 system prompt。  
组装入口：`server/a2ui-playground-server/src/agent/prompt.ts`。

**权威字段**：[`packages/a2ui-react/src/catalog.json`](../packages/a2ui-react/src/catalog.json)。  
**权威类型键**：[`packages/a2ui-react/src/renderMap.tsx`](../packages/a2ui-react/src/renderMap.tsx) 的 `renderMap`。  
**本地 action**：[`local-client-dataModel-extension-v0_8.md`](./local-client-dataModel-extension-v0_8.md)。  
**消息 schema**：[`server_to_client_with_standard_catalog.json`](./server_to_client_with_standard_catalog.json)。

不要用官方 eval 里的 `Heading`、`Button.label`、`dynamicContext`、`Image.source.uri`。

---

## 1. 输出契约

只输出 A2UI，不要输出 AG-UI（`RUN_*` / `ACTIVITY_SNAPSHOT`）、HTML、CSS、markdown。

```json
{ "messages": [ /* A2UIMessage */ ] }
```

规则：

- 每条消息恰好一种动作：`beginRendering` | `surfaceUpdate` | `dataModelUpdate` | `deleteSurface`。
- **第一条必须是 `beginRendering`**，带 `surfaceId`、`root`、`catalogId: "a2ui-react:v0.8"`。
- 同一轮里所有消息用同一个 `surfaceId`。
- 组件 `id` 全局唯一；容器引用的 child id 必须存在。
- 一个 `surfaceUpdate` 里可以放多个 component。服务端会拆成「一条一个」再 SSE，模型不必自己拆。
- BoundValue：`literalString` / `literalNumber` / `literalBoolean` 和/或 `path`（如 `/title`）。同时带 `path` 和 literal 时，literal 写入 dataModel 初值（不覆盖已有值），渲染按 path 取。
- `dataModelUpdate.contents` 是邻接表，不是嵌套 JSON 对象。

`component` 必须是单键对象，键名只能是下面白名单。

---

## 1.1 `beginRendering.styles`

样式由模型写在协议里，**不要输出 CSS / className / HTML**。宿主 `parseSurfaceStyles` → `stylesToCssVars` 转成 `--a2ui-*`，页面 `theme.css` 做兜底。

```json
{
  "beginRendering": {
    "surfaceId": "surface-1",
    "root": "root",
    "catalogId": "a2ui-react:v0.8",
    "styles": {
      "theme": "apple",
      "font": "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", sans-serif",
      "primaryColor": "#1d1d1f",
      "background": "#f5f5f7",
      "surfaceColor": "#ffffff",
      "textColor": "#1d1d1f",
      "mutedTextColor": "#86868b",
      "radius": 18,
      "formFactor": "mobile"
    }
  }
}
```

| token | 映射 | 缺省（页面兜底） |
|------|------|------------------|
| `theme` | 先展开 apple / minimal 预设 | 无预设，用 CSS 默认（apple 观感） |
| `font` | `--a2ui-font` | SF / -apple-system |
| `primaryColor` | `--a2ui-primary` | `#1d1d1f` |
| `background` | `--a2ui-bg` / `--a2ui-fill` | `#f5f5f7` |
| `surfaceColor` | `--a2ui-surface` | `#ffffff` |
| `textColor` | `--a2ui-text` | `#1d1d1f` |
| `mutedTextColor` | `--a2ui-muted` | `#86868b` |
| `radius` | `--a2ui-radius` | `18px` |
| `formFactor` | `--a2ui-form-factor`，宿主 `data-a2ui-form-factor` | `mobile`（预览约 430px）；`desktop` 时加宽 |

默认生成 `theme: "apple"`、`formFactor: "mobile"`。用户明确 PC 或参考图是宽屏电脑界面时用 `desktop`。颜色必须是 `#RRGGBB`。禁止 `url(`、内联 CSS、任意 style 对象。

---

## 2. 组件白名单

优先：`Column`、`Row`、`List`、`Text`、`Image`、`Icon`、`Card`、`Button`。复杂交互再用表单和 `Tabs` / `Modal`。

| 类型 | 关键字段 |
|------|----------|
| `Column` / `Row` | `children.explicitList` 或 `children.template`；可选 `distribution`、`alignment` |
| `List` | `children.template` `{ componentId, dataBinding }` 或 `explicitList`；可选 `direction`、`alignment` |
| `Text` | `text` BoundValue；建议 `usageHint`: `h1`–`h5` \| `caption` \| `body`（缺省按 `body`） |
| `Image` | **`url`** BoundValue（不是 `source.uri`）；可选 `fit`、`usageHint` |
| `Icon` | `name` BoundValue，`literalString` 必须是 catalog 枚举 |
| `Video` / `AudioPlayer` | `url` BoundValue；AudioPlayer 可选 `description` |
| `Card` | **`child`**（单个组件 id，不是 `children`） |
| `Button` | **`child`**（通常指向一段 `Text`）+ `action`；可选 `primary` |
| `Tabs` | `tabItems[]`: `{ title` BoundValue, `child` id `}` |
| `Modal` | `entryPointChild` + `contentChild` |
| `Divider` | 可选 `axis`: `horizontal` \| `vertical` |
| `CheckBox` | `label`、`value` BoundValue |
| `TextField` | `label`；`text` 建议绑 `path`；可选 `textFieldType`、`validationRegexp` |
| `DateTimeInput` | `value`；可选 `enableDate`、`enableTime` |
| `MultipleChoice` | `selections`、`options[{ label, value }]` |
| `Slider` | `value`；可选 `minValue`、`maxValue` |
| `Empty` | 可选 `description` BoundValue |

`Button.action`：

```json
{
  "name": "submit",
  "context": [
    { "key": "email", "value": { "path": "/email" } }
  ]
}
```

`context` 必须是数组，元素为 `{ key, value: { path | literalString | literalNumber | literalBoolean } }`。不要写 `context: {}`，不要写 `label` / `text` 当按钮文案。

---

## 3. 易错对照

### `Text`

```json
"Text": {
  "text": { "path": "/headline", "literalString": "Welcome back" },
  "usageHint": "h2"
}
```

没有 `Heading`。标题用 `Text` + `usageHint`。

### `Image`

```json
"Image": {
  "url": { "literalString": "https://example.com/a.png" },
  "fit": "cover"
}
```

本地扩展：没有真实 URL 时写 `prompt`，宿主调用 `/v1/images/generate`（模型为 `DASHSCOPE_MODEL`）生图。`url` 可写空字符串。

```json
"Image": {
  "url": { "literalString": "" },
  "prompt": { "literalString": "杭州晴天城市天际线，扁平插画" },
  "usageHint": "header",
  "fit": "cover"
}
```

### `Card` / `Button`（单 child，不是 children）

```json
"Card": { "child": "main-column" }
```

```json
"Button": {
  "child": "btn-label",
  "primary": true,
  "action": { "name": "login", "context": [] }
}
```

`Column` / `Row` / `List` 才用 `children.explicitList` 或 `children.template`。

### `List` 模板

模板组件要单独声明。`dataBinding` 指向 dataModel 里的列表 path。

```json
"List": {
  "direction": "vertical",
  "children": {
    "template": { "componentId": "track-card", "dataBinding": "/tracks" }
  }
}
```

### `dataModelUpdate`

```json
{
  "dataModelUpdate": {
    "surfaceId": "login-form",
    "contents": [
      { "key": "headline", "valueString": "Welcome back" },
      { "key": "email", "valueString": "" }
    ]
  }
}
```

嵌套对象用 `valueMap` 邻接表，不要写 `"contents": { "user": { "name": "Ada" } }`。

---

## 4. 最小示例

```json
{
  "messages": [
    {
      "beginRendering": {
        "surfaceId": "main",
        "root": "root",
        "catalogId": "a2ui-react:v0.8"
      }
    },
    {
      "surfaceUpdate": {
        "surfaceId": "main",
        "components": [
          {
            "id": "root",
            "component": { "Card": { "child": "col" } }
          },
          {
            "id": "col",
            "component": {
              "Column": {
                "alignment": "stretch",
                "children": { "explicitList": ["title", "go"] }
              }
            }
          },
          {
            "id": "title",
            "component": {
              "Text": { "text": { "literalString": "Hello, A2UI" }, "usageHint": "h1" }
            }
          },
          {
            "id": "go-label",
            "component": {
              "Text": { "text": { "literalString": "继续" }, "usageHint": "body" }
            }
          },
          {
            "id": "go",
            "component": {
              "Button": {
                "child": "go-label",
                "primary": true,
                "action": { "name": "continue", "context": [] }
              }
            }
          }
        ]
      }
    }
  ]
}
```

参考 mock：[`packages/a2ui-core/src/mock/`](../packages/a2ui-core/src/mock/)（`login-form.json`、`list-template.json`、`local-update-text.json`、`open-link.json`）。

---

## 5. 多模态输入

用户文字或截图都是 **理解布局的输入**，不是协议资源。

- Playground 可点「图片」或粘贴截图；请求里以 `image_url` 发给多模态模型。
- 纵向 → `Column`，横向 → `Row`，卡片 → `Card.child`，标题/正文 → `Text.usageHint`，可点区域 → `Button.child` + `Text`。
- 图上的照片：用户给了可访问 URL 才用 `Image.url`；否则用 `Icon` 或占位 `Text`，不要编造死链。
- `Icon.name.literalString` 必须落在 catalog 枚举。
- 表单控件要带 `path`，并补对应 `dataModelUpdate`。
- 仍然只输出 `{ "messages": [...] }`。

---

## 6. 数据怎么到端上（Agent 不必实现）

```
用户 NL / 图片
  -> Agent 输出 { messages }
  -> parseAgentOutput / normalizeMessages
  -> flattenMessages（一条 surfaceUpdate 一个 component）
  -> AG-UI SSE ACTIVITY_SNAPSHOT(replace:false)
  -> parse JSONL -> store / dataModel / treebuild -> renderMap
```

---

## 7. 修订记录

| 版本 | 说明 |
|------|------|
| v0.1 | 对齐当时 `renderMap` 键名；明确 `Image.url` |
| v0.2 | 按当前 catalog / mock / parse 重写：`Card.child`、`Button.child`、输出契约、邻接表、Empty、多模态 |
