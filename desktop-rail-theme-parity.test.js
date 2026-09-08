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
const SCOPE = 'body:is([data-theme="gruvbox-dark"],[data-theme="gruvbox-light"],[data-theme="industrial-slate-dark"],[data-theme="industrial-slate"])';

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
