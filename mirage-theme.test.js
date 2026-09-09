"use strict";

// Ayu Mirage — the Mirage column of the same Ayu palette sheet Ayu Light was
// mapped from, onto the identical semantic token set. Dark: three cool
// blue-grey surfaces, colour reserved for meaning (Recipe warm, editing/
// focus blue, tracked/synced green, destructive red).

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

const MIRAGE = palette("ayu-mirage");

// The full token set every complete theme carries (same list Ayu Light's
// test enforces) so nothing falls through to a stale value on theme switch.
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

test("Ayu Mirage is a complete dark palette", () => {
  assert.match(MIRAGE, /color-scheme: dark;/);
  for (const token of REQUIRED_TOKENS) {
    assert.match(
      MIRAGE,
      new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `Ayu Mirage must define ${token}`
    );
  }
});

test("registered in the picker and round-trips through applyTheme", () => {
  const select = html.slice(
    html.indexOf('<select id="themeSel">'),
    html.indexOf("</select>", html.indexOf('<select id="themeSel">'))
  );
  assert.match(select, /<option value="ayu-mirage">Ayu Mirage<\/option>/);
  assert.doesNotMatch(select, /<option value="ayu-mirage"[^>]*data-touch-only-theme/);
  assert.match(app, /\["ayu-mirage", "ayu-mirage"\],/);
  // bare "mirage" migrates to the same block
  assert.match(app, /\["mirage", "ayu-mirage"\],/);
});

test("surfaces are the three Ayu Mirage blue-greys, page below panel below raised", () => {
  assert.match(MIRAGE, /--bg: #1f2430;/);          // Mirage ui.bg
  assert.match(MIRAGE, /--desktop-canvas-bg: #1a1f29;/);
  assert.match(MIRAGE, /--panel: #242936;/);       // Mirage editor.bg
  assert.match(MIRAGE, /--panelOpen: #282e3b;/);   // Mirage panel.bg
});

test("primary ink is Ayu Mirage editor.fg; muted UI is Mirage ui.fg", () => {
  assert.match(MIRAGE, /--text: #cccac2;/);
  assert.match(MIRAGE, /--fg: #cccac2;/);
  assert.match(MIRAGE, /--muted: #707a8c;/);
  assert.match(MIRAGE, /--f-const: #707a8c;/);
});

test("semantic families: red #ff6666, green #d5ff80, warn/yellow #ffcd66, focus blue #73d0ff", () => {
  assert.match(MIRAGE, /--bad: #ff6666;/);         // Mirage common.error
  assert.match(MIRAGE, /--ok: #d5ff80;/);          // Mirage string green
  assert.match(MIRAGE, /--warn: #ffcd66;/);
  assert.match(MIRAGE, /--yellow: #ffcd66;/);      // Mirage func
  assert.match(MIRAGE, /--focus-border: rgba\(115,208,255,/);
  assert.match(MIRAGE, /--focus-ring: rgba\(115,208,255,/);
  assert.match(MIRAGE, /--title: #73d0ff;/);       // Mirage entity blue
});

test("Recipe keeps a restrained warm identity — orange is never the default", () => {
  assert.match(MIRAGE, /--orange: #ffa659;/);      // Mirage keyword
  assert.match(MIRAGE, /--title: #73d0ff;/);       // generic titles stay blue
  assert.match(
    styles,
    /body\[data-theme="ayu-mirage"\] \.workspaceNavButton\[data-workspace-target="splitsBlock"\]\{ --tile-accent:var\(--orange\); \}/
  );
  assert.match(
    styles,
    /body\[data-theme="ayu-mirage"\] #splitsBlock \.mobileSectionHeaderIcon\{color:var\(--orange\)\}/
  );
});

test("does NOT override --btnstyle-ink — on a dark theme the shared var(--text) is the right Station Console ink", () => {
  assert.doesNotMatch(MIRAGE, /--btnstyle-ink:/);
  assert.match(buttons, /--btnstyle-ink: var\(--text\);/);
});

test("does not override the Recipe pill tokens", () => {
  assert.doesNotMatch(MIRAGE, /--recipe-pill-accent:|--recipe-pill-danger:|--btnstyle-danger:/);
});

test("dark-theme surface idioms: opaque panel, dark inset fields, black-based shadow", () => {
  assert.match(MIRAGE, /--field-bg: rgba\(20,24,33,/);
  assert.match(MIRAGE, /--readonly-bg: rgba\(20,24,33,/);
  assert.match(MIRAGE, /--shadow2: 0 8px 22px rgba\(0,0,0,/);
  // row tint is a faint light wash, not a dark-on-dark invisible line
  assert.match(MIRAGE, /--row-bg: rgba\(204,202,194,/);
});

test("brand streams are redrawn from Ayu Mirage hue families", () => {
  assert.match(
    theme,
    /\[data-theme="ayu-mirage"\] :is\(\.resinToolsLogo,\.resinToolsSidebarIcon\)\{--rt-stream-1:#f28779;--rt-stream-2:#ffa659;--rt-stream-3:#ffcd66;--rt-stream-4:#d5ff80;--rt-stream-5:#73d0ff\}/
  );
});

test("Ayu's accent-on brown is not used anywhere in the block", () => {
  assert.doesNotMatch(MIRAGE, /#7e4b01/i);
  assert.doesNotMatch(MIRAGE, /#73592[0-9a-f]/i);
});
