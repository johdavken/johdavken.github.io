"use strict";

// The desktop sidebar (.workspaceNav) is a CSS grid given a fixed, often-
// tall height (100dvh - 24px) with overflow:auto. Without an explicit
// align-content, grid's default (normal) behaves as stretch, so any
// leftover height beyond what the rows actually need gets distributed
// across every auto-sized row - most visibly the More/divider row, which
// has almost no natural content of its own and so ballooned from ~33px up
// past 75px on themes with nothing to counteract it. The four gruv-rail-
// grouped themes (gruvbox-dark/light, industrial-slate-dark/light) never
// showed this because their own .workspaceNav override already declared
// align-content:start - not as a deliberate fix for this bug, just an
// unrelated leftover from that block's own layout. Hoisted to the shared
// rule so every theme gets the fix and the grouped themes' now-redundant
// copy of the exact same declaration is gone.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const desktop = fs.readFileSync("desktop.css", "utf8");

test("the shared desktop .workspaceNav rule pins rows to their own size instead of stretching to fill the sidebar", () => {
  const start = desktop.indexOf("  .workspaceNav{\n    position:sticky;");
  assert.notEqual(start, -1);
  const block = desktop.slice(start, desktop.indexOf("\n  }", start));
  assert.match(block, /height:calc\(100dvh - 24px\);/);
  assert.match(block, /align-content:start;/);
});

test("the four gruv-rail-grouped themes no longer carry their own duplicate of the same declaration", () => {
  const start = desktop.indexOf("/* Experimental Gruvbox desktop rail.");
  assert.notEqual(start, -1);
  const end = desktop.indexOf("\n  }", start);
  const groupedRule = desktop.slice(start, end);
  assert.doesNotMatch(groupedRule, /align-content:start;/);
  // Confirm this is really the theme-grouped .workspaceNav override and not
  // some unrelated block, so the doesNotMatch above is actually meaningful.
  assert.match(
    groupedRule,
    /body:is\(\[data-theme="gruvbox-dark"\],\[data-theme="gruvbox-light"\],\[data-theme="industrial-slate-dark"\],\[data-theme="industrial-slate"\]\) \.workspaceNav\{/
  );
});

test("exactly one align-content:start remains for .workspaceNav across the whole file - a single source of truth, not a coincidental match elsewhere", () => {
  const occurrences = (desktop.match(/\.workspaceNav\{[^}]*align-content:start;/g) || []).length;
  assert.equal(occurrences, 1);
});
