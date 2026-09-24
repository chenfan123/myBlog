import simpleTextSource from "./simple-text.json" with { type: "json" };
import columnTextSource from "./column-text.json" with { type: "json" };
import nestedColumnSource from "./nested-column.json" with { type: "json" };
import standardCatalogSource from "./standard-catalog.json" with { type: "json" };
import loginFormSource from "./login-form.json" with { type: "json" };
import listTemplateSource from "./list-template.json" with { type: "json" };
import cartListSource from "./cart-list.json" with { type: "json" };
import localUpdateTextSource from "./local-update-text.json" with { type: "json" };
import openLinkSource from "./open-link.json" with { type: "json" };
import mediaPlayerSource from "./media-player.json" with { type: "json" };
import formControlsSource from "./form-controls.json" with { type: "json" };
import tabsModalSource from "./tabs-modal.json" with { type: "json" };
import emptyStateSource from "./empty-state.json" with { type: "json" };

/** mock 源可以是消息数组，或 `{ messages }` 对象；运行时统一成数组。 */
export function toMessageArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray((value as { messages?: unknown }).messages)) {
    return (value as { messages: unknown[] }).messages;
  }
  throw new Error("mock must be a message array or { messages }");
}

export const simpleTextMock = toMessageArray(simpleTextSource);
export const columnTextMock = toMessageArray(columnTextSource);
export const nestedColumnMock = toMessageArray(nestedColumnSource);
export const standardCatalogMock = toMessageArray(standardCatalogSource);
export const loginFormMock = toMessageArray(loginFormSource);
export const listTemplateMock = toMessageArray(listTemplateSource);
export const cartListMock = toMessageArray(cartListSource);
export const localUpdateTextMock = toMessageArray(localUpdateTextSource);
export const openLinkMock = toMessageArray(openLinkSource);
export const mediaPlayerMock = toMessageArray(mediaPlayerSource);
export const formControlsMock = toMessageArray(formControlsSource);
export const tabsModalMock = toMessageArray(tabsModalSource);
export const emptyStateMock = toMessageArray(emptyStateSource);
