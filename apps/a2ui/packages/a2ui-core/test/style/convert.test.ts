import assert from "node:assert/strict";
import { parseSurfaceStyles, STYLE_PRESETS, stylesToCssVars } from "../../src/style/index.js";

describe("surface styles", () => {
  it("drops invalid colors, fonts, and radius", () => {
    assert.equal(
      parseSurfaceStyles({
        primaryColor: "blue",
        font: "url(https://evil.example/x.css)",
        radius: 99,
        theme: "neon",
      }),
      undefined,
    );
  });

  it("keeps catalog tokens", () => {
    assert.deepEqual(
      parseSurfaceStyles({
        theme: "apple",
        primaryColor: "#1d1d1f",
        radius: 18,
        formFactor: "desktop",
      }),
      { theme: "apple", primaryColor: "#1d1d1f", radius: 18, formFactor: "desktop" },
    );
  });

  it("expands a theme preset into CSS variables", () => {
    const vars = stylesToCssVars({ theme: "apple" });
    assert.equal(vars["--a2ui-primary"], STYLE_PRESETS.apple.primaryColor);
    assert.equal(vars["--a2ui-font"], STYLE_PRESETS.apple.font);
    assert.equal(vars["--a2ui-radius"], "18px");
    assert.equal(vars["--a2ui-on-primary"], "#ffffff");
  });

  it("lets explicit tokens override the preset", () => {
    const vars = stylesToCssVars({ theme: "apple", primaryColor: "#0071e3", radius: 8 });
    assert.equal(vars["--a2ui-primary"], "#0071e3");
    assert.equal(vars["--a2ui-radius"], "8px");
    assert.equal(vars["--a2ui-bg"], STYLE_PRESETS.apple.background);
  });

  it("maps formFactor to a host token", () => {
    assert.equal(parseSurfaceStyles({ formFactor: "tablet" }), undefined);
    const vars = stylesToCssVars({ formFactor: "desktop" });
    assert.equal(vars["--a2ui-form-factor"], "desktop");
  });

  it("returns no variables when styles are missing so host CSS can fall back", () => {
    assert.deepEqual(stylesToCssVars(undefined), {});
  });
});
