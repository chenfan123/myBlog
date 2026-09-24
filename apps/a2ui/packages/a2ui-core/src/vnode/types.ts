import type { BoundString } from "./bound.js";

export interface TextVNode {
  type: "Text";
  text: string;
  textPath?: string;
  usageHint?: string;
}

export interface ImageVNode {
  type: "Image";
  url: string;
  urlPath?: string;
  prompt?: string;
  promptPath?: string;
  fit?: string;
  usageHint?: string;
}

export interface IconVNode {
  type: "Icon";
  name: string;
  namePath?: string;
}

export interface VideoVNode {
  type: "Video";
  url: string;
  urlPath?: string;
}

export interface AudioPlayerVNode {
  type: "AudioPlayer";
  url: string;
  urlPath?: string;
  description?: string;
  descriptionPath?: string;
}

export interface ChildrenTemplate {
  componentId: string;
  dataBinding: string;
}

export interface ColumnVNode {
  type: "Column";
  childIds: string[];
  template?: ChildrenTemplate;
  distribution?: string;
  alignment?: string;
}

export interface RowVNode {
  type: "Row";
  childIds: string[];
  template?: ChildrenTemplate;
  distribution?: string;
  alignment?: string;
}

export interface ListVNode {
  type: "List";
  childIds: string[];
  template?: ChildrenTemplate;
  direction?: string;
  alignment?: string;
}

export interface CardVNode {
  type: "Card";
  childId?: string;
  childIds: string[];
}

export interface TabItemVNode {
  title: string;
  titlePath?: string;
  childId: string;
}

export interface TabsVNode {
  type: "Tabs";
  tabItems: TabItemVNode[];
  childIds: string[];
}

export interface DividerVNode {
  type: "Divider";
  axis?: string;
}

export interface ModalVNode {
  type: "Modal";
  entryPointChild?: string;
  contentChild?: string;
  childIds: string[];
}

export interface ActionContextValue {
  path?: string;
  literalString?: string;
  literalNumber?: number;
  literalBoolean?: boolean;
}

export interface ActionContextEntry {
  key: string;
  value: ActionContextValue;
}

export interface ComponentAction {
  name: string;
  context?: ActionContextEntry[];
}

export interface ButtonVNode {
  type: "Button";
  childId?: string;
  childIds: string[];
  primary?: boolean;
  action?: ComponentAction;
}

export interface CheckBoxVNode {
  type: "CheckBox";
  label: string;
  labelPath?: string;
  value?: boolean;
  valuePath?: string;
}

export interface TextFieldVNode {
  type: "TextField";
  label: string;
  labelPath?: string;
  text?: string;
  textPath?: string;
  textFieldType?: string;
  validationRegexp?: string;
}

export interface DateTimeInputVNode {
  type: "DateTimeInput";
  value?: string;
  valuePath?: string;
  enableDate?: boolean;
  enableTime?: boolean;
}

export interface ChoiceOptionVNode {
  label: string;
  labelPath?: string;
  value: string;
}

export interface MultipleChoiceVNode {
  type: "MultipleChoice";
  selections?: string[];
  selectionsPath?: string;
  options: ChoiceOptionVNode[];
  maxAllowedSelections?: number;
  variant?: string;
  filterable?: boolean;
}

export interface SliderVNode {
  type: "Slider";
  value?: number;
  valuePath?: string;
  minValue?: number;
  maxValue?: number;
}

export interface EmptyVNode {
  type: "Empty";
  description?: string;
  descriptionPath?: string;
}

export type MappedVNode =
  | TextVNode
  | ImageVNode
  | IconVNode
  | VideoVNode
  | AudioPlayerVNode
  | ColumnVNode
  | RowVNode
  | ListVNode
  | CardVNode
  | TabsVNode
  | DividerVNode
  | ModalVNode
  | ButtonVNode
  | CheckBoxVNode
  | TextFieldVNode
  | DateTimeInputVNode
  | MultipleChoiceVNode
  | SliderVNode
  | EmptyVNode
  | null;

/** 可以是 mapped 描述，也可以是 renderMap 产出的组件实例（如 React element）。 */
export type VNode = unknown;

export type { BoundString };
