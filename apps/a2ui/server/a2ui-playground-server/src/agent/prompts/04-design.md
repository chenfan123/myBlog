# 设计：协议里带 styles，结构走 Apple

视觉分两层：

1. **协议 token**：写在 `beginRendering.styles`（`theme` / `font` / `primaryColor` / `background` / `surfaceColor` / `textColor` / `mutedTextColor` / `radius` / `formFactor`）。宿主转换成 CSS 变量。不要输出 CSS、className、HTML。
2. **组件树**：Row / usageHint / List 分组。缺 styles 时页面 `theme.css` 用 Apple 兜底。

默认 `styles`：

```json
{
  "theme": "apple",
  "font": "-apple-system, BlinkMacSystemFont, \"SF Pro Text\", \"SF Pro Display\", sans-serif",
  "primaryColor": "#1d1d1f",
  "background": "#f5f5f7",
  "surfaceColor": "#ffffff",
  "textColor": "#1d1d1f",
  "mutedTextColor": "#86868b",
  "radius": 18,
  "formFactor": "mobile"
}
```

## 形态 formFactor

`styles.formFactor` 只能是 `mobile` 或 `desktop`。宿主用它决定预览宽度，不是 CSS。

- **默认 `mobile`**：没约定就当手机。单列 Card、大标题、底栏主按钮、列表项竖排。
- **改成 `desktop`**，仅当下面任一成立：
  1. 用户明确说 PC / 电脑 / 桌面 / 宽屏 / 后台 / 管理台 / Web 控制台。
  2. 用户贴了参考图，图本身是宽屏电脑界面（浏览器框、左侧导航 + 右侧表格、多列表头、横向仪表盘）。竖屏 App 截图仍用 mobile。
- 用户口头指定优先于参考图。说「手机端」即使图是宽屏也保持 mobile。
- 桌面页不要再做成一条窄手机列：用顶栏 Row（标题左、操作右），主体用 Row 分栏（可选侧栏 + 主区），表格用表头 Row + 多列数据 Row。

## 硬性规则

- 第一条消息必须是 `beginRendering`，并带上上面的 `styles`（至少 `theme: "apple"` + `formFactor`）。
- 根：`Card` → `Column(alignment: stretch)`。页标题用一个 `h1` 或 `h2`，下面一句 `caption`。桌面页标题可放进顶栏 Row。
- 同一行必须用 `Row`。名称在左、价格/操作在右：`distribution: spaceBetween`，`alignment: center`。中间文案包 `Column(alignment: start)`。
- 字号：页标题 `h1`/`h2`；行标题 `h4`；规格/库存/弱说明一律 `caption`；价格 `h3`。禁止全部 `body`。
- 列表：一个外层 Card 里放 `List` + `template`。列表项是 `Row`（图 + 标题/副标题 + 右侧价格），项与项之间用 `Divider`。
- 商品必须有 `Image`（列表 `smallFeature`，详情 `header` 或 `mediumFeature`，`fit: cover`）。有真实 URL 就写 `url`；否则写 `prompt`（中文或英文画面描述），宿主用 `DASHSCOPE_MODEL` 生图。不要用 picsum 占位。
- 主操作只有一个 `Button.primary: true`。颜色由 `styles.primaryColor` 决定。
- `Card` 最多两层。不要在组件上写 `style` / `className` / 内联 CSS。
- **一次调用必须内容饱满**：2 个以上区块，或 List 3～5 条带齐名称/规格/价格。禁止标题+按钮的空壳页。文案用具体中文，不要占位符。
- 容器先声明子 id 后，必须把每个子节点都写出来。只写到 h1 就结束属于半截协议。首轮如此；微调轮用 `surfaceUpdate` 改/增被点名的节点，但仍须保持闭环。

## 反例

禁止：Column 里竖着堆标题、规格、+/-、价格、删除。  
禁止：每件商品一张带阴影的独立灰卡。  
禁止：输出 CSS 或 HTML。  
禁止：只有 h1 + 一句 caption + 一个 Button 的最小页。  
禁止：Column 的 explicitList 里写了 id，却不输出这些组件。  
禁止：List 只有 1 条，或条目只有一个 Text。

## 配方

### 购物车

```
Card
  Column stretch
    Text(h1 购物车)
    Text(caption 共 n 件 · 合计可结算)
    List → template: item-row（至少 3 条，含图/名称/规格/价格）
    Divider
    Row center, spaceBetween: Column(Text caption 优惠说明 + Text h3 合计) + Button(primary 结算)
item-row = Row center, start
  Image smallFeature
  Column start: Text(h4 名称) + Text(caption 规格)
  Column end: Text(h3 价格) + Row(Button - , Text 数量, Button +)
```

数量 `+/-` 用 `updateModel` + `__localUpdatePath` / `__localUpdateOp`。

### 表单 / 登录

```
Card > Column stretch
  Text(h1) + Text(caption 一句说明，不要空)
  TextField 邮箱 / 账号
  TextField 密码
  Text(caption 协议或提示)
  Button(primary 继续)
```

### 桌面端（formFactor: desktop）

```
Card
  Column stretch
    Row center, spaceBetween: Text(h2 标题) + Text(caption 摘要) + Button(主操作)
    Row start:
      Column（可选筛选项 / 侧栏，短）
      Column stretch
        Row: 列头 Text caption
        Row: 单元格（名称 / 状态 / 日期 / 操作）× 多行
```

禁止把桌面页做成手机购物卡那样的单列窄条。

### 商品 / 内容

```
Card > Column stretch
  Image header
  Text(h2 具体标题) + Text(caption 价格或副标题) + Text(body 2 段以内要点)
  Divider
  Row spaceBetween: Text(h4 规格) + Text(caption 库存/发货)
  Button(primary)
```
