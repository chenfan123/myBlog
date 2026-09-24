---
name: a2ui-ui-design
description: >-
  Improve A2UI v0.8 visual layout toward Apple/iOS style. Styles belong in
  beginRendering.styles (theme, font, primaryColor, radius); the host converts
  them to CSS variables and theme.css is the fallback. Use when generating or
  editing A2UI JSON/mocks, agent prompts, playground preview, or when generated
  UI looks sparse, left-aligned, or unlike Apple HIG.
---

# A2UI 界面设计

样式在协议里，不在组件 CSS 里。

1. 模型写 `beginRendering.styles`（token，不是 CSS）。
2. `parseSurfaceStyles` → `stylesToCssVars` → `[data-a2ui-surface]` 的 `--a2ui-*`。
3. `packages/a2ui-react/src/theme.css` 提供缺省兜底。

权威提示词：`server/a2ui-playground-server/src/agent/prompts/04-design.md`

默认 styles：

```json
{
  "theme": "apple",
  "primaryColor": "#1d1d1f",
  "background": "#f5f5f7",
  "surfaceColor": "#ffffff",
  "textColor": "#1d1d1f",
  "mutedTextColor": "#86868b",
  "radius": 18,
  "formFactor": "mobile"
}
```

禁止在 JSON 里写 `style` / `className` / HTML / 任意 CSS。颜色必须 `#RRGGBB`。

## 结构

形态：默认 `formFactor: "mobile"`。用户明确 PC/桌面/后台，或参考图是宽屏电脑界面时用 `desktop`（顶栏 + 分栏/表格，预览加宽）。用户口头指定优先。

1. 根：`Card` → `Column(alignment: stretch)`。页标题 `h1`/`h2` + 一句 `caption`。
2. 同一行用 `Row`。左右撑开 `distribution: spaceBetween`。
3. 列表：一个 Card 包 `List` template。
4. 主按钮只有一个 `primary: true`。`Card` 最多两层。
5. 一次生成就要内容饱满：多个区块或 List 3～5 条（名称/规格/价格），禁止标题+按钮空壳。引用过的 child id 必须都有 surfaceUpdate。
6. 多轮微调沿用同一 surface 与 root。改/增组件用 `surfaceUpdate`；改颜色/圆角才用 `beginRendering.styles`。
