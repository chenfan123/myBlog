/**
 * vnode 映射：把 A2UI 标准目录组件协议转成框架无关描述，并抽出 renderMap 入参。
 *
 * 协议里的 component 是单 key 对象，例如：
 *   { Text: { text: { literalString: "Hello, A2UI" }, usageHint: "h1" } }
 *   { Card: { child: "body" } }
 *   { Button: { child: "label", action: { name: "login" } } }
 *
 * parser 的 surfaceUpdate 会先走 getComponentRenderRequest：
 * - 叶子（Text / Image / Icon 等）有 renderMap[type] 时立刻 render，写入 v_node
 * - 容器（有 childIds：Column / Row / List / Card / Tabs / Modal / Button，或 children.template）只检查是否注册
 * - 没有对应 render 时记 UNREGISTERED_COMPONENT，并把 mapped 写进 v_node
 *
 * core 不依赖 React，所以 mapped 只是普通对象，不是 JSX。
 */
import {
  isString,
  readBoundBoolean,
  readBoundNumber,
  readBoundString,
  readBoundStringArray,
} from "./bound.js";
import type {
  ActionContextEntry,
  AudioPlayerVNode,
  ButtonVNode,
  CardVNode,
  CheckBoxVNode,
  ChoiceOptionVNode,
  ColumnVNode,
  ComponentAction,
  DateTimeInputVNode,
  DividerVNode,
  EmptyVNode,
  IconVNode,
  ImageVNode,
  ListVNode,
  MappedVNode,
  ModalVNode,
  MultipleChoiceVNode,
  RowVNode,
  SliderVNode,
  TabItemVNode,
  TabsVNode,
  TextFieldVNode,
  TextVNode,
  VideoVNode,
} from "./types.js";

export const STANDARD_CATALOG_TYPES = [
  "Text",
  "Image",
  "Icon",
  "Video",
  "AudioPlayer",
  "Row",
  "Column",
  "List",
  "Card",
  "Tabs",
  "Divider",
  "Modal",
  "Button",
  "CheckBox",
  "TextField",
  "DateTimeInput",
  "MultipleChoice",
  "Slider",
] as const;

export type StandardCatalogType = (typeof STANDARD_CATALOG_TYPES)[number];

interface ChildrenProp {
  explicitList?: unknown;
  template?: unknown;
}

/** 识别组件类型，并准备给 renderMap 的 props（不含 child id）。 */
export function getComponentRenderRequest(
  component: Record<string, unknown>,
): { type: string; props: Record<string, unknown>; mapped: MappedVNode } | null {
  const types = Object.keys(component);
  if (types.length !== 1) {
    return null;
  }

  const type = types[0];
  const mapped = mapComponentToVNode(component);
  return {
    type,
    props: mapped ? toRenderProps(mapped) : ((component[type] as Record<string, unknown> | undefined) ?? {}),
    mapped,
  };
}

/** 从协议抽出子组件 id：explicitList、child、Modal 两个入口、Tabs.tabItems。 */
export function getChildIds(component: Record<string, unknown>): string[] {
  const types = Object.keys(component);
  if (types.length !== 1) {
    return [];
  }

  const props = component[types[0]];
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    return [];
  }

  const record = props as Record<string, unknown>;
  const ids: string[] = [];

  const children = (record.children ?? record[" "]) as ChildrenProp | undefined;
  if (Array.isArray(children?.explicitList)) {
    ids.push(...children.explicitList.filter(isString));
  }
  if (isString(record.child)) {
    ids.push(record.child);
  }
  if (isString(record.entryPointChild)) {
    ids.push(record.entryPointChild);
  }
  if (isString(record.contentChild)) {
    ids.push(record.contentChild);
  }
  if (Array.isArray(record.tabItems)) {
    for (const item of record.tabItems) {
      if (typeof item === "object" && item !== null && isString((item as { child?: unknown }).child)) {
        ids.push((item as { child: string }).child);
      }
    }
  }

  return ids;
}

export function mapComponentToVNode(component: Record<string, unknown>): MappedVNode {
  const types = Object.keys(component);
  if (types.length !== 1) {
    return null;
  }

  const type = types[0];
  const props = component[type];
  switch (type) {
    case "Text":
      return mapText(props);
    case "Image":
      return mapImage(props);
    case "Icon":
      return mapIcon(props);
    case "Video":
      return mapVideo(props);
    case "AudioPlayer":
      return mapAudioPlayer(props);
    case "Column":
      return mapFlex("Column", props);
    case "Row":
      return mapFlex("Row", props);
    case "List":
      return mapList(props);
    case "Card":
      return mapCard(props);
    case "Tabs":
      return mapTabs(props);
    case "Divider":
      return mapDivider(props);
    case "Modal":
      return mapModal(props);
    case "Button":
      return mapButton(props);
    case "CheckBox":
      return mapCheckBox(props);
    case "TextField":
      return mapTextField(props);
    case "DateTimeInput":
      return mapDateTimeInput(props);
    case "MultipleChoice":
      return mapMultipleChoice(props);
    case "Slider":
      return mapSlider(props);
    case "Empty":
      return mapEmpty(props);
    default:
      return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function readExplicitList(props: Record<string, unknown> | undefined): string[] {
  const children = (props?.children ?? props?.[" "]) as ChildrenProp | undefined;
  return Array.isArray(children?.explicitList) ? children.explicitList.filter(isString) : [];
}

function readChildrenTemplate(props: Record<string, unknown> | undefined): { componentId: string; dataBinding: string } | undefined {
  const children = (props?.children ?? props?.[" "]) as ChildrenProp | undefined;
  const template = children?.template;
  if (typeof template !== "object" || template === null || Array.isArray(template)) {
    return undefined;
  }
  const record = template as Record<string, unknown>;
  const componentId = optionalString(record.componentId);
  const dataBinding = optionalString(record.dataBinding);
  if (!componentId || !dataBinding) {
    return undefined;
  }
  return { componentId, dataBinding };
}

/** 容器 children.template：克隆用的组件 id 与 dataModel 列表 path。explicitList 容器没有。 */
export function getChildrenTemplate(component: Record<string, unknown>): { componentId: string; dataBinding: string } | undefined {
  const types = Object.keys(component);
  if (types.length !== 1) {
    return undefined;
  }
  return readChildrenTemplate(asRecord(component[types[0]]));
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function toRenderProps(mapped: NonNullable<MappedVNode>): Record<string, unknown> {
  const { type: _type, ...rest } = mapped;
  const omitted = rest as Record<string, unknown>;
  delete omitted.childIds;
  delete omitted.childId;
  delete omitted.entryPointChild;
  delete omitted.contentChild;
  delete omitted.template;
  return omitted;
}

function mapText(raw: unknown): TextVNode {
  const props = asRecord(raw);
  const text = readBoundString(props?.text);
  const vnode: TextVNode = { type: "Text", text: text.value ?? "" };
  if (text.path) vnode.textPath = text.path;
  const usageHint = optionalString(props?.usageHint);
  if (usageHint) vnode.usageHint = usageHint;
  return vnode;
}

function mapImage(raw: unknown): ImageVNode {
  const props = asRecord(raw);
  const url = readBoundString(props?.url);
  const prompt = readBoundString(props?.prompt);
  const vnode: ImageVNode = { type: "Image", url: url.value ?? "" };
  if (url.path) vnode.urlPath = url.path;
  if (prompt.value) vnode.prompt = prompt.value;
  if (prompt.path) vnode.promptPath = prompt.path;
  const fit = optionalString(props?.fit);
  const usageHint = optionalString(props?.usageHint);
  if (fit) vnode.fit = fit;
  if (usageHint) vnode.usageHint = usageHint;
  return vnode;
}

function mapIcon(raw: unknown): IconVNode {
  const props = asRecord(raw);
  const name = readBoundString(props?.name);
  const vnode: IconVNode = { type: "Icon", name: name.value ?? "" };
  if (name.path) vnode.namePath = name.path;
  return vnode;
}

function mapVideo(raw: unknown): VideoVNode {
  const props = asRecord(raw);
  const url = readBoundString(props?.url);
  const vnode: VideoVNode = { type: "Video", url: url.value ?? "" };
  if (url.path) vnode.urlPath = url.path;
  return vnode;
}

function mapAudioPlayer(raw: unknown): AudioPlayerVNode {
  const props = asRecord(raw);
  const url = readBoundString(props?.url);
  const description = readBoundString(props?.description);
  const vnode: AudioPlayerVNode = { type: "AudioPlayer", url: url.value ?? "" };
  if (url.path) vnode.urlPath = url.path;
  if (description.value) vnode.description = description.value;
  if (description.path) vnode.descriptionPath = description.path;
  return vnode;
}

function mapFlex(type: "Column", raw: unknown): ColumnVNode;
function mapFlex(type: "Row", raw: unknown): RowVNode;
function mapFlex(type: "Column" | "Row", raw: unknown): ColumnVNode | RowVNode {
  const props = asRecord(raw);
  const vnode = {
    type,
    childIds: readExplicitList(props),
  } as ColumnVNode | RowVNode;
  const template = readChildrenTemplate(props);
  if (template) vnode.template = template;
  const distribution = optionalString(props?.distribution);
  const alignment = optionalString(props?.alignment);
  if (distribution) vnode.distribution = distribution;
  if (alignment) vnode.alignment = alignment;
  return vnode;
}

function mapList(raw: unknown): ListVNode {
  const props = asRecord(raw);
  const vnode: ListVNode = { type: "List", childIds: readExplicitList(props) };
  const template = readChildrenTemplate(props);
  if (template) vnode.template = template;
  const direction = optionalString(props?.direction);
  const alignment = optionalString(props?.alignment);
  if (direction) vnode.direction = direction;
  if (alignment) vnode.alignment = alignment;
  return vnode;
}

function mapCard(raw: unknown): CardVNode {
  const props = asRecord(raw);
  const childId = optionalString(props?.child);
  return {
    type: "Card",
    childId,
    childIds: childId ? [childId] : [],
  };
}

function mapTabs(raw: unknown): TabsVNode {
  const props = asRecord(raw);
  const tabItems: TabItemVNode[] = [];
  if (Array.isArray(props?.tabItems)) {
    for (const item of props.tabItems) {
      const record = asRecord(item);
      if (!record || !isString(record.child)) {
        continue;
      }
      const title = readBoundString(record.title);
      const mapped: TabItemVNode = { title: title.value ?? "", childId: record.child };
      if (title.path) mapped.titlePath = title.path;
      tabItems.push(mapped);
    }
  }
  return {
    type: "Tabs",
    tabItems,
    childIds: tabItems.map((item) => item.childId),
  };
}

function mapDivider(raw: unknown): DividerVNode {
  const props = asRecord(raw);
  const vnode: DividerVNode = { type: "Divider" };
  const axis = optionalString(props?.axis);
  if (axis) vnode.axis = axis;
  return vnode;
}

function mapModal(raw: unknown): ModalVNode {
  const props = asRecord(raw);
  const entryPointChild = optionalString(props?.entryPointChild);
  const contentChild = optionalString(props?.contentChild);
  const childIds = [entryPointChild, contentChild].filter(isString);
  return { type: "Modal", entryPointChild, contentChild, childIds };
}

function mapAction(raw: unknown): ComponentAction | undefined {
  const props = asRecord(raw);
  const name = optionalString(props?.name);
  if (!name) {
    return undefined;
  }
  const action: ComponentAction = { name };
  if (Array.isArray(props?.context)) {
    const context: ActionContextEntry[] = [];
    for (const entry of props.context) {
      const record = asRecord(entry);
      const key = optionalString(record?.key);
      const value = asRecord(record?.value);
      if (!key || !value) {
        continue;
      }
      context.push({
        key,
        value: {
          path: optionalString(value.path),
          literalString: optionalString(value.literalString),
          literalNumber: optionalNumber(value.literalNumber),
          literalBoolean: optionalBoolean(value.literalBoolean),
        },
      });
    }
    if (context.length > 0) {
      action.context = context;
    }
  }
  return action;
}

function mapButton(raw: unknown): ButtonVNode {
  const props = asRecord(raw);
  const childId = optionalString(props?.child);
  const vnode: ButtonVNode = {
    type: "Button",
    childId,
    childIds: childId ? [childId] : [],
  };
  const primary = optionalBoolean(props?.primary);
  if (primary !== undefined) vnode.primary = primary;
  const action = mapAction(props?.action);
  if (action) vnode.action = action;
  return vnode;
}

function mapCheckBox(raw: unknown): CheckBoxVNode {
  const props = asRecord(raw);
  const label = readBoundString(props?.label);
  const value = readBoundBoolean(props?.value);
  const vnode: CheckBoxVNode = { type: "CheckBox", label: label.value ?? "" };
  if (label.path) vnode.labelPath = label.path;
  if (value.value !== undefined) vnode.value = value.value;
  if (value.path) vnode.valuePath = value.path;
  return vnode;
}

function mapTextField(raw: unknown): TextFieldVNode {
  const props = asRecord(raw);
  const label = readBoundString(props?.label);
  const text = readBoundString(props?.text);
  const vnode: TextFieldVNode = { type: "TextField", label: label.value ?? "" };
  if (label.path) vnode.labelPath = label.path;
  if (text.value !== undefined) vnode.text = text.value;
  if (text.path) vnode.textPath = text.path;
  const textFieldType = optionalString(props?.textFieldType);
  const validationRegexp = optionalString(props?.validationRegexp);
  if (textFieldType) vnode.textFieldType = textFieldType;
  if (validationRegexp) vnode.validationRegexp = validationRegexp;
  return vnode;
}

function mapDateTimeInput(raw: unknown): DateTimeInputVNode {
  const props = asRecord(raw);
  const value = readBoundString(props?.value);
  const vnode: DateTimeInputVNode = { type: "DateTimeInput" };
  if (value.value !== undefined) vnode.value = value.value;
  if (value.path) vnode.valuePath = value.path;
  const enableDate = optionalBoolean(props?.enableDate);
  const enableTime = optionalBoolean(props?.enableTime);
  if (enableDate !== undefined) vnode.enableDate = enableDate;
  if (enableTime !== undefined) vnode.enableTime = enableTime;
  return vnode;
}

function mapMultipleChoice(raw: unknown): MultipleChoiceVNode {
  const props = asRecord(raw);
  const selections = readBoundStringArray(props?.selections);
  const options: ChoiceOptionVNode[] = [];
  if (Array.isArray(props?.options)) {
    for (const option of props.options) {
      const record = asRecord(option);
      const optionValue = optionalString(record?.value);
      if (!record || !optionValue) {
        continue;
      }
      const label = readBoundString(record.label);
      const mapped: ChoiceOptionVNode = { label: label.value ?? "", value: optionValue };
      if (label.path) mapped.labelPath = label.path;
      options.push(mapped);
    }
  }
  const vnode: MultipleChoiceVNode = { type: "MultipleChoice", options };
  if (selections.value) vnode.selections = selections.value;
  if (selections.path) vnode.selectionsPath = selections.path;
  const maxAllowedSelections = optionalNumber(props?.maxAllowedSelections);
  const variant = optionalString(props?.variant);
  const filterable = optionalBoolean(props?.filterable);
  if (maxAllowedSelections !== undefined) vnode.maxAllowedSelections = maxAllowedSelections;
  if (variant) vnode.variant = variant;
  if (filterable !== undefined) vnode.filterable = filterable;
  return vnode;
}

function mapSlider(raw: unknown): SliderVNode {
  const props = asRecord(raw);
  const value = readBoundNumber(props?.value);
  const vnode: SliderVNode = { type: "Slider" };
  if (value.value !== undefined) vnode.value = value.value;
  if (value.path) vnode.valuePath = value.path;
  const minValue = optionalNumber(props?.minValue);
  const maxValue = optionalNumber(props?.maxValue);
  if (minValue !== undefined) vnode.minValue = minValue;
  if (maxValue !== undefined) vnode.maxValue = maxValue;
  return vnode;
}

function mapEmpty(raw: unknown): EmptyVNode {
  const props = asRecord(raw);
  const description = readBoundString(props?.description);
  const vnode: EmptyVNode = { type: "Empty" };
  if (description.value) vnode.description = description.value;
  if (description.path) vnode.descriptionPath = description.path;
  return vnode;
}
