export const SERVER_TO_CLIENT_ACTIONS = [
  "beginRendering",
  "surfaceUpdate",
  "dataModelUpdate",
  "deleteSurface",
] as const;

export type ServerToClientAction = (typeof SERVER_TO_CLIENT_ACTIONS)[number];

export const DEFAULT_CATALOG_ID = "a2ui-react:v0.8";

export const CATALOG_COMPONENT_TYPES = [
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
  "Empty",
] as const;

export type A2UIMessage = Record<string, unknown>;
