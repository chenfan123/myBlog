# 多轮微调

首轮：按用户描述**一次调用**生成完整闭环页面（规则见上文）。

后续轮：对话里会带上「当前界面协议」。这是**同一 surface 上的微调**，不是重新出一页。

## 何时微调

用户说改文案、改颜色/圆角、加减一个区块、改按钮、补全缺失节点、微调布局时，走微调。

## 微调必须遵守

- 沿用当前协议的 `surfaceId`「{{surfaceId}}」、`catalogId` 和已有 `root`。
- **只输出有变化的消息**，JSONL，每行一个对象。不要重放未改动的整棵树。
- **改/增/删组件必须用 `surfaceUpdate`**（整节点替换，不能只写 diff 字段）：
  - 改已有节点：同一 id，写出该组件的完整新定义。
  - 新增节点：先更新父级 `explicitList` / `child`（在原有子 id 上追加），再为每个新 id 写一条 `surfaceUpdate`。新 id 不得与现有 id 冲突。
  - 用户点名某个 id 时，输出该 id；若要加子节点，一并输出父级和新子节点。
- 改样式：再发一条 `beginRendering`，**同一 `root`**，只改 `styles` 里提到的 token（如 `primaryColor`、`radius`、`formFactor`）。不要输出 CSS。样式改动不能代替组件增改。用户要把手机页改成 PC 时，必须把 `formFactor` 改为 `desktop`，并用 `surfaceUpdate` 把单列改成顶栏 + 分栏/表格。
- 改数据：`dataModelUpdate`，只写变化的 path。
- 树改完后仍须闭环：新增引用的 id 都要有定义。
- 不要 `deleteSurface`，除非用户明确要清空重做。
- **禁止另起一页**：不要换 `root`，不要用一套全新 id 重画整页（例如把天气卡改成商品页）。可以在现有树上新增节点。

## 何时整页重做

用户明确说「重做 / 换一页 / 不要现在这个」时，才输出完整首轮协议（仍用 surfaceId「{{surfaceId}}」）。此时可以换 root 与组件 id。

## 示例

用户：把标题改成「车险理赔」，主色改成 #0071e3。

```
{"beginRendering":{"surfaceId":"{{surfaceId}}","root":"root","catalogId":"{{catalogId}}","styles":{"theme":"apple","primaryColor":"#0071e3"}}}
{"surfaceUpdate":{"surfaceId":"{{surfaceId}}","components":[{"id":"page-title","component":{"Text":{"text":{"literalString":"车险理赔"},"usageHint":"h1"}}}]}}
```

用户：在标题下面加一句说明。

```
{"surfaceUpdate":{"surfaceId":"{{surfaceId}}","components":[{"id":"page-col","component":{"Column":{"children":{"explicitList":["page-title","page-caption"]},"alignment":"stretch"}}}]}}
{"surfaceUpdate":{"surfaceId":"{{surfaceId}}","components":[{"id":"page-caption","component":{"Text":{"text":{"literalString":"提交材料后预计 3 个工作日到账"},"usageHint":"caption"}}}]}}
```
