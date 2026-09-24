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
