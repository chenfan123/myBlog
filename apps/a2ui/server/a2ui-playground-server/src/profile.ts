import type { A2UIMessage } from "./a2ui-server/protocol";

export type ProfileInput = {
  name: string;
  role: string;
  introduction: string;
  phone: string;
  email: string;
  availability: string;
  skillGroups: Array<{ title: string; skills: string[] }>;
};

/** 修改提示词时同步更新版本，让旧的内存缓存立即失效。 */
export const PROFILE_PROMPT_VERSION = "creative-profile-v3-compact";

function text(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** 只保留个人主页展示所需的公开字段，限制长度避免提示词被异常数据撑大。 */
export function normalizeProfileInput(value: unknown): ProfileInput {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const rawGroups = Array.isArray(source.skillGroups) ? source.skillGroups : [];
  const skillGroups = rawGroups.slice(0, 2).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const group = item as Record<string, unknown>;
    const title = text(group.title, 40);
    const skills = Array.isArray(group.skills)
      ? group.skills.map((skill) => text(skill, 32)).filter(Boolean).slice(0, 10)
      : [];
    return title && skills.length > 0 ? [{ title, skills }] : [];
  });

  return {
    name: text(source.name, 40),
    role: text(source.role, 120),
    introduction: text(source.introduction, 500),
    phone: text(source.phone, 40),
    email: text(source.email, 120),
    availability: text(source.availability, 40) || "开放机会",
    skillGroups,
  };
}

/** 在事实不可变的前提下，让模型同时承担文案编辑和视觉编排。 */
export function buildProfilePrompt(input: ProfileInput): string {
  return [
    "你是一名资深品牌设计师、中文文案编辑和 A2UI 界面工程师。请生成一个有鲜明个人气质、商业级且可直接渲染的中文个人品牌 Hero 信息面板，输出完整 A2UI v0.8 协议。",
    "这是桌面端展示区，不要生成头像、导航栏、表单、弹窗、图片或整页背景。",
    "不要套用普通简历表格。请从编辑式个人主页、现代产品仪表盘、科技品牌名片三种创作方向中自行选择一种，用字号反差、分区、卡片层次和克制的装饰形成视觉记忆点；同一页面只能使用一种方向。",
    "整体应紧凑、靠左、无大面积空白，并包含：状态、轻量引导语、姓名主标题、岗位方向、个人价值简介、电话、邮箱、核心技术标题和技术分组。组件 ID 必须使用 status、greeting、name、role、intro、contact-row、phone、email、skills-label、skills-row，以及 skill-card-N、skill-column-N、skill-title-N、skill-text-N，以便品牌样式正确生效。",
    "整个协议最多生成 20 个组件。电话和邮箱必须是两个独立信息块；不要生成联系按钮。技术最多两组，使用两列卡片；每组只放标题和一段易扫读的技术文本，技术之间使用中点分隔，禁止把每项技术拆成独立组件。",
    "视觉基调为成熟 SaaS 品牌：白色为主、品牌绿色 #5f9400、浅绿 #f3f8e8、深灰文字。允许创造更有张力的层级和措辞，但避免霓虹色、过度渐变、居中堆叠和廉价模板感。姓名必须是最强视觉焦点。",
    "事实约束：姓名、岗位方向、电话、邮箱、状态、技能名称和经历事实必须严格保持，不得杜撰、夸大或新增经历。",
    "创作许可：可以把 introduction 改写为 1 至 2 句更凝练、更有个人品牌感的中文价值主张，也可以重写轻量问候语；改写只能使用原文已有事实，不得加入未经提供的数字、公司、项目、头衔或能力。",
    "不要机械照抄字段标签，不要出现‘个人简介’‘联系方式’等简历式栏目名。文字要自然、专业、有辨识度。",
    "不要输出 Markdown，不要解释，只输出 A2UI 协议。",
    `提示词版本：${PROFILE_PROMPT_VERSION}`,
    `个人资料 JSON：${JSON.stringify(input)}`,
  ].join("\n");
}

/** 模型较慢或不可用时返回的确定性 A2UI；所有文字仍来自同一份公开资料。 */
export function buildProfileProtocol(input: ProfileInput): A2UIMessage[] {
  const surfaceId = "profile-home";
  const messages: A2UIMessage[] = [
    {
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
    },
  ];
  const component = (id: string, value: Record<string, unknown>) => {
    messages.push({ surfaceUpdate: { surfaceId, components: [{ id, component: value }] } });
  };
  const literal = (value: string, usageHint: string) => ({
    Text: { text: { literalString: value }, usageHint },
  });
  const children = ["status", "greeting", "name", "role", "intro", "contact-row", "skills-label", "skills-row"];
  component("root", { Column: { alignment: "stretch", distribution: "start", children: { explicitList: children } } });
  component("status", literal(`● 当前状态 · ${input.availability}`, "caption"));
  component("greeting", literal("你好，我是", "h3"));
  component("name", literal(input.name, "h1"));
  component("role", literal(input.role, "h3"));
  component("intro", literal(input.introduction, "body"));
  component("contact-row", {
    Row: {
      alignment: "stretch",
      distribution: "start",
      children: { explicitList: ["phone", "email"] },
    },
  });
  component("phone", literal(`电话  ${input.phone}`, "body"));
  component("email", literal(`邮箱  ${input.email}`, "body"));
  component("skills-label", literal("核心技术", "h4"));

  const groupCards = input.skillGroups.map((_, index) => `skill-card-${index}`);
  component("skills-row", {
    Row: { alignment: "stretch", distribution: "spaceBetween", children: { explicitList: groupCards } },
  });
  input.skillGroups.forEach((group, index) => {
    const cardId = `skill-card-${index}`;
    const columnId = `skill-column-${index}`;
    const titleId = `skill-title-${index}`;
    const textId = `skill-text-${index}`;
    component(cardId, { Card: { child: columnId } });
    component(columnId, {
      Column: { alignment: "stretch", distribution: "start", children: { explicitList: [titleId, textId] } },
    });
    component(titleId, literal(group.title, "h4"));
    component(textId, literal(group.skills.join(" · "), "body"));
  });
  return messages;
}
