"use strict";

// Ayu Dark — the Dark column of the same Ayu palette sheet, completing the
// family. The deepest of the three: near-black surfaces, Ayu Dark's warm
// off-white ink, colour reserved for meaning (Recipe warm, editing/focus
// blue, tracked/synced green, destructive red).

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const theme = fs.readFileSync("theme.css", "utf8");
const styles = readStyles();
const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const buttons = fs.readFileSync("button-styling.css", "utf8");

function palette(id) {
  const start = theme.indexOf(`:where(html, body)[data-theme="${id}"]{`);
  assert.notEqual(start, -1, `expected a palette block for ${id}`);
  return theme.slice(start, theme.indexOf("\n}", start) + 2);
}

const DARK = palette("ayu-dark");

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

test("Ayu Dark is a complete dark palette", () => {
  assert.match(DARK, /color-scheme: dark;/);
  for (const token of REQUIRED_TOKENS) {
    assert.match(
      DARK,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Ayu Dark must define ${token}`
    );
  }
});

test("registered in the picker and round-trips through applyTheme", () => {
  const select = html.slice(
    html.indexOf('<select id="themeSel">'),
    html.indexOf("</select>", html.indexOf('<select id="themeSel">'))
  );
  assert.match(select, /<option value="ayu-dark">Ayu Dark<\/option>/);
  assert.doesNotMatch(select, /<option value="ayu-dark"[^>]*data-touch-only-theme/);
  assert.match(app, /\["ayu-dark", "ayu-dark"\],/);
});

test("surfaces are Ayu Dark's near-blacks, page below panel below raised", () => {
  assert.match(DARK, /--bg: #0d1017;/);           // Ayu Dark ui.bg
  assert.match(DARK, /--desktop-canvas-bg: #0a0e15;/); // darker than the page
  assert.match(DARK, /--panel: #141821;/);        // Ayu Dark panel.bg
  assert.match(DARK, /--panelOpen: #1b2029;/);
});

test("primary ink is Ayu Dark's warm off-white; --muted is the documented one-step lift", () => {
  assert.match(DARK, /--text: #bfbdb6;/);         // Ayu Dark editor.fg
  assert.match(DARK, /--fg: #bfbdb6;/);
  assert.match(DARK, /--muted: #6b7580;/);        // lifted off ui.fg #5a6378 for legibility
  assert.match(DARK, /--f-const: #6b7580;/);
});

test("semantic families: red #d95757, green #aad94c, warn/yellow #ffb454, focus blue #59c2ff", () => {
  assert.match(DARK, /--bad: #d95757;/);          // Ayu Dark common.error
  assert.match(DARK, /--ok: #aad94c;/);           // Ayu Dark string green
  assert.match(DARK, /--warn: #ffb454;/);
  assert.match(DARK, /--yellow: #ffb454;/);       // Ayu Dark func
  assert.match(DARK, /--focus-border: rgba\(89,194,255,/);
  assert.match(DARK, /--focus-ring: rgba\(89,194,255,/);
  assert.match(DARK, /--title: #59c2ff;/);        // Ayu Dark entity blue
});

test("Recipe keeps a restrained warm identity — orange is never the default", () => {
  assert.match(DARK, /--orange: #ff8f40;/);       // Ayu Dark keyword
  assert.match(DARK, /--title: #59c2ff;/);
  assert.match(
    styles,
    /body\[data-theme="ayu-dark"\] \.workspaceNavButton\[data-workspace-target="splitsBlock"\]\{ --tile-accent:var\(--orange\); \}/
  );
  assert.match(
    styles,
    /body\[data-theme="ayu-dark"\] #splitsBlock \.mobileSectionHeaderIcon\{color:var\(--orange\)\}/
  );
});

test("does NOT override --btnstyle-ink — the shared var(--text) is the Station Console ink on dark", () => {
  assert.doesNotMatch(DARK, /--btnstyle-ink:/);
  assert.match(buttons, /--btnstyle-ink: var\(--text\);/);
});

test("does not override the Recipe pill tokens", () => {
  assert.doesNotMatch(DARK, /--recipe-pill-accent:|--recipe-pill-danger:|--btnstyle-danger:/);
});

test("dark-theme surface idioms: opaque panel, black insets, deep shadow, light row wash", () => {
  assert.match(DARK, /--field-bg: rgba\(0,0,0,/);
  assert.match(DARK, /--readonly-bg: rgba\(0,0,0,/);
  assert.match(DARK, /--shadow2: 0 10px 26px rgba\(0,0,0,/);
  assert.match(DARK, /--row-bg: rgba\(191,189,182,/);
});

test("brand streams are redrawn from Ayu Dark hue families", () => {
  assert.match(
    theme,
    /\[data-theme="ayu-dark"\] :is\(\.resinToolsLogo,\.resinToolsSidebarIcon\)\{--rt-stream-1:#f07178;--rt-stream-2:#ff8f40;--rt-stream-3:#ffb454;--rt-stream-4:#aad94c;--rt-stream-5:#59c2ff\}/
  );
});

test("Ayu's accent-on brown is not used anywhere in the block", () => {
  assert.doesNotMatch(DARK, /#7e4b01/i);
  assert.doesNotMatch(DARK, /#765b2[0-9a-f]/i);
});
