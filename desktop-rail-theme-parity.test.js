"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const desktop = fs.readFileSync("desktop.css", "utf8");

// Gruvbox Dark/Light and Industrial Slate/Dark share one extra surface pass
// over the desktop side rail - the "gruv rail". It exists to recolour that
// rail, and it used to resize it too: 27px icons against the shared 17px, a
// 13px/800/.1em label against 14px/650/.06em, a 13px icon gap against 7px, its
// own 14px/12px container padding, and a 10px/1.15 caption. The result was
// that RESIN TOTALS wrapped to two lines and the foldaway rows ran 8px short
// in exactly those four themes and nowhere else - the rail laid out
// differently depending on which colours you had picked.
//
// A theme may recolour this rail. It may not resize it. These tests read each
// rule the pass still declares and fail if a geometry property comes back.
// The four themes are no longer named in the stylesheet at all. app.js derives
// body[data-rail-surface="terminal"] from the active theme, so adding a theme
// to the family is one line there instead of 31 selector edits here - which is
// exactly how this rail drifted into resizing itself in the first place.
const SCOPE = 'body[data-rail-surface="terminal"]';
const TERMINAL_THEMES = ["gruvbox-dark", "gruvbox-light", "industrial-slate", "industrial-slate-dark"];

// Properties that move or resize something, as opposed to colouring it.
const GEOMETRY = /(?:^|[;{\s])(min-height|max-height|height|min-width|max-width|width|padding|padding-[a-z]+|margin|margin-[a-z]+|gap|row-gap|column-gap|font-size|font-weight|letter-spacing|line-height|stroke-width|border-width)\s*:/;

function ruleBody(selector) {
  const start = desktop.indexOf(`${SCOPE} ${selector}{`);
  assert.notEqual(start, -1, `expected a "${SCOPE} ${selector}" rule in desktop.css`);
  const open = desktop.indexOf("{", start);
  const close = desktop.indexOf("}", open);
  assert.notEqual(close, -1, `unterminated rule for ${selector}`);
  return desktop.slice(open + 1, close);
}

for (const selector of [
  ".workspaceNav",
  ".workspaceNavButton",
  ".workspaceNavButton > span",
  ".workspaceNavButton small",
  ".workspaceNavButton .workspaceTileIcon",
]) {
  test(`the gruv rail's ${selector} rule sets no geometry - only the shared rail decides size`, () => {
    const body = ruleBody(selector);
    const offender = body.match(GEOMETRY);
    assert.equal(
      offender,
      null,
      `${selector} declares "${offender && offender[1]}" - that resizes the rail for four themes only. ` +
      "Put it on the shared rail rule so every theme gets it, or drop it.",
    );
  });
}

test("the caption rule is ink alone, so foldaway rows are the same height in every theme", () => {
  const body = ruleBody(".workspaceNavButton small");
  const declarations = body.split(";").map(d => d.trim()).filter(Boolean);
  assert.equal(declarations.length, 1, `expected one declaration, got: ${declarations.join(" | ")}`);
  assert.match(declarations[0], /^color:/);
});

test("the icon rule is ink alone, so the rail's glyphs are one size in every theme", () => {
  const body = ruleBody(".workspaceNavButton .workspaceTileIcon");
  const declarations = body.split(";").map(d => d.trim()).filter(Boolean);
  assert.equal(declarations.length, 1, `expected one declaration, got: ${declarations.join(" | ")}`);
  assert.match(declarations[0], /^color:var\(--gruv-rail-paper\)$/);
});

test("the four themes still recolour the rail - this is a parity guard, not a deletion", () => {
  // Whatever else changes, the pass must keep doing the job it exists for.
  assert.match(ruleBody(".workspaceNav"), /background:/);
  assert.match(ruleBody(".workspaceNavButton"), /color:var\(--gruv-rail-paper\)/);
  for (const token of ["--gruv-rail-paper", "--gruv-rail-recipe", "--gruv-rail-totals"]) {
    assert.ok(desktop.includes(`${token}:`), `expected the rail to still define ${token}`);
  }
});

/* ----------------------------------------------------------------------- *
 *   The hook itself
 * --------------------------------------------------------------------- */

test("the rail surface is addressed by one derived attribute, not by naming four themes", () => {
  const desktop = fs.readFileSync("desktop.css", "utf8");
  for (const theme of TERMINAL_THEMES) {
    const named = desktop.includes(`[data-theme="${theme}"]) .workspaceNav`);
    assert.ok(!named, `desktop.css still names ${theme} to reach the rail - use ${SCOPE}`);
  }
  assert.ok(desktop.includes(SCOPE), "expected the rail pass to be scoped by the derived attribute");
});

test("app.js derives the attribute from the active theme, and removes it for the rest", () => {
  const app = fs.readFileSync("app.js", "utf8");
  const block = app.slice(app.indexOf("const TERMINAL_RAIL_THEMES"), app.indexOf("function applyTheme(t)"));
  assert.ok(block, "expected a TERMINAL_RAIL_THEMES set in app.js");
  const listed = [...block.matchAll(/"([a-z-]+)"/g)].map(m => m[1]).filter(v => v !== "data-rail-surface" && v !== "terminal");
  assert.deepEqual(listed.sort(), [...TERMINAL_THEMES].sort(), "the family membership drifted");
  // Removing it matters as much as setting it: without the else branch a
  // theme switch would leave the previous theme's rail surface behind.
  assert.match(block, /setAttribute\("data-rail-surface", "terminal"\)/);
  assert.match(block, /removeAttribute\("data-rail-surface"\)/);
  // applyTheme has to actually call it, or none of the above runs.
  assert.match(app, /applyThemeGroupings\(theme\);/);
});

test("the default theme's rail is correct before any script runs", () => {
  // index.html hard-codes data-theme="industrial-slate", which IS a member -
  // so the attribute has to be in the markup too or the rail paints its
  // non-terminal surface until app.js gets there.
  const html = fs.readFileSync("index.html", "utf8");
  const body = html.slice(html.indexOf("<body"), html.indexOf(">", html.indexOf("<body")) + 1);
  assert.match(body, /data-theme="industrial-slate"/);
  assert.match(body, /data-rail-surface="terminal"/,
    "the default theme is a terminal-rail theme, so the attribute must be pre-set to avoid a flash");
});
