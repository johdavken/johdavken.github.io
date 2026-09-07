"use strict";

// Green Team (NVIDIA) and Red Team (AMD): two brand-accented dark themes.
// Each is a full palette block in theme.css, a <select id="themeSel">
// option in index.html, and an entry in applyTheme()'s migrations map so
// the value round-trips instead of falling back to Industrial Slate.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const theme = fs.readFileSync("theme.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");

// Every token the other complete themes (e.g. one-dark) carry - a new
// theme must define the whole set so nothing falls through to a stale
// value from a previously applied theme.
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

function palette(id) {
  const start = theme.indexOf(`:where(html, body)[data-theme="${id}"]{`);
  assert.notEqual(start, -1, `expected a palette block for ${id}`);
  return theme.slice(start, theme.indexOf("\n}", start) + 2);
}

for (const [id, accent, glow] of [
  ["green-team", "#76b900", "118,185,0"],   // NVIDIA green
  ["red-team", "#ed1c24", "237,28,36"]      // AMD red
]) {
  test(`${id} is a complete dark palette`, () => {
    const block = palette(id);
    assert.match(block, /color-scheme: dark;/);
    for (const token of REQUIRED_TOKENS) {
      assert.match(block, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `${id} must define ${token}`);
    }
  });

  test(`${id} carries its brand accent on --title, --focus-border and the button/toggle fills`, () => {
    const block = palette(id);
    assert.match(block, new RegExp(`--title: ${accent};`));
    assert.match(block, new RegExp(`--focus-border: rgba\\(${glow},\\.85\\);`));
    assert.match(block, new RegExp(`--btn-primary-a: rgba\\(${glow},`));
    assert.match(block, new RegExp(`--toggle-on-bg: rgba\\(${glow},`));
  });

  test(`${id} is a flat neutral grey - no radial background glow, no accent-tinted row stripe`, () => {
    const block = palette(id);
    // Both body-background radial layers collapse to nothing.
    assert.match(block, /--bg-glow-a: transparent;/);
    assert.match(block, /--bg-glow-b: transparent;/);
    assert.match(block, /--card-glow-a: transparent;/);
    assert.match(block, /--card-glow-b: transparent;/);
    // A mid-dark grey ground, not near-black, and not a brand-tinted bg.
    assert.match(block, /--bg: #1[be]1[be]1[be];/);
    assert.doesNotMatch(block, new RegExp(`--bg: [^;]*rgba\\(${glow}`));
    // Row striping is neutral white-alpha, not the brand accent.
    assert.match(block, /--row-bg-2: rgba\(255,255,255,\.035\);/);
    assert.doesNotMatch(block, new RegExp(`--row-bg-2: rgba\\(${glow}`));
  });

  test(`${id} is offered in the Display theme picker, on every device (not touch-only)`, () => {
    const select = html.slice(html.indexOf('<select id="themeSel">'), html.indexOf("</select>", html.indexOf('<select id="themeSel">')));
    const label = id === "green-team" ? "Green Team" : "Red Team";
    assert.match(select, new RegExp(`<option value="${id}">${label}</option>`));
    assert.doesNotMatch(select, new RegExp(`<option value="${id}"[^>]*data-touch-only-theme`));
  });

  test(`${id} round-trips through applyTheme's migrations map (no Industrial Slate fallback)`, () => {
    assert.match(app, new RegExp(`\\["${id}", "${id}"\\],`));
  });
}

test("Red Team keeps a non-red --ok and a distinguishable --bad so success and error still read as themselves", () => {
  const block = palette("red-team");
  assert.match(block, /--ok: #3ddc84;/);        // green success, not the crimson accent
  assert.match(block, /--bad: #ff6257;/);       // warm error red, offset from #ed1c24
  assert.doesNotMatch(block, /--ok: #ed1c24;/);
});

test("Green Team's --ok stays in the NVIDIA green family (accent doubles as success, like the Dark baseline)", () => {
  assert.match(palette("green-team"), /--ok: #83c500;/);
});
