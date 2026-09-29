export type PortfolioSectionKind = "strengths" | "experiences" | "agents";

export type PortfolioSectionInput = {
  kind: PortfolioSectionKind;
  title: string;
  items: unknown[];
};

export const PORTFOLIO_SECTION_PROMPT_VERSION = "portfolio-sections-v5-card-inset";

function text(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function stringList(value: unknown, limit = 10): string[] {
  return Array.isArray(value) ? value.map((item) => text(item, 320)).filter(Boolean).slice(0, limit) : [];
}

function normalizeStrengths(items: unknown[]): string[] {
  return stringList(items, 8).map((item) => item.replace(/^\s*\d+[.)、]\s*/, ""));
}

function normalizeExperiences(items: unknown[]) {
  return items.slice(0, 6).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const rawCompany = text(value.company, 120);
    const company = rawCompany.length > 1 ? rawCompany : "公司名称待补充";
    if (!company) return [];
    return [{
      company,
      role: text(value.role, 120),
      time: text(value.time, 80),
      content: stringList(value.content, 8),
      achievements: stringList(value.achievements, 8),
    }];
  });
}

function normalizeAgents(items: unknown[]) {
  return items.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    const title = text(value.title, 120);
    if (!title) return [];
    const rawUrl = text(value.demo_url ?? value.demoUrl, 240);
    const demoUrl = rawUrl.startsWith("/") && !rawUrl.startsWith("//") ? rawUrl : "";
    return [{
      title,
      description: text(value.description, 500),
      tags: stringList(value.tags, 10),
      status: text(value.status, 40),
      demoUrl,
    }];
  });
}

export function normalizePortfolioSection(value: unknown): PortfolioSectionInput {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const kind = source.kind === "experiences" || source.kind === "agents" ? source.kind : "strengths";
  const rawItems = Array.isArray(source.items) ? source.items : [];
  return {
    kind,
    title: text(source.title, 80),
    items:
      kind === "experiences"
        ? normalizeExperiences(rawItems)
        : kind === "agents"
          ? normalizeAgents(rawItems)
          : normalizeStrengths(rawItems),
  };
}

const directionByKind: Record<PortfolioSectionKind, string> = {
  strengths:
    "把每项优势做成有编号、有短标题感和正文层级的品牌能力卡。根据内容选择错落网格或紧凑双列，避免千篇一律的列表。",
  experiences:
    "采用现代编辑式履历时间线。公司、岗位和时间形成清晰首层，工作内容与成果形成第二层；突出可验证成果，但不得改写数字。",
  agents:
    "采用产品作品集式 Agent 卡片。突出名称、能力描述、技术标签与状态；有 demoUrl 时生成‘查看 Agent’按钮，没有地址时不生成按钮。",
};

export function buildPortfolioSectionPrompt(input: PortfolioSectionInput): string {
  return [
    "你是一名资深数字产品设计师，请生成商业级中文个人网站区块，输出完整、可直接渲染的 A2UI v0.8 协议。",
    `当前区块：${input.title || input.kind}。${directionByKind[input.kind]}`,
    "只生成该区块的内容区域，不生成页面导航、页脚、头像、弹窗、表单或整页背景。允许使用 Text、Column、Row、Card、Button、Icon、Divider 等通用组件。",
    "视觉需要有创作性但保持成熟：清晰字号层级、克制的品牌绿色 #5f9400、浅绿层次、深灰正文、精致边框和有节奏的留白；避免大面积空白、过度居中、霓虹色和模板化营销套话。",
    "可以凝练段落和补充不改变含义的短标题，但姓名、公司、岗位、时间、技术名、项目名、状态、数字和所有履历事实必须原样保留，不得杜撰或夸大。",
    "控制组件数量：优势不超过 28 个，工作经历不超过 60 个，Agent 实现不超过 50 个。长内容优先合并为易扫读的文本，不要把每个标点拆成组件。",
    input.kind === "agents"
      ? "按钮 action.name 必须为 openAgent，action.context 必须包含 key 为 url、value.literalString 为对应 demoUrl；按钮文字统一为‘查看 Agent’。"
      : "不要生成按钮或交互动作。",
    "不要输出 Markdown，不要解释，只输出 A2UI 协议。",
    `提示词版本：${PORTFOLIO_SECTION_PROMPT_VERSION}`,
    `区块数据 JSON：${JSON.stringify(input)}`,
  ].join("\n");
}

/** 模型不可用时仍返回可渲染的 A2UI，而不是让主页区块空白。 */
export function buildPortfolioSectionProtocol(input: PortfolioSectionInput): A2UIMessage[] {
  const surfaceId = `portfolio-${input.kind}`;
  const messages: A2UIMessage[] = [{
    beginRendering: {
      surfaceId,
      root: "root",
      catalogId: "a2ui-react:v0.8",
      styles: {
        theme: "apple",
        primaryColor: "#5f9400",
        background: "#ffffff",
        surfaceColor: "#ffffff",
        textColor: "#17212b",
        mutedTextColor: "#667085",
        radius: 16,
        formFactor: "desktop",
      },
    },
  }];
  const component = (id: string, value: Record<string, unknown>) => {
    messages.push({ surfaceUpdate: { surfaceId, components: [{ id, component: value }] } });
  };
  const literal = (value: string, usageHint = "body") => ({
    Text: { text: { literalString: value }, usageHint },
  });
  const itemIds = input.items.map((_, index) => `item-${index}`);
  const rowIds = Array.from({ length: Math.ceil(itemIds.length / 2) }, (_, index) => `row-${index}`);
  component("root", {
    Column: { alignment: "stretch", distribution: "start", children: { explicitList: ["eyebrow", "title", ...rowIds] } },
  });
  component("eyebrow", literal(input.kind === "strengths" ? "CAPABILITY MATRIX" : input.kind === "experiences" ? "CAREER TIMELINE" : "SELECTED AGENT WORK", "caption"));
  component("title", literal(input.title, "h2"));

  rowIds.forEach((rowId, rowIndex) => {
    component(rowId, {
      Row: {
        alignment: "stretch",
        distribution: "spaceBetween",
        children: { explicitList: itemIds.slice(rowIndex * 2, rowIndex * 2 + 2) },
      },
    });
  });

  if (input.kind === "strengths") {
    (input.items as string[]).forEach((value, index) => {
      const prefix = `strength-${index}`;
      component(`item-${index}`, { Card: { child: `${prefix}-column` } });
      component(`${prefix}-column`, {
        Column: {
          alignment: "stretch",
          distribution: "start",
          children: { explicitList: [`${prefix}-number`, `${prefix}-body`] },
        },
      });
      component(`${prefix}-number`, literal(String(index + 1).padStart(2, "0"), "caption"));
      component(`${prefix}-body`, literal(value));
    });
    return messages;
  }

  if (input.kind === "experiences") {
    (input.items as Array<{ company: string; role: string; time: string; content: string[]; achievements: string[] }>).forEach((item, index) => {
      const prefix = `experience-${index}`;
      component(`item-${index}`, { Card: { child: `${prefix}-column` } });
      component(`${prefix}-column`, {
        Column: {
          alignment: "stretch",
          distribution: "start",
          children: { explicitList: [`${prefix}-top`, `${prefix}-content-label`, `${prefix}-content`, `${prefix}-achievement-label`, `${prefix}-achievement`] },
        },
      });
      component(`${prefix}-top`, {
        Column: { alignment: "stretch", distribution: "start", children: { explicitList: [`${prefix}-company`, `${prefix}-time`] } },
      });
      component(`${prefix}-company`, literal(item.company, "h3"));
      component(`${prefix}-time`, literal(item.time, "caption"));
      component(`${prefix}-content-label`, literal(item.role || "工作内容", "h4"));
      component(`${prefix}-content`, literal(item.content.map((value) => `• ${value}`).join("\n") || "工作内容待补充"));
      component(`${prefix}-achievement-label`, literal("工作业绩", "caption"));
      component(`${prefix}-achievement`, literal(item.achievements.map((value) => `• ${value}`).join("\n") || "代表性成果待补充"));
    });
    return messages;
  }

  (input.items as Array<{ title: string; description: string; tags: string[]; status: string; demoUrl: string }>).forEach((item, index) => {
    const prefix = `agent-${index}`;
    const children = [`${prefix}-top`, `${prefix}-description`, `${prefix}-stack-label`, `${prefix}-tags`];
    if (item.demoUrl) children.push(`${prefix}-button`);
    component(`item-${index}`, { Card: { child: `${prefix}-column` } });
    component(`${prefix}-column`, {
      Column: { alignment: "stretch", distribution: "start", children: { explicitList: children } },
    });
    component(`${prefix}-top`, {
      Row: { alignment: "center", distribution: "spaceBetween", children: { explicitList: [`${prefix}-title`, `${prefix}-status`] } },
    });
    component(`${prefix}-title`, literal(item.title, "h3"));
    component(`${prefix}-status`, literal(item.status || "规划中", "caption"));
    component(`${prefix}-description`, literal(item.description));
    component(`${prefix}-stack-label`, literal("TECH STACK", "caption"));
    component(`${prefix}-tags`, literal(item.tags.join(" · "), "caption"));
    if (item.demoUrl) {
      component(`${prefix}-button-label`, literal("查看 Agent"));
      component(`${prefix}-button`, {
        Button: {
          child: `${prefix}-button-label`,
          primary: true,
          action: { name: "openAgent", context: [{ key: "url", value: { literalString: item.demoUrl } }] },
        },
      });
    }
  });
  return messages;
}
import type { A2UIMessage } from "./a2ui-server/protocol";
