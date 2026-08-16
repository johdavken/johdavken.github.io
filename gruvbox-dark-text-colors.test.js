"use strict";

// Gruvbox Dark text colour pass.
//
// --title is this palette's general emphasis accent (~140 call sites: stat
// values, active tabs, card labels) and it was the *only* source of red text
// anywhere in the theme - section headings and those accents all resolved to
// the same #fb4934. Splitting them was therefore a prerequisite for "red ->
// orange, except the section titles":
//
//   --title         #fb4934 -> #fe8019   every former red accent
//   --section-title          -> #ebdbb2   headings only, newspaper white
//   --subtitle      #689d6a -> #b8bb26   matched to the green icon glyphs
//
// --section-title is a new, optional token: only Gruvbox Dark defines it, and
// .layerTitle falls through to --title everywhere else, so no other theme
// moves. Error red (--bad) is deliberately untouched - it is a state signal,
// not decoration.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const theme = fs.readFileSync("theme.css", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const NEWSPAPER_WHITE = "#ebdbb2";
const ICON_GREEN = "#b8bb26";
const ORANGE = "#fe8019";
const OLD_RED = "#fb4934";

function gruvboxDarkPalette(){
  const start = theme.indexOf(':where(html, body)[data-theme="gruvbox-dark"]{');
  assert.notEqual(start, -1, "expected the Gruvbox Dark palette block");
  return theme.slice(start, theme.indexOf("\n}", start));
}

test("no text-carrying token in the Gruvbox Dark palette is red any more", () => {
  const palette = gruvboxDarkPalette();
  for (const token of ["--title", "--subtitle", "--yellow"]){
    const value = palette.match(new RegExp(`${token}:\\s*([^;]+);`))[1].trim();
    assert.notEqual(value, OLD_RED, `${token} must no longer be red`);
  }
});

test("--title carries the former red accents over to orange", () => {
  assert.match(gruvboxDarkPalette(), new RegExp(`--title:\\s*${ORANGE};`));
});

test("section headings take newspaper white - the same ink the desktop rail labels use", () => {
  assert.match(gruvboxDarkPalette(), new RegExp(`--section-title:\\s*${NEWSPAPER_WHITE};`));
  // Same value the rail paints its labels and (non-accented) glyphs with.
  const desktop = fs.readFileSync("desktop.css", "utf8");
  assert.match(desktop, new RegExp(`--gruv-rail-paper:${NEWSPAPER_WHITE};`),
    "newspaper white must stay in sync with the rail's own paper token");
});

test("the subheader green matches the green the icon set uses, not the old sage", () => {
  assert.match(gruvboxDarkPalette(), new RegExp(`--subtitle:\\s*${ICON_GREEN};`));
  // #b8bb26 is exactly what the Resin Totals glyph is painted with.
  assert.match(styles, new RegExp(`--gruv-green:${ICON_GREEN};`));
  const desktop = fs.readFileSync("desktop.css", "utf8");
  assert.match(desktop, new RegExp(`--gruv-rail-totals:${ICON_GREEN};`));
});

test(".layerTitle reads --section-title but still falls through to --title, so untouched themes keep their heading colour", () => {
  assert.match(styles, /color: var\(--section-title, var\(--title, var\(--text\)\)\);/);
  assert.match(styles,
    /\.workspaceContent > \.workspacePanel\[open\] > summary \.layerTitle\{ color: var\(--section-title, var\(--title\)\); \}/,
    "the mobile open-panel heading re-states the colour at higher specificity and must use the same token");
});

test("only Gruvbox Dark opts into --section-title - every other palette is untouched", () => {
  const definitions = theme.split("\n").filter(line => /--section-title:/.test(line));
  assert.equal(definitions.length, 1, "exactly one palette should define --section-title");
  const before = theme.slice(0, theme.indexOf("--section-title:"));
  const owningPalette = before.lastIndexOf('[data-theme="');
  const name = theme.slice(owningPalette).match(/\[data-theme="([^"]+)"\]/)[1];
  assert.equal(name, "gruvbox-dark");
});

test("error red is left alone - it signals state, not decoration", () => {
  assert.match(gruvboxDarkPalette(), /--bad:\s*#cc241d;/,
    "turning error text orange would remove the only red signal left in the theme");
});

test("the theme stylesheet cache-bust version moved with the palette", () => {
  const version = html.match(/href="theme\.css\?v=([\d.]+)"/);
  assert.ok(version, "expected a versioned theme.css link");
  assert.notEqual(version[1], "0.17.4", "theme.css changed - its ?v= must move with it");
});
