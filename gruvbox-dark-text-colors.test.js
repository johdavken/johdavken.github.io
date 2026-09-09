"use strict";

// Gruvbox Dark tracks the canonical Gruvbox palette: bg0 surfaces and the
// BRIGHT accent column. Surface, foreground, and accent values are pinned
// here so later work cannot quietly drift it back toward the earlier Muted
// Terminal interpretation.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { readStyles } = require("./css-source");

const theme = fs.readFileSync("theme.css", "utf8");
const styles = readStyles();
const html = fs.readFileSync("index.html", "utf8");

function gruvboxDarkPalette(){
  const start = theme.indexOf(':where(html, body)[data-theme="gruvbox-dark"]{');
  assert.notEqual(start, -1, "expected the Gruvbox Dark palette block");
  return theme.slice(start, theme.indexOf("\n}", start));
}

test("Gruvbox Dark carries the canonical bg0 surfaces and fg1 foreground", () => {
  const palette = gruvboxDarkPalette();
  const expected = {
    "--bg": "#282828",
    "--desktop-canvas-bg": "#1d2021",
    "--panel": "#32302f",
    "--panel2": "rgba(60,56,54,.92)",
    "--text": "#ebdbb2",
    "--subtitle": "#bdae93",
    "--muted": "#a89984"
  };
  for (const [token, value] of Object.entries(expected)){
    assert.match(palette, new RegExp(`${token}:\\s*${escapeRe(value)};`));
  }
});

test("Gruvbox Dark uses the canonical bright red, green, yellow, blue, and purple accents", () => {
  const palette = gruvboxDarkPalette();
  for (const [token, value] of Object.entries({
    "--title": "#83a598",
    "--yellow": "#fabd2f",
    "--orange": "#fe8019",
    "--ok": "#b8bb26",
    "--bad": "#fb4934",
    "--f-var1": "#b8bb26",
    "--f-var2": "#fabd2f",
    "--f-var3": "#d3869b"
  })){
    assert.match(palette, new RegExp(`${token}:\\s*${escapeRe(value)};`));
  }
});

test("identity and focus are Gruvbox bright_blue #83a598, not the earlier amber", () => {
  const palette = gruvboxDarkPalette();
  assert.match(palette, /--focus-border:\s*rgba\(131,165,152,\.9\);/);
  assert.match(palette, /--focus-ring:\s*rgba\(131,165,152,\.2\);/);
  assert.doesNotMatch(palette, /rgba\(201,180,107/);
});

test("the retired --logo-i / --logo-q hooks are gone", () => {
  assert.doesNotMatch(gruvboxDarkPalette(), /--logo-[iq]:/);
});

test("section headings fall back to the shared title accent rather than a Gruvbox-only custom token", () => {
  assert.doesNotMatch(gruvboxDarkPalette(), /--section-title:/);
  assert.equal((theme.match(/--section-title:/g) || []).length, 0,
    "no palette should carry the retired heading-only override");
});

test("mobile and desktop navigation use the canonical bright aqua and blue", () => {
  assert.match(styles, /body\[data-theme="gruvbox-dark"\]\{[\s\S]*?--gruv-aqua:#8ec07c;[\s\S]*?--gruv-blue:#83a598;/);
  const desktop = fs.readFileSync("desktop.css", "utf8");
  const rail = desktop.slice(
    desktop.indexOf('body[data-theme="gruvbox-dark"] .workspaceNav{'),
    desktop.indexOf('body[data-theme="gruvbox-light"] .workspaceNav{')
  );
  assert.match(rail, /--gruv-rail-timeline:#83a598;/);
  assert.match(rail, /--gruv-rail-sync:#8ec07c;/);
  assert.match(rail, /--gruv-rail-help:#83a598;/);
});

test("shared headings retain their normal title fallback for every theme", () => {
  assert.match(styles, /color: var\(--section-title, var\(--title, var\(--text\)\)\);/);
  assert.match(styles,
    /\.workspaceContent > \.workspacePanel\[open\] > summary \.layerTitle\{ color: var\(--section-title, var\(--title\)\); \}/,
    "the mobile open-panel heading re-states the colour at higher specificity and must use the same token");
});

test("the theme stylesheet cache-bust version moved with the palette", () => {
  const version = html.match(/href="theme\.css\?v=([\d.]+)"/);
  assert.ok(version, "expected a versioned theme.css link");
  assert.notEqual(version[1], "0.18.15", "theme.css changed - its ?v= must move with it");
});

function escapeRe(value){
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
