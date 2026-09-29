import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOG_COMPONENT_TYPES, DEFAULT_CATALOG_ID } from "../a2ui-server/protocol";

export interface BuildAgentSystemPromptInput {
  surfaceId: string;
  catalogId?: string;
}

const AGENT_DIR = __dirname;
const PROMPTS_DIR = join(AGENT_DIR, "prompts");
const DOCS_DIR = join(AGENT_DIR, "../../../../docs");

const TEMPLATE_FILES = {
  role: "00-role.md",
  protocol: "01-protocol.md",
  catalog: "02-catalog.md",
  localActions: "03-local-actions.md",
  design: "04-design.md",
  multiturn: "05-multiturn.md",
} as const;

const MATERIAL_FILES = {
  protocolSchema: "server_to_client_with_standard_catalog.json",
  catalog: "supported-a2ui-standard-components-v0_8.md",
  localActions: "local-client-dataModel-extension-v0_8.md",
} as const;

/** 从 docs 材料 + prompt 模板组装完整 system prompt。 */
export function buildAgentSystemPrompt(input: BuildAgentSystemPromptInput): string {
  const catalogId = input.catalogId ?? DEFAULT_CATALOG_ID;
  const vars: Record<string, string> = {
    surfaceId: input.surfaceId,
    catalogId,
    allowedTypes: CATALOG_COMPONENT_TYPES.join(", "),
    example: minimalExample(input.surfaceId, catalogId),
    protocolSchema: readDoc(MATERIAL_FILES.protocolSchema),
    catalogMaterial: readDoc(MATERIAL_FILES.catalog),
    localActionMaterial: readDoc(MATERIAL_FILES.localActions),
  };

  return [
    renderTemplate(readPrompt(TEMPLATE_FILES.role), vars),
    renderTemplate(readPrompt(TEMPLATE_FILES.protocol), vars),
    renderTemplate(readPrompt(TEMPLATE_FILES.catalog), vars),
    renderTemplate(readPrompt(TEMPLATE_FILES.localActions), vars),
    renderTemplate(readPrompt(TEMPLATE_FILES.design), vars),
    renderTemplate(readPrompt(TEMPLATE_FILES.multiturn), vars),
  ].join("\n\n");
}

/**
 * 首页个人资料区块的数据和组件类型均受控，不需要每次发送完整的 5 万余字符规范。
 * 这里保留可闭环渲染所需的全部格式约束，显著降低首 token 与整体生成耗时。
 */
export function buildCompactEmbedSystemPrompt(input: BuildAgentSystemPromptInput): string {
  const catalogId = input.catalogId ?? DEFAULT_CATALOG_ID;
  return [
    "你是 A2UI v0.8 协议生成器。只输出 JSONL，每行一个 JSON 对象；禁止 Markdown、代码围栏和解释。",
    `所有消息 surfaceId 固定为 ${JSON.stringify(input.surfaceId)}，catalogId 固定为 ${JSON.stringify(catalogId)}。`,
    "第一行必须是 beginRendering，包含 surfaceId、root、catalogId、styles。其余每行必须是 surfaceUpdate，且 components 数组恰好包含一个组件。",
    "每个被 child 或 explicitList 引用的 id 都必须有对应 surfaceUpdate；id 不得重复；输出必须形成从 root 可达的完整树。",
    "仅允许 Text、Column、Row、Card、Button、Icon、Divider。不要输出未知属性。",
    'Text 格式：{\"Text\":{\"text\":{\"literalString\":\"文字\"},\"usageHint\":\"h1|h2|h3|h4|body|caption\"}}。',
    'Column/Row 格式：{\"Column\":{\"alignment\":\"stretch\",\"distribution\":\"start\",\"children\":{\"explicitList\":[\"id\"]}}}；Row 同理。',
    'Card 格式：{\"Card\":{\"child\":\"id\"}}。Divider 格式：{\"Divider\":{}}。',
    'Button 格式：{\"Button\":{\"child\":\"label-id\",\"primary\":true,\"action\":{\"name\":\"openAgent\",\"context\":[{\"key\":\"url\",\"value\":{\"literalString\":\"/path\"}}]}}}。',
    "styles 使用 theme=apple、primaryColor=#5f9400、background=#ffffff、surfaceColor=#ffffff、textColor=#17212b、mutedTextColor=#667085、radius=16、formFactor=desktop。",
    "必须忠实使用用户消息中的数据，不得补写公司、项目、数字、技能或经历事实。",
  ].join("\n");
}

export function promptTemplatePaths() {
  return {
    templates: Object.values(TEMPLATE_FILES).map((name) => join(PROMPTS_DIR, name)),
    materials: Object.values(MATERIAL_FILES).map((name) => join(DOCS_DIR, name)),
  };
}

function readPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

function readDoc(name: string): string {
  return readFileSync(join(DOCS_DIR, name), "utf8").trim();
}

export function buildContinuationUserPrompt(missingIds: string[]): string {
  const ids = missingIds.join("、");
  return [
    `刚才的输出树未闭环。这些 id 已被引用，但还没有对应的 surfaceUpdate：${ids}。`,
    "只继续输出剩余 JSONL：每行一个对象，每个 surfaceUpdate 只放 1 个组件。",
    "先补齐上述缺失 id，再写完它们的子树，直到所有引用都有定义。",
    "不要重复已经发过的节点，不要再写 beginRendering，不要包 { \"messages\" }，不要 markdown。",
  ].join("");
}

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

function minimalExample(surfaceId: string, catalogId: string) {
  const messages = [
    { beginRendering: { surfaceId, root: "root", catalogId, styles: { theme: "apple", primaryColor: "#1d1d1f" } } },
    {
      surfaceUpdate: {
        surfaceId,
        components: [{ id: "root", component: { Card: { child: "col" } } }],
      },
    },
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "col",
            component: {
              Column: {
                alignment: "stretch",
                children: { explicitList: ["title", "go"] },
              },
            },
          },
        ],
      },
    },
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "title",
            component: {
              Text: { text: { literalString: "Hello, A2UI" }, usageHint: "h1" },
            },
          },
        ],
      },
    },
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "go-label",
            component: {
              Text: { text: { literalString: "Continue" }, usageHint: "body" },
            },
          },
        ],
      },
    },
    {
      surfaceUpdate: {
        surfaceId,
        components: [
          {
            id: "go",
            component: {
              Button: {
                child: "go-label",
                primary: true,
                action: { name: "continue", context: [] },
              },
            },
          },
        ],
      },
    },
  ];
  return messages.map((message) => JSON.stringify(message)).join("\n");
}
