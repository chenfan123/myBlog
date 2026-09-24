# 本地 action（实现层扩展 v0.8）（材料）

这份是 **本地 action 材料**，给 Agent prompt 模板引用。组装入口：`server/a2ui-playground-server/src/agent/prompt.ts`。

A2UI 0.8 标准只描述客户端发往服务端的 `userAction` / `error`，没有「不经过服务端、只在客户端改 dataModel / 开外链」。本仓库在 **`Button.action.context`** 里用保留 key 表达这两件事。

不要写 `action.localDataModelUpdate` 或 `action.openLink: { url, target }`。端上不认这两个字段。

实现：[`packages/a2ui-react/src/action.ts`](../packages/a2ui-react/src/action.ts) 的 `triggerAction`。先跑本地更新 / 开链，再 `dispatchUserAction`。

---

## 1. 本地写 dataModel

在 `action.context` 里同时给出 path 和一个 typed literal：

| key | value |
|-----|--------|
| `__localUpdatePath` | `{ "literalString": "/message" }` |
| `__localUpdateString` | `{ "literalString": "新文案" }` |
| `__localUpdateNumber` | `{ "literalNumber": 1 }` |
| `__localUpdateBoolean` | `{ "literalBoolean": true }` |

点击后宿主调用 `updateModel(surfaceId, path, value)`，等价于收到一条服务端 `dataModelUpdate`，然后 treebuild 刷新。

```json
{
  "Button": {
    "child": "update-label",
    "primary": true,
    "action": {
      "name": "updateMessage",
      "context": [
        {
          "key": "__localUpdatePath",
          "value": { "literalString": "/message" }
        },
        {
          "key": "__localUpdateString",
          "value": { "literalString": "你好，文案已更新" }
        }
      ]
    }
  }
}
```

`action.name` 仍应保留，需要上报时组装标准 `userAction`。

示例：[`packages/a2ui-core/src/mock/local-update-text.json`](../packages/a2ui-core/src/mock/local-update-text.json)。

---

## 2. 打开外部网页

`action.name` 用 `openLink`（或 `open_link`），URL 放在 context：

| key | value |
|-----|--------|
| `__openLinkUrl` | `{ "path": "/url" }` 或 `{ "literalString": "https://..." }` |
| `__openLinkTarget` | 可选，`{ "literalString": "_blank" }`（默认 `_blank`） |

也可以在 `name` 为 `openLink` 时用普通 key `url` / `href` / `target`。只接受 `http:` / `https:`。

```json
{
  "Button": {
    "child": "open-label",
    "primary": true,
    "action": {
      "name": "openLink",
      "context": [
        { "key": "__openLinkUrl", "value": { "path": "/url" } },
        { "key": "__openLinkTarget", "value": { "literalString": "_blank" } },
        { "key": "url", "value": { "path": "/url" } }
      ]
    }
  }
}
```

示例：[`packages/a2ui-core/src/mock/open-link.json`](../packages/a2ui-core/src/mock/open-link.json)。

可与 `__localUpdate*` 同时出现：实现上先开链，再写模型。

---

## 3. 和标准 userAction 的关系

本地行为跑完后仍会发出标准 `userAction`（`name`、`surfaceId`、`sourceComponentId`、解析后的 `context`）。  
本仓库最小实现不要求 `deliveryMode`，也不要求把 `localDataModelUpdate` 对象挂到 `userAction` 上。
