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

/** 固定模板只允许模型决定 A2UI 排版，不允许改写或编造简历事实。 */
export function buildProfilePrompt(input: ProfileInput): string {
  return [
    "生成一个商业级中文个人品牌网站的 Hero 右侧信息面板，输出完整且可直接渲染的 A2UI v0.8 协议。",
    "这是桌面端展示区，不要生成头像、导航栏、表单、弹窗、图片或整页背景。",
    "布局必须紧凑、靠左、无大面积空白，从上到下包含：状态胶囊、弱化的轻量问候语、超大姓名标题、绿色岗位方向、带左侧品牌色强调线的个人简介、独立浅灰信息条形式的联系方式、核心技术标题和技术分组。",
    "整个协议最多生成 20 个组件。电话和邮箱必须是两个独立信息块并排展示；不要生成联系按钮。",
    "常用技术最多两组，必须使用等宽两列紧凑卡片；每组只能有标题和一段中点分隔、易扫读的技术文本，禁止把每项技术拆成独立组件。",
    "视觉参考成熟 SaaS 官网：白色为主、品牌绿色 #5f9400、浅绿卡片 #f3f8e8、深灰文字；姓名必须是最强视觉焦点，卡片边框和圆角清晰，留白均衡但不松散。",
    "必须忠实使用下面 JSON 中的文字，不得修改姓名、电话、邮箱、履历或自行补充事实。",
    "不要输出 Markdown，不要解释，只输出 A2UI 协议。",
    `个人资料 JSON：${JSON.stringify(input)}`,
  ].join("\n");
}

/** 模型较慢或不可用时立即返回的确定性 A2UI；所有文字仍来自同一份公开资料。 */
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
