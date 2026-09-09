"use strict";

// Ayu Light — a fresh mapping of the Ayu Light palette onto Resin.tools'
// existing semantic token system. Ayu is the palette, NOT an orange
// redesign: the interface stays predominantly neutral (three near-white
// surfaces + fine cool-grey separators) and colour is reserved for
// meaning — Recipe warm, Timeline/editing/focus blue, Resin Totals /
// tracked / synced green, destructive/reset/error red.
//
// The full Ayu family is implemented: Ayu Light here, Ayu Mirage in
// mirage-theme.test.js, Ayu Dark in dark-theme.test.js.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const theme = fs.readFileSync("theme.css", "utf8");
const styles = readStyles();
const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

function palette(id) {
  const start = theme.indexOf(`:where(html, body)[data-theme="${id}"]{`);
  assert.notEqual(start, -1, `expected a palette block for ${id}`);
  return theme.slice(start, theme.indexOf("\n}", start) + 2);
}

const AYU = palette("ayu-light");

// The full token set every complete theme carries, so nothing falls
// through to a stale value from a previously applied theme.
const REQUIRED_TOKENS = [
  "--bg:", "--panel:", "--panel2:",
  "--text:", "--subtitle:", "--title:", "--muted:", "--fg:",
  "--yellow:", "--orange:", "--warn:", "--bad:", "--ok:",
  "--shadow2:", "--border:", "--border2:",
  "--field-bg:", "--panelOpen:", "--chev:",
  "--row-bg:", "--row-border:", "--row-bg-2:", "--row-border-2:",
  "--readonly-bg:", "--readonly-border:",
  "--focus-border:", "--focus-ring:",
  "--f-var1:", "--f-var2:", "--f-var3:", "--f-const:",
  "--btn-text:", "--btn-border:",
  "--btn-primary-a:", "--btn-primary-b:",
  "--btn-secondary-bg:", "--btn-secondary-border:",
  "--btn-danger-bg:", "--btn-danger-border:",
  "--bg-glow-a:", "--bg-glow-b:", "--card-glow-a:", "--card-glow-b:",
  "--toggle-on-bg:", "--toggle-on-border:",
  "--footer-bg:", "--footer-border:"
];

test("Ayu Light is a complete light palette", () => {
  assert.match(AYU, /color-scheme: light;/);
  for (const token of REQUIRED_TOKENS) {
    assert.match(AYU, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Ayu Light must define ${token}`);
  }
});

test("stays registered in the picker and round-trips through applyTheme", () => {
  const select = html.slice(html.indexOf('<select id="themeSel">'), html.indexOf("</select>", html.indexOf('<select id="themeSel">')));
  assert.match(select, /<option value="ayu-light">Ayu Light<\/option>/);
  assert.doesNotMatch(select, /<option value="ayu-light"[^>]*data-touch-only-theme/);
  assert.match(app, /\["ayu-light", "ayu-light"\],/);
});

test("surfaces are the three neutral Ayu Light near-whites, page below panel", () => {
  assert.match(AYU, /--bg: #f8f9fa;/);
  assert.match(AYU, /--desktop-canvas-bg: #f8f9fa;/);
  assert.match(AYU, /--panel: rgba\(250,250,250,/);
  // No saturated hue baked into the ground or the row stripe: hierarchy is
  // tonal, not decorative.
  assert.match(AYU, /--bg-glow-a: rgba\(107,125,143,/);
  assert.match(AYU, /--bg-glow-b: rgba\(107,125,143,/);
  assert.match(AYU, /--row-bg-2: rgba\(92,97,102,/);
});

test("primary ink and muted UI are the exact Ayu Light foundation values", () => {
  assert.match(AYU, /--text: #5c6166;/);
  assert.match(AYU, /--fg: #5c6166;/);
  assert.match(AYU, /--muted: #828e9f;/);
});

test("separators and neutral button edges are restrained cool grey, not a boxed border", () => {
  assert.match(AYU, /--border: rgba\(107,125,143,\.22\);/);
  assert.match(AYU, /--btn-secondary-bg: rgba\(107,125,143,/);
  assert.match(AYU, /--btn-secondary-border: rgba\(107,125,143,/);
  // The old build tinted the secondary button fill green just for being a
  // control — Ayu Light keeps it neutral.
  assert.doesNotMatch(AYU, /--btn-secondary-bg: rgba\(134,179,0/);
});

test("semantic families: destructive red, tracked/synced green, edit/focus blue, warn amber", () => {
  assert.match(AYU, /--bad: #e65050;/);            // Ayu Light error
  assert.match(AYU, /--ok: #86b300;/);             // Ayu Light green
  assert.match(AYU, /--warn: #eba400;/);           // Ayu Light yellow
  assert.match(AYU, /--yellow: #eba400;/);
  assert.match(AYU, /--focus-border: rgba\(57,158,230,/);   // Ayu Light blue
  assert.match(AYU, /--focus-ring: rgba\(57,158,230,/);
});

test("Recipe keeps a restrained warm identity — but orange is never the default", () => {
  assert.match(AYU, /--orange: #fa8532;/);
  // Headings / generic titles resolve to Ayu Light blue, not orange.
  assert.match(AYU, /--title: #1a91cd;/);
  // Recipe's warm cue is scoped to the numbered workflow marker + the
  // mobile section header, not applied theme-wide.
  assert.match(styles, /body\[data-theme="ayu-light"\] \.workspaceNavButton\[data-workspace-target="splitsBlock"\]\{ --tile-accent:var\(--orange\); \}/);
  assert.match(styles, /body\[data-theme="ayu-light"\] #splitsBlock \.mobileSectionHeaderIcon\{color:var\(--orange\)\}/);
});

test("Ayu's accent-on brown (#7e4b01) is not used, and no burnt-orange stand-in", () => {
  assert.doesNotMatch(AYU, /#7e4b01/i);
  assert.doesNotMatch(AYU, /#7[0-9a-f]4[0-9a-f]0[0-9a-f]/i); // dark brown/burnt-orange range
});

test("does not override the Recipe pill tokens — the pill stays --focus-border / --bad", () => {
  assert.doesNotMatch(AYU, /--recipe-pill-accent:|--recipe-pill-danger:/);
});

test("brand mark is redrawn from Ayu Light hue families", () => {
  assert.match(theme, /\[data-theme="ayu-light"\] :is\(\.resinToolsLogo,\.resinToolsSidebarIcon\) \.rtLayerGreen\{color:#86b300/);
  assert.match(theme, /\[data-theme="ayu-light"\] :is\(\.resinToolsLogo,\.resinToolsSidebarIcon\) \.rtLayerBlue\{color:#399ee6/);
});

test("compact mobile Recipe keeps the hopper ID muted-neutral by default and copy a quiet blue", () => {
  const start = theme.indexOf('[data-theme="ayu-light"] #splitsBlock .splitsMatrix.compactMobileRecipe td.splitMatrixCell');
  assert.notEqual(start, -1);
  const block = theme.slice(start - 40, start + 700);
  assert.match(block, /\.splitCellHopperName:not\(\.smart\)\{color:var\(--muted\)\}/);
  assert.match(block, /\.splitCopyBtn\{color:#399ee6\}/);
  // not primary ink (heavier than the resin code), not orange
  assert.doesNotMatch(block, /\.splitCellHopperName:not\(\.smart\)\{color:#(5c6166|fa8532)\}/);
});

// --- Refinement pass -------------------------------------------------------

test("the open Recipe heading drops to primary ink via a theme-scoped rule; --title and --section-title are untouched", () => {
  // --section-title is a retired hook (gruvbox-dark-text-colors.test.js), so
  // the neutralisation is a narrow theme-scoped override on the Recipe panel.
  assert.doesNotMatch(theme, /--section-title:/);
  assert.match(
    theme,
    /body\[data-theme="ayu-light"\] #splitsBlock\[open\] > summary \.layerTitle\{\s*\n\s*color: var\(--text\);/
  );
  // --title stays the structural blue (matrix A/B/C, edit outlines, Timeline).
  assert.match(AYU, /--title: #1a91cd;/);
  // Not a blanket .layerTitle recolour — other sections/dialogs keep --title.
  assert.doesNotMatch(theme, /body\[data-theme="ayu-light"\] \.layerTitle\{/);
});

test("Station Console selected fill is Ayu Light's own UI blue-slate, not the shared --text charcoal, and only for Ayu Light", () => {
  assert.match(AYU, /--btnstyle-ink: #5f7391;/);
  // The shared default stays var(--text); no other theme block overrides it.
  assert.match(fs.readFileSync("button-styling.css", "utf8"), /--btnstyle-ink: var\(--text\);/);
  const others = theme.replace(AYU, "");
  assert.doesNotMatch(others, /--btnstyle-ink:/);
});

test("Recipe matrix data hierarchy — one convention for every layout: resin = --muted, percentage = restrained Ayu red, % suffix untouched", () => {
  // Resin code -> the same soft blue-grey as the layer-percentage text.
  assert.match(
    theme,
    /body\[data-theme="ayu-light"\] #splitsArea \.splitMatrixCell:not\(\.empty\) \.splitCellResinText,\s*\n\s*body\[data-theme="ayu-light"\] #splitsArea \.splitMatrixCell:not\(\.empty\) \.resinNameInput,\s*\n\s*body\[data-theme="ayu-light"\] #splitsArea \.splitMatrixCell:not\(\.empty\) \.resinNameInput:disabled\{\s*\n\s*color: var\(--muted\);\s*\n\s*-webkit-text-fill-color: var\(--muted\);/
  );
  // Percentage number -> Ayu red family L1, deliberately NOT --bad (#e65050).
  assert.match(
    theme,
    /body\[data-theme="ayu-light"\] #splitsArea \.splitMatrixCell:not\(\.empty\) \.splitInput,\s*\n\s*body\[data-theme="ayu-light"\] #splitsArea \.splitMatrixCell:not\(\.empty\) \.splitInput:disabled\{\s*\n\s*color: #e5474f;\s*\n\s*-webkit-text-fill-color: #e5474f;/
  );
  assert.doesNotMatch(theme, /\.splitInput[^\n]*\{\s*\n\s*color: #e65050/);
  // Not device-scoped — the same rule serves desktop and the touch shell.
  assert.doesNotMatch(theme, /\[data-shell="touch"\][^\n]*\.splitCellResinText/);
});

test("Reset stays on --bad (#e65050) — no override added, since it already resolves correctly", () => {
  assert.doesNotMatch(AYU, /--btnstyle-danger:|--recipe-pill-danger:/);
  assert.match(AYU, /--bad: #e65050;/);
  // The percentage red is a distinct value from the destructive token.
  assert.notEqual("#e5474f", "#e65050");
});

test("theme.css cache-bust version moved with the palette edits", () => {
  assert.match(html, /href="theme\.css\?v=0\.18\.1[2-9]"/);
});

test("the full Ayu family (Light, Mirage, Dark) has a palette block", () => {
  assert.notEqual(theme.indexOf('[data-theme="ayu-light"]'), -1);
  assert.notEqual(theme.indexOf('[data-theme="ayu-mirage"]'), -1);
  assert.notEqual(theme.indexOf('[data-theme="ayu-dark"]'), -1);
});
