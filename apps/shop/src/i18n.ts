import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const resources = {
  en: {
    translation: {
      announcement: "Complimentary delivery on orders over $200",
      returns: "Easy returns within 30 days",
      nav: { new: "New in", home: "Home", wear: "Wear", travel: "Travel" },
      search: { placeholder: "Search objects", clear: "Clear search", emptyTitle: "No pieces found", emptyCopy: "Try a different search or reset the collection filters.", reset: "Reset search" },
      bag: { label: "Bag", open: "Open bag with {{count}} items", eyebrow: "Your selection", title: "Shopping bag", shippingGap: "You’re ${{amount}} from complimentary delivery", shippingReady: "Complimentary delivery unlocked", subtotal: "Subtotal", taxes: "Taxes and delivery calculated at checkout.", checkout: "Secure checkout", clear: "Clear bag", emptyTitle: "Your bag is waiting.", emptyCopy: "Explore the edit and add something you’ll keep.", browse: "Browse collection", remove: "Remove {{name}}", decrease: "Decrease quantity", increase: "Increase quantity", demo: "Demo checkout — no payment will be processed." },
      hero: { eyebrow: "Edition 04 · Autumn / Winter", line1: "Less, but", line2: "considered.", copy: "Thoughtful objects for everyday living. Chosen for their quiet utility, honest materials, and enduring design.", shop: "Shop the collection", view: "Our point of view", noteTitle: "The quiet room", noteCopy: "Objects for slower living" },
      trust: { delivery: "Complimentary delivery", deliveryCopy: "On orders over $200", packaging: "Considered packaging", packagingCopy: "Plastic-free and recyclable", warranty: "Built to last", warrantyCopy: "Minimum 2-year warranty" },
      collection: { eyebrow: "The current edit", title: "Objects worth keeping.", copy: "Purposeful pieces selected for how they work, feel, and last.", filters: "Filters", count: "{{count}} considered pieces", sort: "Sort by", featured: "Featured", low: "Price: low to high", high: "Price: high to low", rating: "Top rated", quick: "Quick view", add: "Add", color: "Colour", usd: "USD", reviews: "{{count}} considered reviews", ships: "Ships in 1–2 business days", edit: "Atelier edit" },
      category: { All: "All", Home: "Home", Audio: "Audio", Wear: "Wear", Travel: "Travel" },
      badges: { Bestseller: "Bestseller", New: "New", "Staff pick": "Staff pick", "Save $50": "Save $50" },
      editorial: { eyebrow: "Designed for movement", title1: "Carry less.", title2: "Go further.", copy: "Our travel edit pares things back to what matters: adaptable forms, resilient materials, and details that work without asking for attention.", action: "Explore travel" },
      newsletter: { eyebrow: "Notes from Atelier", title: "New objects, considered stories.", placeholder: "Email address", join: "Join us", success: "You’re on the list. Welcome to Atelier." },
      footer: { copy: "Modern essentials, thoughtfully selected.", collection: "Collection", journal: "Journal", about: "About", care: "Care", copyright: "© 2026 Atelier Goods. Demo commerce experience." },
      filter: { eyebrow: "Refine the edit", title: "Filters", category: "Category", sort: "Sort by", action: "View collection" },
      toast: "{{name}} added to your bag",
      language: "Language",
    },
  },
  zh: {
    translation: {
      announcement: "订单满 $200 即享免费配送",
      returns: "30 天内轻松退货",
      nav: { new: "新品", home: "家居", wear: "穿戴", travel: "旅行" },
      search: { placeholder: "搜索商品", clear: "清空搜索", emptyTitle: "没有找到相关商品", emptyCopy: "请尝试其他关键词或重置筛选条件。", reset: "重置搜索" },
      bag: { label: "购物袋", open: "打开购物袋，共 {{count}} 件商品", eyebrow: "你的选择", title: "购物袋", shippingGap: "再购 ${{amount}} 即享免费配送", shippingReady: "已解锁免费配送", subtotal: "商品小计", taxes: "税费与运费将在结算时计算。", checkout: "安全结算", clear: "清空购物袋", emptyTitle: "购物袋还是空的", emptyCopy: "浏览精选商品，找到值得长久拥有的好物。", browse: "浏览商品", remove: "移除 {{name}}", decrease: "减少数量", increase: "增加数量", demo: "演示结算：不会产生真实支付。" },
      hero: { eyebrow: "第 04 辑 · 秋冬精选", line1: "少一些，", line2: "更考究。", copy: "为日常生活精心挑选的物件。兼顾安静实用、真实材质与持久设计。", shop: "选购系列", view: "了解我们的理念", noteTitle: "静谧空间", noteCopy: "为慢生活而选" },
      trust: { delivery: "免费配送", deliveryCopy: "订单满 $200", packaging: "用心包装", packagingCopy: "无塑料且可回收", warranty: "经久耐用", warrantyCopy: "至少两年质保" },
      collection: { eyebrow: "本期精选", title: "值得长久拥有。", copy: "从使用体验、触感与耐久度出发，精选每一件有意义的物品。", filters: "筛选", count: "共 {{count}} 件精选商品", sort: "排序", featured: "推荐优先", low: "价格从低到高", high: "价格从高到低", rating: "评分最高", quick: "快速查看", add: "加入", color: "颜色", usd: "美元", reviews: "{{count}} 条真实评价", ships: "1–2 个工作日内发货", edit: "Atelier 精选" },
      category: { All: "全部", Home: "家居", Audio: "音频", Wear: "穿戴", Travel: "旅行" },
      badges: { Bestseller: "畅销商品", New: "新品", "Staff pick": "编辑推荐", "Save $50": "立省 $50" },
      editorial: { eyebrow: "为出行而设计", title1: "轻装上阵，", title2: "行得更远。", copy: "旅行精选回归真正重要的需求：灵活形态、耐用材质，以及无需刻意关注就自然好用的细节。", action: "探索旅行系列" },
      newsletter: { eyebrow: "Atelier 来信", title: "新物件与用心故事。", placeholder: "电子邮箱", join: "订阅", success: "订阅成功，欢迎加入 Atelier。" },
      footer: { copy: "现代生活必需品，用心甄选。", collection: "商品系列", journal: "品牌手记", about: "关于我们", care: "售后服务", copyright: "© 2026 Atelier Goods · 电商体验演示项目" },
      filter: { eyebrow: "细化你的选择", title: "商品筛选", category: "商品分类", sort: "排序方式", action: "查看商品" },
      toast: "已将 {{name}} 加入购物袋",
      language: "语言",
    },
  },
} as const;

const savedLanguage = localStorage.getItem("atelier-language");

void i18n.use(initReactI18next).init({
  resources,
  lng: savedLanguage === "zh" ? "zh" : "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export async function changeLanguage(language: "en" | "zh") {
  localStorage.setItem("atelier-language", language);
  document.documentElement.lang = language === "zh" ? "zh-CN" : "en";
  await i18n.changeLanguage(language);
}

document.documentElement.lang = i18n.language === "zh" ? "zh-CN" : "en";

export default i18n;
