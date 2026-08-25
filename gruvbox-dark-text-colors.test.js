"use strict";

// Gruvbox Dark is the selected Muted Terminal direction. Surface, foreground,
// and accent values are pinned here so later work cannot quietly drift it
// back toward the brighter stock Gruvbox palette.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const theme = fs.readFileSync("theme.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

function gruvboxDarkPalette(){
  const start = theme.indexOf(':where(html, body)[data-theme="gruvbox-dark"]{');
  assert.notEqual(start, -1, "expected the Gruvbox Dark palette block");
  return theme.slice(start, theme.indexOf("\n}", start));
}

test("Gruvbox Dark carries the Muted Terminal surfaces and foregrounds", () => {
  const palette = gruvboxDarkPalette();
  const expected = {
    "--bg": "#20211d",
    "--panel": "rgba(44,45,37,.97)",
    "--panel2": "rgba(54,55,45,.94)",
    "--text": "#d8d1a8",
    "--subtitle": "#9f9a7f",
    "--muted": "#9f9a7f"
  };
  for (const [token, value] of Object.entries(expected)){
    assert.match(palette, new RegExp(`${token}:\\s*${escapeRe(value)};`));
  }
});

test("Gruvbox Dark uses Muted Terminal's dusty amber, green, teal, and red accents", () => {
  const palette = gruvboxDarkPalette();
  for (const [token, value] of Object.entries({
    "--title": "#c9b46b",
    "--yellow": "#c9b46b",
    "--orange": "#c99554",
    "--ok": "#89a86b",
    "--bad": "#c87968",
    "--f-var1": "#89a86b",
    "--f-var2": "#c9b46b",
    "--f-var3": "#7b9e9a"
  })){
    assert.match(palette, new RegExp(`${token}:\\s*${escapeRe(value)};`));
  }
});

test("section headings fall back to the shared muted amber accent rather than a Gruvbox-only custom token", () => {
  assert.doesNotMatch(gruvboxDarkPalette(), /--section-title:/);
  assert.equal((theme.match(/--section-title:/g) || []).length, 0,
    "no palette should carry the retired heading-only override");
});

test("mobile and desktop navigation use Muted Terminal's restrained teal and aqua", () => {
  assert.match(styles, /body\[data-theme="gruvbox-dark"\]\{[\s\S]*?--gruv-aqua:#82a78b;[\s\S]*?--gruv-blue:#7b9e9a;/);
  const desktop = fs.readFileSync("desktop.css", "utf8");
  const rail = desktop.slice(
    desktop.indexOf('body[data-theme="gruvbox-dark"] .workspaceNav{'),
    desktop.indexOf('body[data-theme="gruvbox-light"] .workspaceNav{')
  );
  assert.match(rail, /--gruv-rail-timeline:#7b9e9a;/);
  assert.match(rail, /--gruv-rail-sync:#82a78b;/);
  assert.match(rail, /--gruv-rail-help:#7b9e9a;/);
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
  assert.notEqual(version[1], "0.17.4", "theme.css changed - its ?v= must move with it");
});

function escapeRe(value){
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
