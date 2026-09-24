import catalog from "./catalog.json" with { type: "json" };

/** 当前 a2ui-react renderers 支持的 A2UI 组件协议（标准目录 18 项 + Empty）。 */
export const supportedCatalog = catalog;
export type SupportedCatalog = typeof catalog;
